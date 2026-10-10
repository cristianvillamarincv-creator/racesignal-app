#!/usr/bin/env python3
"""DRY RUN ONLY: reports which RevenueCat customers in the DEVELOPMENT project belong to no RaceSignal account.

  supabase/dev/revenuecat-backfill-dryrun.py --project-id <RevenueCat dev project id>

This script cannot delete anything. It has no delete code path, makes only GET requests to RevenueCat, and runs one SELECT against
the development database. Deleting existing customers is a separate step that needs its own approval and its own change.

What it does: lists every RevenueCat customer, lists the development database's account ids, and sorts the customers into
  matched          the customer's id is a current account (never a candidate)
  anonymous        a `$RCAnonymousID:` customer (an install that never signed in; no account id; not a candidate)
  orphan           an account-id customer with NO matching account: the leftovers of deleted accounts. Each is checked for an
                   active entitlement and for purchases/subscriptions so that anything with purchase history is flagged for review
Ids are shown as their first 8 characters only. The RevenueCat key is read from a hidden prompt (never an argument, an environment
variable or a file) and is never printed. It refuses to run against anything but the development database.
"""
import argparse
import base64
import getpass
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
API = "https://api.revenuecat.com"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def classify(customer_id: str, account_ids: set) -> str:
    """matched | anonymous | orphan | other (an id that is neither an account-id shape nor an anonymous id)."""
    if customer_id.startswith("$RCAnonymousID:"):
        return "anonymous"
    if UUID_RE.match(customer_id):
        return "matched" if customer_id in account_ids else "orphan"
    return "other"


def review_flag(entitlements: "int|None", purchases: "int|None", subscriptions: "int|None") -> str:
    """'candidate' only when every check ran and found nothing; any purchase data or any unavailable check means 'review'."""
    counts = [entitlements, purchases, subscriptions]
    if any(c is None for c in counts):
        return "review: a check was unavailable"
    return "review: has purchase data" if any(c > 0 for c in counts) else "candidate: no purchase data"


def summarize(customers: list, account_ids: set, checks: dict) -> dict:
    out = {"matched": 0, "anonymous": 0, "other": 0, "orphans": []}
    for cid in customers:
        kind = classify(cid, account_ids)
        if kind == "orphan":
            e, p, s = checks.get(cid, (None, None, None))
            out["orphans"].append((cid, review_flag(e, p, s)))
        else:
            out[kind] += 1
    return out


def dev_account_ids() -> set:
    envs = json.loads((ROOT / "mobile/config/environments.json").read_text())
    dev = envs["development"]["supabaseProjectRef"]
    prod = (ROOT / "supabase/.temp/project-ref").read_text().strip()
    if dev == prod or dev != "sjmixferxnkwbzkcofnp":
        raise SystemExit("refusing: the development project ref is not what was expected")
    raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], capture_output=True, text=True).stdout.strip()
    if raw.startswith("go-keyring-base64:"):
        raw = base64.b64decode(raw.split(":", 1)[1]).decode()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{dev}/database/query", method="POST",
        data=json.dumps({"query": "select id from auth.users"}).encode(),
        headers={"Authorization": f"Bearer {raw}", "Content-Type": "application/json", "User-Agent": "racesignal-dev-backfill-dryrun"})
    return {row["id"] for row in json.load(urllib.request.urlopen(req))}


def rc_get(url: str, key: str):
    if urllib.parse.urlparse(url).hostname != "api.revenuecat.com":
        raise SystemExit("refusing: not a RevenueCat URL")
    req = urllib.request.Request(url, method="GET", headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as err:
        return err.code, None


def count_items(project: str, customer: str, resource: str, key: str):
    status, body = rc_get(f"{API}/v2/projects/{project}/customers/{urllib.parse.quote(customer, safe='')}/{resource}?limit=1", key)
    if status != 200 or body is None:
        return None
    return len(body.get("items", []))


def main():
    parser = argparse.ArgumentParser(description="DRY RUN: which RevenueCat dev customers belong to no account")
    parser.add_argument("--project-id", required=True)
    args = parser.parse_args()
    key = getpass.getpass("RevenueCat key for the DEVELOPMENT project (input hidden): ").strip()
    if not key:
        raise SystemExit("no key entered")
    accounts = dev_account_ids()
    customers, url = [], f"{API}/v2/projects/{args.project_id}/customers?limit=100"
    while url:
        status, body = rc_get(url, key)
        if status != 200 or body is None:
            raise SystemExit(f"listing customers failed with status {status}")
        customers += [c["id"] for c in body.get("items", [])]
        nxt = body.get("next_page")
        url = (API + nxt) if nxt and nxt.startswith("/") else nxt
    checks = {}
    for cid in customers:
        if classify(cid, accounts) == "orphan":
            checks[cid] = (count_items(args.project_id, cid, "active_entitlements", key), count_items(args.project_id, cid, "purchases", key),
                           count_items(args.project_id, cid, "subscriptions", key))
    result = summarize(customers, accounts, checks)
    print("DRY RUN. Nothing was changed or deleted.")
    print(f"customers: {len(customers)}  matched to an account: {result['matched']}  anonymous: {result['anonymous']}  other: {result['other']}  orphans: {len(result['orphans'])}")
    for cid, flag in result["orphans"]:
        print(f"  orphan {cid[:8]}…  {flag}")
    print("Account ids in the database:", len(accounts))


if __name__ == "__main__":
    sys.exit(main())
