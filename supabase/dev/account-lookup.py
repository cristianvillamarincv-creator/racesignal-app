#!/usr/bin/env python3
"""Read-only: where does an email's account exist, and what is its state? Development AND production.

  python3 supabase/dev/account-lookup.py you@gmail.com

Runs ONE fixed SELECT through the Supabase Management API (the CLI login) against each project: user id,
email confirmation, linked identities, onboarding status, race count, Signal free usage. It cannot write: the
query is a constant in this file, nothing is interpolated except the (quote-escaped) address, and no service-role
key is fetched. It prints ids and counts only (no tokens, no race contents). Use it to tell a separate-environment
account from a duplicate account in the SAME project.
"""
import base64
import json
import pathlib
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEV = json.loads((ROOT / "mobile/config/environments.json").read_text())["development"]["supabaseProjectRef"]
PROD = (ROOT / "supabase/.temp/project-ref").read_text().strip()
if DEV == PROD:
    sys.exit("refusing: the repo link points at the dev project; expected production there")

QUERY = """
select u.id, u.email, (u.email_confirmed_at is not null) as email_confirmed, u.created_at, u.last_sign_in_at,
 (select coalesce(json_agg(json_build_object('provider', i.provider, 'email_verified', i.identity_data->>'email_verified',
    'attached', i.created_at) order by i.created_at), '[]'::json) from auth.identities i where i.user_id = u.id) as identities,
 (select row_to_json(p) from (select created_at as profile_created, onboarding_completed_at from public.athlete_profiles
    where id = u.id) p) as profile,
 (select count(*) from public.races r where r.athlete_id = u.id) as races,
 (select lifetime_count from public.signal_free_usage f where f.athlete_id = u.id) as signal_free_usage
from auth.users u
where lower(u.email) = lower('{email}')
   or exists (select 1 from auth.identities i where i.user_id = u.id and lower(i.identity_data->>'email') = lower('{email}'))
order by u.created_at
"""


def token() -> str:
    raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], capture_output=True, text=True).stdout.strip()
    if raw.startswith("go-keyring-base64:"):
        raw = base64.b64decode(raw.split(":", 1)[1]).decode()
    if not raw:
        sys.exit("no Supabase CLI login found; run `supabase login`")
    return raw


def run(ref: str, email: str):
    sql = QUERY.format(email=email.replace("'", "''"))
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query", method="POST", data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json", "User-Agent": "racesignal-account-lookup"})
    return json.load(urllib.request.urlopen(req))


if len(sys.argv) != 2 or "@" not in sys.argv[1]:
    sys.exit(__doc__)
for label, ref in (("DEVELOPMENT", DEV), ("PRODUCTION (read-only)", PROD)):
    rows = run(ref, sys.argv[1])
    print(f"== {label}: {len(rows)} account(s) for this address")
    for r in rows:
        print(json.dumps(r, indent=1, default=str))
