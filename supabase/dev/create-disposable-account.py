#!/usr/bin/env python3
"""Creates ONE disposable account on the DEVELOPMENT Supabase project for a delete-account test, and saves its sign-in in
~/.racesignal-dev/disposable-account.txt (mode 600). Prints only the email address, never the password or any key.

  supabase/dev/create-disposable-account.py

The account is confirmed, has a finished profile (so password sign-in lands in the app, not onboarding) and no races. Sign in with the
email and password shown by `cat ~/.racesignal-dev/disposable-account.txt` in your own terminal. Refuses any project but development.
The account is meant to be deleted from Settings -> Delete account (that is the test); it is never a real or shared account.
"""
import base64
import json
import os
import pathlib
import secrets
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEV = json.loads((ROOT / "mobile/config/environments.json").read_text())["development"]["supabaseProjectRef"]
PROD = (ROOT / "supabase/.temp/project-ref").read_text().strip()
if DEV == PROD or DEV != "sjmixferxnkwbzkcofnp":
    sys.exit("refusing: the development project ref is not what was expected")
OUT = pathlib.Path.home() / ".racesignal-dev" / "disposable-account.txt"


def cli_token() -> str:
    raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], capture_output=True, text=True).stdout.strip()
    if raw.startswith("go-keyring-base64:"):
        raw = base64.b64decode(raw.split(":", 1)[1]).decode()
    return raw


def call(method, url, headers, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=60) as response:
        text = response.read().decode()
    return json.loads(text) if text else None


def main():
    token = cli_token()
    keys = call("GET", f"https://api.supabase.com/v1/projects/{DEV}/api-keys?reveal=true", {"Authorization": f"Bearer {token}", "User-Agent": "racesignal-dev-disposable"})
    service = next(k["api_key"] for k in keys if k.get("name") == "service_role")
    email = f"rc-disposable-{secrets.token_hex(4)}@example.com"
    password = secrets.token_urlsafe(18)
    base = f"https://{DEV}.supabase.co"
    headers = {"apikey": service, "Authorization": f"Bearer {service}"}
    user = call("POST", f"{base}/auth/v1/admin/users", headers, {"email": email, "password": password, "email_confirm": True})
    now = datetime.now(timezone.utc).isoformat()
    call("POST", f"{base}/rest/v1/athlete_profiles?on_conflict=id", {**headers, "Prefer": "resolution=merge-duplicates"},
         {"id": user["id"], "racing_name": "Disposable Test", "onboarding_completed_at": now, "initial_paywall_seen_at": now})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(OUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(f"email: {email}\npassword: {password}\nuser_id: {user['id']}\n")
    print(f"created the disposable development account {email} (credentials saved to {OUT})")


if __name__ == "__main__":
    main()
