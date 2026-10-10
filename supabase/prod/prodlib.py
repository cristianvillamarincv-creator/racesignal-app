"""Shared safety code for the production helpers in this folder (RevenueCat secrets, cleanup schedule).

Everything that can reach the production Supabase project goes through here so the target is checked in one place:
  * the production ref comes from supabase/.temp/project-ref and must equal PROD_REF (a hard-coded expectation), and must not be
    the development ref;
  * read-only SQL is accepted only if it starts with SELECT (`sql_select`); writes go through `sql_write`, which only the
    `--apply` paths call after a typed confirmation phrase;
  * nothing here prints a secret.
"""
import base64
import hashlib
import json
import pathlib
import subprocess
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROD_REF = "ibdqeagutcjmbbjnquzv"
DEV_REF = "sjmixferxnkwbzkcofnp"
RC_PROD_PROJECT = "proj48e9ded9"  # RevenueCat "RaceSignal" (production)
RC_DEV_PROJECT = "projb98e9609"  # RevenueCat "RaceSignal Dev"
SECRET_NAMES = ["REVENUECAT_SECRET_API_KEY", "REVENUECAT_PROJECT_ID"]


class Abort(Exception):
    """A refusal with a plain message (nothing was changed)."""


def load_config() -> dict:
    envs = json.loads((ROOT / "mobile/config/environments.json").read_text())
    link = ROOT / "supabase/.temp/project-ref"
    if not link.exists():
        raise Abort("no production project link at supabase/.temp/project-ref")
    return {"prod_ref": link.read_text().strip(), "dev_ref": envs["development"]["supabaseProjectRef"]}


def keychain_token() -> str:
    raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], capture_output=True, text=True).stdout.strip()
    if raw.startswith("go-keyring-base64:"):
        raw = base64.b64decode(raw.split(":", 1)[1]).decode()
    if not raw:
        raise Abort("no Supabase CLI login found; run `supabase login`")
    return raw


def management_api(method: str, path: str, body=None):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {keychain_token()}", "Content-Type": "application/json", "User-Agent": "racesignal-prod-helper"})
    with urllib.request.urlopen(req, timeout=60) as response:
        text = response.read().decode()
    return json.loads(text) if text else None


def target(api, cfg) -> tuple:
    """Confirms the target is production (and only production). Returns (project name, status)."""
    if cfg["prod_ref"] == cfg["dev_ref"]:
        raise Abort("refusing: the linked project is the development project; expected production")
    if cfg["prod_ref"] != PROD_REF:
        raise Abort(f"refusing: the linked project is not the expected production project ({PROD_REF})")
    project = api("GET", f"/projects/{cfg['prod_ref']}")
    return project.get("name", "?"), project.get("status", "?")


def secrets_of(api, ref) -> dict:
    """name -> sha256 digest of the value, as the Management API returns it (never a value)."""
    return {s["name"]: s.get("value") for s in api("GET", f"/projects/{ref}/secrets")}


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def sql_select(api, ref, query: str):
    if not query.lstrip().lower().startswith("select"):
        raise Abort("internal error: a read-only call was given a statement that is not a SELECT")
    return api("POST", f"/projects/{ref}/database/query", {"query": query})


def sql_write(api, ref, query: str):
    return api("POST", f"/projects/{ref}/database/query", {"query": query})


def http_get_status(url: str, bearer: str, timeout: int = 30) -> int:
    """HTTP status of a read-only GET (never reads or returns the body)."""
    if not url.startswith("https://api.revenuecat.com/"):
        raise Abort("internal error: not a RevenueCat URL")
    req = urllib.request.Request(url, method="GET", headers={"Authorization": f"Bearer {bearer}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status
    except urllib.error.HTTPError as err:
        return err.code
