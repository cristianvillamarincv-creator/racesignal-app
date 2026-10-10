#!/usr/bin/env python3
"""Schedules (or removes) the automatic RevenueCat cleanup sweep on the DEVELOPMENT Supabase project only.

  supabase/dev/schedule-revenuecat-cleanup.py status                    # read-only: the job, its recent runs and the HTTP answers
  supabase/dev/schedule-revenuecat-cleanup.py apply [--cadence CRON]    # installs the job (default every 30 minutes)
  supabase/dev/schedule-revenuecat-cleanup.py remove                    # unschedules the job and deletes its Vault secret

How it works: pg_cron runs `net.http_post` (pg_net) against the project's own `revenuecat-cleanup` function. The service key it
presents is kept in Supabase Vault (never in the job text, a migration or the repo); this script reads it from the Management API
with your CLI login and writes it straight into Vault without printing it. This is deliberately NOT a migration: the URL and key are
per-project, and a migration would also run on production. Production gets its own, separately approved, step.
"""
import argparse
import base64
import json
import pathlib
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEV = json.loads((ROOT / "mobile/config/environments.json").read_text())["development"]["supabaseProjectRef"]
PROD = (ROOT / "supabase/.temp/project-ref").read_text().strip()
if DEV == PROD or DEV != "sjmixferxnkwbzkcofnp":
    sys.exit("refusing: the development project ref is not what was expected")
JOB = "revenuecat-cleanup"
SECRET = "revenuecat_cleanup_service_key"
DEFAULT_CADENCE = "*/30 * * * *"


def token() -> str:
    raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], capture_output=True, text=True).stdout.strip()
    if raw.startswith("go-keyring-base64:"):
        raw = base64.b64decode(raw.split(":", 1)[1]).decode()
    if not raw:
        sys.exit("no Supabase CLI login found")
    return raw


def api(method: str, path: str, body=None):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json", "User-Agent": "racesignal-dev-schedule"})
    with urllib.request.urlopen(req, timeout=60) as response:
        text = response.read().decode()
    return json.loads(text) if text else None


def sql(query: str):
    return api("POST", f"/projects/{DEV}/database/query", {"query": query})


def service_key() -> str:
    for key in api("GET", f"/projects/{DEV}/api-keys?reveal=true"):
        if key.get("name") == "service_role" and key.get("api_key"):
            return key["api_key"]
    sys.exit("no service-role key found")


def valid_cadence(value: str) -> str:
    parts = value.split()
    allowed = set("0123456789*/,-")
    if len(parts) != 5 or any(not p or set(p) - allowed for p in parts):
        sys.exit(f"not a 5-field cron expression: {value!r}")
    return value


def status():
    jobs = sql(f"select jobid, schedule, active, command from cron.job where jobname = '{JOB}'")
    print("job:", json.dumps([{k: v for k, v in j.items() if k != "command"} for j in jobs]))
    print("job text contains a key:", any("eyJ" in j["command"] or "sb_secret" in j["command"] for j in jobs))
    print("recent runs:")
    for r in sql(f"select r.start_time, r.status, left(coalesce(r.return_message,''),60) as message from cron.job_run_details r join cron.job j on j.jobid = r.jobid where j.jobname = '{JOB}' order by r.start_time desc limit 8"):
        print(" ", r["start_time"], r["status"], r["message"])
    print("HTTP answers (latest):")
    for r in sql("select created, status_code, left(content::text, 220) as body from net._http_response order by created desc limit 5"):
        print(" ", r["created"], r["status_code"], r["body"])


def apply(cadence: str):
    key = service_key().replace("'", "''")
    sql("create extension if not exists pg_cron; create extension if not exists pg_net;")
    sql(f"""do $$ begin
  if exists (select 1 from vault.secrets where name = '{SECRET}') then
    perform vault.update_secret((select id from vault.secrets where name = '{SECRET}'), '{key}');
  else
    perform vault.create_secret('{key}', '{SECRET}', 'Service key used by the revenuecat-cleanup schedule (development)');
  end if; end $$;""")
    sql(f"""select cron.schedule('{JOB}', '{valid_cadence(cadence)}', $job$
  select net.http_post(
    url := 'https://{DEV}.supabase.co/functions/v1/revenuecat-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', (select decrypted_secret from vault.decrypted_secrets where name = '{SECRET}')),
    body := '{{}}'::jsonb,
    timeout_milliseconds := 25000) $job$)""")
    print(f"scheduled '{JOB}' ({cadence}) on the development project {DEV}")
    status()


def remove():
    sql(f"select cron.unschedule('{JOB}') where exists (select 1 from cron.job where jobname = '{JOB}')")
    sql(f"delete from vault.secrets where name = '{SECRET}'")
    print("removed the job and the Vault secret")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status", "apply", "remove"])
    parser.add_argument("--cadence", default=DEFAULT_CADENCE)
    args = parser.parse_args()
    {"status": status, "apply": lambda: apply(args.cadence), "remove": remove}[args.command]()
