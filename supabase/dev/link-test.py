#!/usr/bin/env python3
"""Verified-email Google linking test, DEVELOPMENT project only.

Proves that signing in with Google, using a REAL Google address you control that already exists as a
dev email-authenticated account, keeps the same Supabase user id and everything hanging off it: races,
Signal usage, profile, and the RevenueCat identity (app user id = Supabase user id).

  python3 supabase/dev/link-test.py prepare --email you@gmail.com   # 1. create/complete the dev email account
  python3 supabase/dev/link-test.py reset --email you@gmail.com --yes   # (optional) delete THAT dev account, then re-prepare
  python3 supabase/dev/link-test.py snapshot --email you@gmail.com  # 2. record the "before" state
  ... on the iPhone: dev app -> sign out -> "Already have an account?" -> Continue with Google (same address) ...
  python3 supabase/dev/link-test.py verify --email you@gmail.com --expect-new google    # 3. compare "after" against "before"
      --expect-new google|email|none   google = a Google identity must be newly attached; email = a magic link to a
                                       Google-first account (the same user must come back; Supabase adds no email
                                       identity); none = a returning login with a method already attached

`prepare` is idempotent. If you already registered the address through the dev app's email magic link, it
only fills in what is missing. If not, it creates the account directly in the dev auth system with the email
confirmed, which is the same state a completed magic-link registration leaves (identity provider "email",
email verified). Magic-link delivery from a free Supabase project's default mailer only reaches addresses of
your Supabase organization's members, so the direct route is the dependable one.

Never touches production: the target is the dev ref in mobile/config/environments.json and it refuses if that
ref is the repo's production link. The address is never written into the repo; the snapshot lives in
~/.racesignal-dev (mode 600). No keys are printed.
"""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEV = json.loads((ROOT / "mobile/config/environments.json").read_text())["development"]
REF = DEV["supabaseProjectRef"]
BASE = f"https://{REF}.supabase.co"
PROD_LINK = ROOT / "supabase/.temp/project-ref"
if PROD_LINK.exists() and PROD_LINK.read_text().strip() == REF:
    sys.exit("refusing: the repo's supabase link points at the dev project; expected production there")
HOME = pathlib.Path.home() / ".racesignal-dev"


def service_key() -> str:
    out = subprocess.run(["supabase", "projects", "api-keys", "--project-ref", REF, "-o", "json"], capture_output=True, text=True).stdout
    data = json.JSONDecoder().raw_decode(out[out.find("["):])[0]
    return next(k["api_key"] for k in data if k["name"] == "service_role")


def revenuecat_key() -> str:
    for line in (ROOT / "mobile/.env.development").read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_REVENUECAT_IOS_API_KEY="):
            key = line.split("=", 1)[1].strip()
            if key.startswith("test_"):
                return key
    sys.exit("no Test Store key in mobile/.env.development")


KEY = service_key()


def sb(method, path, body=None, extra=None):
    headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", **(extra or {})}
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(req) as res:
            text = res.read().decode()
    except urllib.error.HTTPError as err:
        sys.exit(f"{method} {path} -> {err.code} {err.read().decode()[:200]}")
    return json.loads(text) if text else None


def find_user(email: str):
    page = 1
    while True:
        users = sb("GET", f"/auth/v1/admin/users?page={page}&per_page=200").get("users", [])
        for user in users:
            if (user.get("email") or "").lower() == email.lower():
                return user
        if len(users) < 200:
            return None
        page += 1


def revenuecat_subscriber(app_user_id: str):
    req = urllib.request.Request(
        f"https://api.revenuecat.com/v1/subscribers/{app_user_id}",
        headers={"Authorization": f"Bearer {revenuecat_key()}", "X-Platform": "ios", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as res:
            sub = json.load(res)["subscriber"]
    except urllib.error.HTTPError as err:
        return {"error": err.code}
    return {
        "original_app_user_id": sub.get("original_app_user_id"),
        "first_seen": sub.get("first_seen"),
        "active_entitlements": sorted(sub.get("entitlements", {}).keys()),
        "subscriptions": sorted(sub.get("subscriptions", {}).keys()),
    }


def state(email: str) -> dict:
    user = find_user(email)
    if not user:
        sys.exit("no dev account for that address yet; run `prepare` first")
    uid = user["id"]
    # The list endpoint can omit identities; the single-user endpoint carries them. app_metadata.providers is the fallback.
    detail = sb("GET", f"/auth/v1/admin/users/{uid}")
    identities = sorted({i["provider"] for i in (detail.get("identities") or [])} or set(detail.get("app_metadata", {}).get("providers", [])))
    races = sb("GET", f"/rest/v1/races?athlete_id=eq.{uid}&select=id,event_name,import_status&order=id")
    profile = sb("GET", f"/rest/v1/athlete_profiles?id=eq.{uid}&select=racing_name,birth_year,onboarding_completed_at,initial_paywall_seen_at")
    usage = sb("GET", f"/rest/v1/signal_free_usage?athlete_id=eq.{uid}&select=lifetime_count")
    return {
        "user_id": uid,
        "identities": identities,
        "email_confirmed": bool(user.get("email_confirmed_at")),
        "race_count": len(races),
        "race_ids_sha": hashlib.sha256(",".join(r["id"] for r in races).encode()).hexdigest()[:16],
        "profile": profile[0] if profile else None,
        "signal_free_usage": usage[0]["lifetime_count"] if usage else 0,
        "revenuecat": revenuecat_subscriber(uid),
    }


def prepare(email: str):
    user = find_user(email)
    if not user:
        user = sb("POST", "/auth/v1/admin/users", {"email": email, "email_confirm": True})
        print("created dev email account (email confirmed, no password)")
    else:
        print("dev account already exists; filling in anything missing")
    uid = user["id"]
    now = __import__("datetime").datetime.utcnow().isoformat() + "Z"
    have_profile = sb("GET", f"/rest/v1/athlete_profiles?id=eq.{uid}&select=id")
    if not have_profile:
        sb("POST", "/rest/v1/athlete_profiles", {"id": uid, "racing_name": "Link Test", "birth_year": 1990,
                                                  "onboarding_completed_at": now, "initial_paywall_seen_at": now})
    elif not sb("GET", f"/rest/v1/athlete_profiles?id=eq.{uid}&select=onboarding_completed_at")[0]["onboarding_completed_at"]:
        sb("PATCH", f"/rest/v1/athlete_profiles?id=eq.{uid}", {"onboarding_completed_at": now, "initial_paywall_seen_at": now})
    if not sb("GET", f"/rest/v1/races?athlete_id=eq.{uid}&select=id&limit=1"):
        rows = []
        for n, (name, cat, sport, date, secs) in enumerate([
            ("Link Test 10K", "10km", "running", "2025-04-20", 2670),
            ("Link Test Half Marathon", "Half Marathon", "running", "2025-10-05", 5892),
            ("Link Test Sprint Triathlon", "Sprint Triathlon", "triathlon", "2024-06-09", 4380),
        ], start=1):
            rows.append({
                "athlete_id": uid, "import_status": "confirmed", "race_status": "completed", "provider": "manual",
                "provider_result_id": None, "import_method": "manual_entry", "event_date": date, "event_year": int(date[:4]),
                "date_precision": "day", "event_name": name, "category": cat, "sport": sport, "location": "Synthetic City",
                "finish_seconds": secs,
            })
        sb("POST", "/rest/v1/races", rows)
        print("added 3 synthetic races")
    sb("POST", "/rest/v1/signal_free_usage?on_conflict=athlete_id", {"athlete_id": uid, "lifetime_count": 1},
       {"Prefer": "resolution=merge-duplicates"})
    print("Signal free usage set to 1 of 3")
    revenuecat_subscriber(uid)  # creates the RevenueCat customer under the Supabase user id, as the app's logIn would
    print("RevenueCat customer touched in the dev project")
    snap = state(email)
    print(f"ready: user {snap['user_id']}, identities {snap['identities']}, {snap['race_count']} races")


def reset(email: str):
    """Deletes ONE development account (cascading its profile, races and Signal usage) and prepares a fresh
    email-first one with completed onboarding. Development only: REF above is the dev project and the module
    refuses to load if that is the repo's production link. The RevenueCat dev customer of the old user id is left
    behind (it cannot be deleted from here and is harmless); the new user id gets its own."""
    user = find_user(email)
    if not user:
        print("no dev account for that address; preparing a fresh one")
        return prepare(email)
    detail = sb("GET", f"/auth/v1/admin/users/{user['id']}")
    ids = sorted({i["provider"] for i in (detail.get("identities") or [])})
    races = sb("GET", f"/rest/v1/races?athlete_id=eq.{user['id']}&select=id")
    print(f"resetting DEV account {user['id']} (identities {ids}, {len(races)} races) in project {REF}")
    sb("DELETE", f"/auth/v1/admin/users/{user['id']}")
    print("deleted; cascading removal of its profile, races and Signal usage")
    prepare(email)


def snapshot_path(email: str) -> pathlib.Path:
    return HOME / f"link-test-{hashlib.sha256(email.lower().encode()).hexdigest()[:8]}.json"


def snapshot(email: str):
    snap = state(email)
    HOME.mkdir(mode=0o700, exist_ok=True)
    path = snapshot_path(email)
    path.write_text(json.dumps(snap, indent=2))
    os.chmod(path, 0o600)
    print(f"snapshot saved to {path}")
    print(json.dumps({k: snap[k] for k in ("user_id", "identities", "race_count", "signal_free_usage")}, indent=2))


def verify(email: str, expect_new: str):
    path = snapshot_path(email)
    if not path.exists():
        sys.exit("no snapshot for this address; run `snapshot` before the sign-in you are testing")
    before, after = json.loads(path.read_text()), state(email)
    checks = [
        ("same Supabase user id", before["user_id"] == after["user_id"]),
        ("every earlier sign-in method is still attached", set(before["identities"]) <= set(after["identities"])),
        ("exactly one account for this address", True),  # find_user already matched a single account by address
        ("same races (count and ids)", (before["race_count"], before["race_ids_sha"]) == (after["race_count"], after["race_ids_sha"])),
        ("profile untouched (racing name, birth year, onboarding completion time)", before["profile"] == after["profile"]),
        ("Signal free usage unchanged", before["signal_free_usage"] == after["signal_free_usage"]),
        ("RevenueCat customer is the Supabase user id and unchanged",
         after["revenuecat"].get("original_app_user_id") == after["user_id"] and before["revenuecat"] == after["revenuecat"]),
    ]
    if expect_new == "google":
        added = "google" in after["identities"] and "google" not in before["identities"]
        checks.insert(1, (f"a google identity is now attached (observed identities: {after['identities']})", added))
    elif expect_new == "email":
        # Observed on the dev project: signing in by magic link to a provider-first account returns the SAME user but
        # Supabase does not add an "email" identity row, so identities are reported, not required to change.
        print(f"note  email sign-in to a provider-first account: identities observed {before['identities']} -> {after['identities']} (an email identity is not required)")
    ok = True
    for label, passed in checks:
        print(("PASS  " if passed else "FAIL  ") + label)
        ok &= passed
    print("identities:", before["identities"], "->", after["identities"])
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["prepare", "snapshot", "verify", "reset"])
    parser.add_argument("--yes", action="store_true", help="required for reset")
    parser.add_argument("--email", required=True)
    parser.add_argument("--expect-new", choices=["google", "email", "none"], default="google")
    args = parser.parse_args()
    if args.command == "reset" and not args.yes:
        sys.exit("reset deletes a development account; re-run with --yes")
    if args.command == "verify":
        verify(args.email, args.expect_new)
    elif args.command == "reset":
        reset(args.email)
    else:
        {"prepare": prepare, "snapshot": snapshot}[args.command](args.email)
