#!/usr/bin/env python3
"""Configures Apple / Google sign-in and manual identity linking on the racesignal-dev Supabase project ONLY.

  supabase/dev/configure-auth.py status    # show the relevant dev auth settings (secrets are never printed)
  supabase/dev/configure-auth.py apple     # enable Apple (native ID-token sign-in: the dev bundle ID is the only client ID needed)
                                           # and enable manual linking (needed for Settings -> Connected accounts)
  supabase/dev/configure-auth.py google    # enable Google (OAuth redirect flow) with the Web client ID from
                                           # mobile/config/environments.json; prompts silently for the Web client SECRET
                                           # (never typed into chat or a file)
  supabase/dev/configure-auth.py google-id # change ONLY the Google client ID list (the secret stays as it is)

Uses the Supabase CLI login (the token the CLI keeps in the macOS Keychain) against the Management API.
The target is always the dev ref from mobile/config/environments.json; it refuses to run if that ref is the
project the repo's supabase/.temp link points at (production). "Skip nonce check" is never turned on.
"""
import getpass
import json
import pathlib
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENVS = json.loads((ROOT / "mobile/config/environments.json").read_text())
DEV = ENVS["development"]
DEV_REF = DEV["supabaseProjectRef"]
PROD_LINK = ROOT / "supabase/.temp/project-ref"
if PROD_LINK.exists() and PROD_LINK.read_text().strip() == DEV_REF:
    sys.exit("refusing: the repo's supabase link points at the dev project; expected production there")

def token() -> str:
    raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"],
                         capture_output=True, text=True).stdout.strip()
    if raw.startswith("go-keyring-base64:"):
        import base64
        raw = base64.b64decode(raw.split(":", 1)[1]).decode()
    if not raw:
        sys.exit("no Supabase CLI login found; run `supabase login`")
    return raw

def call(method: str, body=None):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{DEV_REF}/config/auth",
        method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json", "User-Agent": "racesignal-dev-setup"})
    return json.load(urllib.request.urlopen(req))

KEYS = ["external_apple_enabled", "external_apple_client_id", "external_apple_additional_client_ids",
        "external_google_enabled", "external_google_client_id", "external_google_skip_nonce_check",
        "security_manual_linking_enabled"]

def show(label: str):
    cfg = call("GET")
    print(f"{label} (development project {DEV_REF}):")
    for k in KEYS:
        print(f"  {k} = {cfg.get(k)}")
    print(f"  external_google_secret set = {bool(cfg.get('external_google_secret'))}")

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "status":
        show("current")
    elif cmd == "apple":
        call("PATCH", {"external_apple_enabled": True, "external_apple_client_id": DEV["bundleIdentifier"],
                       "security_manual_linking_enabled": True})
        show("after")
    elif cmd == "google":
        web = DEV["google"]["webClientId"]
        if not web:
            sys.exit("set development.google.webClientId in mobile/config/environments.json first")
        secret = getpass.getpass("Paste the Google WEB client secret (input hidden), then press Enter: ").strip()
        if not secret:
            sys.exit("empty secret; aborting")
        # Google sign-in uses Supabase's OAuth redirect flow, so only the Web client ID is needed.
        call("PATCH", {"external_google_enabled": True, "external_google_client_id": web,
                       "external_google_secret": secret, "external_google_skip_nonce_check": False,
                       "security_manual_linking_enabled": True})
        del secret
        show("after")
    elif cmd == "google-id":
        web = DEV["google"]["webClientId"]
        if not web:
            sys.exit("set development.google.webClientId in mobile/config/environments.json first")
        call("PATCH", {"external_google_client_id": web})
        show("after")
    else:
        sys.exit(__doc__)

main()
