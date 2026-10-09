#!/usr/bin/env python3
"""Sets (or removes) the four Sign in with Apple secrets on the PRODUCTION Supabase project. For owner review; nothing here runs on its own.

  supabase/prod/set-apple-secrets.py check            # read-only: shows the target project and the secret NAMES that exist
  supabase/prod/set-apple-secrets.py set              # DRY RUN: validates your inputs and shows what would be set; changes nothing
  supabase/prod/set-apple-secrets.py set --apply      # the real change, after you type a confirmation phrase
  supabase/prod/set-apple-secrets.py remove --apply   # rollback: removes only the four APPLE_* secrets, after a confirmation phrase

What it does, and nothing else: it writes four function secrets (APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID,
APPLE_PRIVATE_KEY) that the delete-account function reads to revoke an athlete's Sign in with Apple tokens. It does not
change auth settings, deploy a function, or touch any other secret.

Safety design:
  * The target is always the production project in supabase/.temp/project-ref, shown before anything is written. It refuses
    if that ref equals the development ref, and it checks the bundle ID it will set against the production config.
  * Key ID and Team ID are typed (they are identifiers, not secrets). The .p8 is read from a PATH you type; its contents are
    never printed, logged, put on the command line, in the environment, or written to a file. The request goes straight to the
    Supabase Management API from memory using your CLI login (the macOS Keychain token), like the other helpers here.
  * The .p8 is validated locally before anything is sent: a PKCS#8 EC P-256 private key (the format Apple issues), and, when
    the file is named AuthKey_<KEYID>.p8, a matching Key ID.
  * `set --apply` refuses if any APPLE_* secret already exists on production, requires the exact phrase, then reads the secret
    names back and checks that every pre-existing secret's digest is unchanged.
  * Nothing it prints contains a secret value, a Key ID or a Team ID (lengths and names only).
"""
import argparse
import base64
import getpass
import json
import pathlib
import re
import stat
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
NAMES = ["APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_CLIENT_ID", "APPLE_PRIVATE_KEY"]
SET_PHRASE = "SET PRODUCTION APPLE SECRETS"
REMOVE_PHRASE = "REMOVE PRODUCTION APPLE SECRETS"
EXPECTED_CLIENT_ID = "com.cristianvillamarin.racesignal"


class Abort(Exception):
    """A refusal with a plain message (nothing was changed)."""


def load_config():
    envs = json.loads((ROOT / "mobile/config/environments.json").read_text())
    link = ROOT / "supabase/.temp/project-ref"
    if not link.exists():
        raise Abort("no production project link at supabase/.temp/project-ref")
    return {
        "prod_ref": link.read_text().strip(),
        "dev_ref": envs["development"]["supabaseProjectRef"],
        "client_id": envs["production"]["bundleIdentifier"],
    }


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
        headers={"Authorization": f"Bearer {keychain_token()}", "Content-Type": "application/json", "User-Agent": "racesignal-prod-apple-secrets"})
    with urllib.request.urlopen(req) as response:
        text = response.read().decode()
    return json.loads(text) if text else None


def target(api, cfg):
    if cfg["prod_ref"] == cfg["dev_ref"]:
        raise Abort("refusing: the linked project is the development project; expected production")
    if cfg["client_id"] != EXPECTED_CLIENT_ID:
        raise Abort("refusing: the production bundle ID in environments.json is not " + EXPECTED_CLIENT_ID)
    project = api("GET", f"/projects/{cfg['prod_ref']}")
    return project.get("name", "?"), project.get("status", "?")


def existing_secrets(api, ref) -> dict:
    return {s["name"]: s.get("value") for s in api("GET", f"/projects/{ref}/secrets")}


def validate_id(label: str, value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"[A-Z0-9]{10}", value):
        raise Abort(f"the {label} should be 10 uppercase letters and digits")
    return value


def validate_p8(path_text: str, key_id: str) -> str:
    path = pathlib.Path(path_text.strip().replace("\\ ", " ")).expanduser()
    if not path.is_file():
        raise Abort("cannot read that file")
    if path.stat().st_size > 4096:
        raise Abort("that file is too large to be a .p8 private key")
    match = re.fullmatch(r"AuthKey_([A-Z0-9]{10})\.p8", path.name)
    if match and match.group(1) != key_id:
        raise Abort("the file name's Key ID does not match the Key ID you entered")
    pem = path.read_text().strip()
    if not (pem.startswith("-----BEGIN PRIVATE KEY-----") and pem.endswith("-----END PRIVATE KEY-----")):
        raise Abort("that does not look like a .p8 private key (PKCS#8)")
    check = subprocess.run(["openssl", "pkey", "-in", str(path), "-noout", "-text"], capture_output=True, text=True)
    if check.returncode != 0 or ("prime256v1" not in check.stdout and "P-256" not in check.stdout):
        raise Abort("that key could not be read as an EC P-256 private key")
    if path.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        print("note: that file is readable by other users; consider chmod 600", file=sys.stderr)
    return pem


def run(argv, *, api=management_api, ask=input, cfg=None, out=print):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("command", choices=["check", "set", "remove"])
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    cfg = cfg or load_config()
    name, status = target(api, cfg)
    ref = cfg["prod_ref"]
    out(f"Target: PRODUCTION project '{name}' ({ref}), status {status}.")
    before = existing_secrets(api, ref)
    out("Secrets that exist now (names only): " + ", ".join(sorted(before)))
    have_apple = [n for n in NAMES if n in before]

    if args.command == "check":
        out("APPLE_* secrets present: " + (", ".join(have_apple) if have_apple else "none") + ". Nothing was changed.")
        return 0

    if args.command == "remove":
        if not have_apple:
            out("None of the four APPLE_* secrets exist; nothing to remove.")
            return 0
        out("Would remove: " + ", ".join(have_apple) + " (no other secret is touched).")
        if not args.apply:
            out("DRY RUN: nothing was changed. Re-run with --apply to remove them.")
            return 0
        if ask(f"Type exactly '{REMOVE_PHRASE}' to continue: ").strip() != REMOVE_PHRASE:
            raise Abort("confirmation phrase not typed; nothing was changed")
        api("DELETE", f"/projects/{ref}/secrets", have_apple)
        after = existing_secrets(api, ref)
        left = [n for n in NAMES if n in after]
        if left or any(before[n] != after.get(n) for n in before if n not in NAMES):
            raise Abort("read-back did not match expectations: " + str(left))
        out("Removed. Read-back: no APPLE_* secrets remain and every other secret is unchanged.")
        return 0

    # set
    if have_apple:
        raise Abort("refusing: these already exist on production: " + ", ".join(have_apple) + " (remove them first with `remove --apply` if you mean to replace them)")
    team_id = validate_id("Team ID", ask("Team ID (10 characters, an identifier, not a secret): "))
    key_id = validate_id("Key ID", ask("Key ID (10 characters, shown next to the key in the Apple portal): "))
    pem = validate_p8(ask("Path to the downloaded AuthKey_<KEYID>.p8 file: "), key_id)
    values = {"APPLE_TEAM_ID": team_id, "APPLE_KEY_ID": key_id, "APPLE_CLIENT_ID": cfg["client_id"], "APPLE_PRIVATE_KEY": pem}
    out("Validated. Would set on production:")
    out(f"  APPLE_TEAM_ID     ({len(team_id)} characters)")
    out(f"  APPLE_KEY_ID      ({len(key_id)} characters)")
    out(f"  APPLE_CLIENT_ID   ({cfg['client_id']})")
    out(f"  APPLE_PRIVATE_KEY (EC P-256 PKCS#8 private key, {len(pem)} characters, contents never shown)")
    if not args.apply:
        out("DRY RUN: nothing was sent or changed. Re-run with --apply to set them.")
        return 0
    if ask(f"Type exactly '{SET_PHRASE}' to send these to production: ").strip() != SET_PHRASE:
        raise Abort("confirmation phrase not typed; nothing was changed")
    api("POST", f"/projects/{ref}/secrets", [{"name": n, "value": values[n]} for n in NAMES])
    after = existing_secrets(api, ref)
    missing = [n for n in NAMES if n not in after]
    changed = [n for n in before if before[n] != after.get(n)]
    if missing or changed:
        raise Abort(f"read-back mismatch (missing: {missing}, changed: {changed}); run `remove --apply` to roll back")
    out("Set. Read-back: the four APPLE_* secrets now exist and every previously existing secret is unchanged.")
    out("Rollback: supabase/prod/set-apple-secrets.py remove --apply")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run(sys.argv[1:]))
    except Abort as err:
        print(f"Stopped: {err}", file=sys.stderr)
        sys.exit(1)
