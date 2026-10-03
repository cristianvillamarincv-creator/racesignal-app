#!/usr/bin/env python3
"""Development-only email delivery: send the dev project's auth emails through a Gmail account's SMTP.

Why: a free Supabase project's default mailer only delivers to addresses that are members of your Supabase
organization, and allows only a couple of emails per hour. With custom SMTP any address works (a magic link to a test
address) and the hourly limit is yours to set.

  python3 supabase/dev/set-dev-smtp.py enable   # prompts silently for the Gmail address and its APP PASSWORD
  python3 supabase/dev/set-dev-smtp.py disable  # back to Supabase's default mailer
  python3 supabase/dev/set-dev-smtp.py status

Gmail app password: Google Account -> Security -> 2-Step Verification (must be on) -> App passwords -> create one named
"RaceSignal Dev SMTP". It is a 16-character secret: paste it only into the hidden prompt below, never into chat.
Targets only the dev project (mobile/config/environments.json) and refuses if that is the repo's production link.
Production email settings are never touched.
"""
import base64
import getpass
import json
import pathlib
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
REF = json.loads((ROOT / "mobile/config/environments.json").read_text())["development"]["supabaseProjectRef"]
LINK = ROOT / "supabase/.temp/project-ref"
if LINK.exists() and LINK.read_text().strip() == REF:
    sys.exit("refusing: the repo's supabase link points at the dev project; expected production there")


def token() -> str:
    raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], capture_output=True, text=True).stdout.strip()
    if raw.startswith("go-keyring-base64:"):
        raw = base64.b64decode(raw.split(":", 1)[1]).decode()
    return raw or sys.exit("no Supabase CLI login found; run `supabase login`")


def call(method, body=None):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/config/auth", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json", "User-Agent": "racesignal-dev-smtp"})
    return json.load(urllib.request.urlopen(req))


def status():
    c = call("GET")
    print(f"dev project {REF}: smtp_host={c.get('smtp_host')} smtp_port={c.get('smtp_port')} smtp_admin_email={c.get('smtp_admin_email')} "
          f"smtp_pass set={bool(c.get('smtp_pass'))} rate_limit_email_sent={c.get('rate_limit_email_sent')}")


cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
if cmd == "status":
    status()
elif cmd == "enable":
    address = input("Gmail address that will send the emails (e.g. cristian.flipd@gmail.com): ").strip()
    password = getpass.getpass("Gmail APP PASSWORD (input hidden): ").replace(" ", "").strip()
    if "@" not in address or len(password) < 12:
        sys.exit("need the Gmail address and the 16-character app password")
    call("PATCH", {"smtp_host": "smtp.gmail.com", "smtp_port": "465", "smtp_user": address, "smtp_pass": password,
                   "smtp_admin_email": address, "smtp_sender_name": "RaceSignal Dev", "rate_limit_email_sent": 30})
    del password
    status()
elif cmd == "disable":
    call("PATCH", {"smtp_host": None, "smtp_port": None, "smtp_user": None, "smtp_pass": None, "smtp_admin_email": None, "smtp_sender_name": None})
    status()
else:
    sys.exit(__doc__)
