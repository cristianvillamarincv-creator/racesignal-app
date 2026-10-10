#!/usr/bin/env python3
"""Schedules (or removes) the automatic RevenueCat cleanup sweep on the PRODUCTION Supabase project. For owner review; nothing here runs on its own.

  supabase/prod/schedule-revenuecat-cleanup.py status                    # read-only: the job, its recent runs, the HTTP answers, open requests (counts)
  supabase/prod/schedule-revenuecat-cleanup.py verify                    # read-only: exits non-zero unless the job exists, holds no key and its latest run succeeded
  supabase/prod/schedule-revenuecat-cleanup.py apply [--cadence CRON]    # DRY RUN: checks the preconditions and shows exactly what would be created
  supabase/prod/schedule-revenuecat-cleanup.py apply --apply [...]       # the real change, after you type a confirmation phrase
  supabase/prod/schedule-revenuecat-cleanup.py remove [--apply]          # rollback (dry run unless --apply): unschedules the job and deletes its Vault secret

What it does, and nothing else: it enables the `pg_cron` and `pg_net` extensions, stores the project's service key in Supabase Vault and creates
one pg_cron job (`revenuecat-cleanup`, every 30 minutes by default) that POSTs to the project's own `revenuecat-cleanup` function. It does not
apply a migration, set a secret or deploy a function; those are separate, earlier steps and this refuses to run until they are done.

Safety design:
  * The target is the production project in supabase/.temp/project-ref, shown first; it must equal the expected production ref.
  * Read-only calls (status, verify, the dry run) send only SELECT statements; the service key is not even fetched in a dry run.
  * `apply --apply` refuses unless: migration 0012's table exists, both RevenueCat secrets exist, the `revenuecat-cleanup` function is deployed,
    and no such job or Vault secret exists yet. It requires the exact phrase, keeps the key only in Vault (never in the job text, an argument, a
    file or the output) and reads the result back (job active, schedule as asked, no key in the job text).
  * It does not run the job; the first scheduled run is checked afterwards with `verify`.
"""
import argparse
import importlib.util
import pathlib
import sys

if "prodlib" not in sys.modules:  # one shared instance, so the scripts and their tests raise and catch the same Abort
    _spec = importlib.util.spec_from_file_location("prodlib", pathlib.Path(__file__).with_name("prodlib.py"))
    _module = importlib.util.module_from_spec(_spec)
    sys.modules["prodlib"] = _module
    _spec.loader.exec_module(_module)
lib = sys.modules["prodlib"]
Abort = lib.Abort

JOB = "revenuecat-cleanup"
SECRET = "revenuecat_cleanup_service_key"
DEFAULT_CADENCE = "*/30 * * * *"
APPLY_PHRASE = "SCHEDULE PRODUCTION REVENUECAT CLEANUP"
REMOVE_PHRASE = "REMOVE PRODUCTION REVENUECAT SCHEDULE"


def valid_cadence(value: str) -> str:
    parts = value.split()
    allowed = set("0123456789*/,-")
    if len(parts) != 5 or any(not p or set(p) - allowed for p in parts):
        raise Abort(f"not a 5-field cron expression: {value!r}")
    return value


def job_sql(ref: str) -> str:
    return (f"select net.http_post(url := 'https://{ref}.supabase.co/functions/v1/revenuecat-cleanup', "
            f"headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', (select decrypted_secret from vault.decrypted_secrets where name = '{SECRET}')), "
            f"body := '{{}}'::jsonb, timeout_milliseconds := 25000)")


def preconditions(api, ref) -> dict:
    """Read-only. Returns what is and is not in place."""
    table = lib.sql_select(api, ref, "select to_regclass('public.revenuecat_deletion_requests') is not null as present")[0]["present"]
    secrets = lib.secrets_of(api, ref)
    functions = {f.get("slug") for f in api("GET", f"/projects/{ref}/functions")}
    exts = {r["name"]: r["installed_version"] for r in lib.sql_select(api, ref, "select name, installed_version from pg_available_extensions where name in ('pg_cron','pg_net','supabase_vault')")}
    installed = {r["extname"] for r in lib.sql_select(api, ref, "select extname from pg_extension")}
    job = {}
    if "pg_cron" in installed:
        rows = lib.sql_select(api, ref, f"select jobid, schedule, active, command from cron.job where jobname = '{JOB}'")
        job = rows[0] if rows else {}
    vault = lib.sql_select(api, ref, f"select count(*) as n from vault.secrets where name = '{SECRET}'")[0]["n"] if "supabase_vault" in installed else 0
    return {
        "table": bool(table), "secrets": all(n in secrets for n in lib.SECRET_NAMES), "function": JOB in functions,
        "extensions_available": all(e in exts for e in ("pg_cron", "pg_net")), "table_checked": True,
        "installed": installed, "job": job, "vault_secret": int(vault) > 0,
    }


def show_status(api, ref, out) -> dict:
    installed = {r["extname"] for r in lib.sql_select(api, ref, "select extname from pg_extension")}
    state = {"job": None, "last_run": None, "last_http": None, "key_in_job": False}
    if "pg_cron" not in installed:
        out("pg_cron is not installed: no job exists.")
        return state
    jobs = lib.sql_select(api, ref, f"select jobid, schedule, active, command from cron.job where jobname = '{JOB}'")
    if not jobs:
        out("No 'revenuecat-cleanup' job exists.")
        return state
    job = jobs[0]
    state["job"] = job
    state["key_in_job"] = any(marker in job["command"] for marker in ("eyJ", "sb_secret", "sk_"))
    out(f"job: schedule {job['schedule']}, active {job['active']}; job text contains a key: {state['key_in_job']}")
    runs = lib.sql_select(api, ref, f"select r.start_time, r.status from cron.job_run_details r where r.jobid = {int(job['jobid'])} order by r.start_time desc limit 6")
    out("recent runs: " + ("; ".join(f"{r['start_time']} {r['status']}" for r in runs) if runs else "none yet"))
    state["last_run"] = runs[0]["status"] if runs else None
    if "pg_net" in installed:
        http = lib.sql_select(api, ref, "select created, status_code, left(content::text, 200) as body from net._http_response order by created desc limit 3")
        out("latest HTTP answers: " + ("; ".join(f"{h['created']} {h['status_code']} {h['body']}" for h in http) if http else "none yet"))
        state["last_http"] = http[0]["status_code"] if http else None
    if lib.sql_select(api, ref, "select to_regclass('public.revenuecat_deletion_requests') is not null as present")[0]["present"]:
        counts = lib.sql_select(api, ref, "select status, count(*) as n from public.revenuecat_deletion_requests group by status order by status")
        out("requests by status: " + (", ".join(f"{c['status']} {c['n']}" for c in counts) if counts else "none"))
    return state


def run(argv, *, api=lib.management_api, ask=input, cfg=None, out=print):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("command", choices=["status", "verify", "apply", "remove"])
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--cadence", default=DEFAULT_CADENCE)
    args = parser.parse_args(argv)
    cfg = cfg or lib.load_config()
    name, status = lib.target(api, cfg)
    ref = cfg["prod_ref"]
    out(f"Target: PRODUCTION project '{name}' ({ref}), status {status}.")

    if args.command == "status":
        show_status(api, ref, out)
        out("Nothing was changed.")
        return 0

    if args.command == "verify":
        state = show_status(api, ref, out)
        problems = []
        if not state["job"]:
            problems.append("the job does not exist")
        else:
            if not state["job"]["active"]:
                problems.append("the job is not active")
            if state["key_in_job"]:
                problems.append("the job text contains a key")
            if state["last_run"] != "succeeded":
                problems.append(f"the latest run is {state['last_run'] or 'missing (no run yet)'}")
            if state["last_http"] != 200:
                problems.append(f"the latest HTTP answer is {state['last_http'] or 'missing'}")
        if problems:
            out("NOT VERIFIED: " + "; ".join(problems))
            return 1
        out("VERIFIED: the job is active, holds no key, and its latest run succeeded with HTTP 200.")
        return 0

    pre = preconditions(api, ref)

    if args.command == "remove":
        if not pre["job"] and not pre["vault_secret"]:
            out("No job and no Vault secret exist; nothing to remove.")
            return 0
        out(f"Would unschedule job '{JOB}' ({'present' if pre['job'] else 'absent'}) and delete the Vault secret '{SECRET}' ({'present' if pre['vault_secret'] else 'absent'}). The extensions stay installed.")
        if not args.apply:
            out("DRY RUN: nothing was changed. Re-run with --apply to roll back.")
            return 0
        if ask(f"Type exactly '{REMOVE_PHRASE}' to continue: ").strip() != REMOVE_PHRASE:
            raise Abort("confirmation phrase not typed; nothing was changed")
        if pre["job"]:
            lib.sql_write(api, ref, f"select cron.unschedule('{JOB}')")
        lib.sql_write(api, ref, f"delete from vault.secrets where name = '{SECRET}'")
        after = preconditions(api, ref)
        if after["job"] or after["vault_secret"]:
            raise Abort("read-back did not match expectations: the job or the Vault secret is still there")
        out("Removed. Read-back: no job and no Vault secret remain.")
        return 0

    # apply
    cadence = valid_cadence(args.cadence)
    missing = [label for label, ok in (("migration 0012 (the revenuecat_deletion_requests table)", pre["table"]),
                                       ("both RevenueCat secrets (set-revenuecat-secrets.py)", pre["secrets"]),
                                       ("the revenuecat-cleanup function deployed", pre["function"]),
                                       ("pg_cron and pg_net available", pre["extensions_available"])) if not ok]
    if missing:
        raise Abort("refusing: these steps are not done yet: " + "; ".join(missing))
    if pre["job"] or pre["vault_secret"]:
        raise Abort("refusing: a job or Vault secret already exists (use `status`, or `remove --apply` first if you mean to replace it)")
    out("Preconditions met: the table exists, both secrets exist, the function is deployed, no job or Vault secret exists yet.")
    out("Would do, in order:")
    out("  1. create extension pg_cron; create extension pg_net (if not installed)")
    out(f"  2. store the project's service key in Vault as '{SECRET}' (never printed, never in the job text)")
    out(f"  3. cron.schedule('{JOB}', '{cadence}', <the HTTP call below>)")
    out("     " + job_sql(ref))
    if not args.apply:
        out("DRY RUN: nothing was changed (and the service key was not fetched). Re-run with --apply to schedule it.")
        return 0
    if ask(f"Type exactly '{APPLY_PHRASE}' to schedule it on production: ").strip() != APPLY_PHRASE:
        raise Abort("confirmation phrase not typed; nothing was changed")
    keys = api("GET", f"/projects/{ref}/api-keys?reveal=true")
    service = next((k["api_key"] for k in keys if k.get("name") == "service_role" and k.get("api_key")), None)
    if not service:
        raise Abort("no service-role key found; nothing was changed")
    escaped = service.replace("'", "''")
    lib.sql_write(api, ref, "create extension if not exists pg_cron; create extension if not exists pg_net;")
    lib.sql_write(api, ref, f"select vault.create_secret('{escaped}', '{SECRET}', 'Service key used by the revenuecat-cleanup schedule')")
    lib.sql_write(api, ref, f"select cron.schedule('{JOB}', '{cadence}', $job$ {job_sql(ref)} $job$)")
    after = preconditions(api, ref)
    job = after["job"]
    if not job or not job["active"] or job["schedule"] != cadence or any(m in job["command"] for m in (service[:20], "sb_secret")) or not after["vault_secret"]:
        raise Abort("read-back mismatch; run `remove --apply` to roll back")
    out(f"Scheduled. Read-back: job '{JOB}' is active with schedule '{cadence}', its text holds no key, and the key is in Vault.")
    out("Not run yet. After the first scheduled time, check it with: supabase/prod/schedule-revenuecat-cleanup.py verify")
    out("Rollback: supabase/prod/schedule-revenuecat-cleanup.py remove --apply")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run(sys.argv[1:]))
    except Abort as err:
        print(f"Stopped: {err}", file=sys.stderr)
        sys.exit(1)
