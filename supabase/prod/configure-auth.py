#!/usr/bin/env python3
"""Turns on Sign in with Apple, Google sign-in and manual identity linking on the PRODUCTION Supabase project. For owner review; nothing here runs on its own.

  supabase/prod/configure-auth.py status               # read-only: the relevant production auth settings and whether they still equal the pre-change baseline
  supabase/prod/configure-auth.py apply                # DRY RUN: checks the preconditions and shows exactly which settings would change
  supabase/prod/configure-auth.py apply --apply        # the real change, after you type a confirmation phrase (Google client secret at a hidden prompt)
  supabase/prod/configure-auth.py rollback             # DRY RUN of the rollback
  supabase/prod/configure-auth.py rollback --apply     # rollback to the baseline values, after you type a confirmation phrase

What it changes (one Management API PATCH of /config/auth) and nothing else:
  external_apple_enabled  false -> true,  external_apple_client_id  null -> com.cristianvillamarin.racesignal   (native Sign in with Apple; no secret needed)
  external_google_enabled false -> true,  external_google_client_id null -> <the Web client ID>,
  external_google_secret  (unset) -> <the Web client secret, hidden prompt>,  external_google_skip_nonce_check -> false  (Google uses the browser OAuth flow)
  security_manual_linking_enabled false -> true
It does not touch the site URL, the redirect allow list, SMTP, rate limits, email settings or any other key, and it never turns "skip nonce check" on.

Safety design:
  * Target: the production project in supabase/.temp/project-ref, shown first; it must equal the expected production ref and not be development.
  * `apply` refuses unless: the target keys still hold their baseline values (nothing is half-configured), the four APPLE_* function secrets exist, the website's
    homepage and privacy page answer 200 over HTTPS, and the Web client ID is well formed. The preconditions it cannot see (Audience says In production,
    the app build is not yet shipping) are printed for you to confirm.
  * The Google client secret is typed at a HIDDEN prompt (never an argument, environment variable or file) and goes to the Management API from memory;
    it is never printed.
  * Before the PATCH it saves the non-secret target values to a private file (~/.racesignal-prod/auth-before-<time>.json, mode 600) for the rollback.
  * After the PATCH it re-reads the whole config: every target key must hold its new value and EVERY OTHER key must equal what it was before; any other
    difference stops it and tells you to roll back.
  * Rollback restores the target keys to their baseline values (or the saved file), clears the Google secret, and checks the same way.
"""
import argparse
import datetime
import getpass
import importlib.util
import json
import os
import pathlib
import re
import sys
import urllib.request

if "prodlib" not in sys.modules:  # one shared instance, so the scripts and their tests raise and catch the same Abort
    _spec = importlib.util.spec_from_file_location("prodlib", pathlib.Path(__file__).with_name("prodlib.py"))
    _module = importlib.util.module_from_spec(_spec)
    sys.modules["prodlib"] = _module
    _spec.loader.exec_module(_module)
lib = sys.modules["prodlib"]
Abort = lib.Abort

APPLY_PHRASE = "CHANGE PRODUCTION AUTH SETTINGS"
ROLLBACK_PHRASE = "ROLL BACK PRODUCTION AUTH SETTINGS"
PROD_BUNDLE_ID = "com.cristianvillamarin.racesignal"
SITE = "https://racesignal.app"
SAVE_DIR = pathlib.Path.home() / ".racesignal-prod"

# The values the target keys hold before the change (captured read-only 2026-10-08 and re-checked 2026-10-10).
BASELINE = {
    "external_apple_enabled": False,
    "external_apple_client_id": None,
    "external_google_enabled": False,
    "external_google_client_id": None,
    "external_google_skip_nonce_check": None,  # unset; false is its default, so false counts as equal
    "security_manual_linking_enabled": False,
}
TARGET_KEYS = list(BASELINE) + ["external_google_secret"]
WATCHED = ["external_apple_additional_client_ids", "external_apple_secret", "external_apple_email_optional",
           "external_google_additional_client_ids", "external_google_email_optional"]  # must not change either


def same(key: str, a, b) -> bool:
    if key == "external_google_skip_nonce_check":
        return bool(a) == bool(b)
    return a == b


def config_path(ref: str) -> str:
    return f"/projects/{ref}/config/auth"


def web_client_id() -> str:
    envs = json.loads((lib.ROOT / "mobile/config/environments.json").read_text())
    value = envs["production"].get("google", {}).get("webClientId") or envs["development"]["google"]["webClientId"]
    if not re.fullmatch(r"\d+-[a-z0-9]+\.apps\.googleusercontent\.com", value or ""):
        raise Abort("the Google Web client ID in mobile/config/environments.json is missing or malformed")
    return value


def expected_after(web: str) -> dict:
    return {"external_apple_enabled": True, "external_apple_client_id": PROD_BUNDLE_ID, "external_google_enabled": True,
            "external_google_client_id": web, "external_google_skip_nonce_check": False, "security_manual_linking_enabled": True}


def site_status(path: str) -> int:
    req = urllib.request.Request(SITE + path, method="GET", headers={"User-Agent": "racesignal-prod-auth-check"})
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status
    except Exception as err:  # noqa: BLE001
        return getattr(err, "code", 0)


def show(config: dict, out) -> None:
    for k in TARGET_KEYS + WATCHED:
        v = config.get(k)
        out(f"  {k} = {'<set>' if k in ('external_google_secret', 'external_apple_secret') and v else v}")


def run(argv, *, api=lib.management_api, ask=input, ask_secret=getpass.getpass, cfg=None, out=print, url_status=site_status,
        now=lambda: datetime.datetime.now(datetime.timezone.utc), save_dir=SAVE_DIR, web=None):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("command", choices=["status", "apply", "rollback"])
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    cfg = cfg or lib.load_config()
    name, status = lib.target(api, cfg)
    ref = cfg["prod_ref"]
    out(f"Target: PRODUCTION project '{name}' ({ref}), status {status}.")
    before = api("GET", config_path(ref))

    if args.command == "status":
        show(before, out)
        at_baseline = all(same(k, before.get(k), v) for k, v in BASELINE.items()) and not before.get("external_google_secret")
        out("Equals the pre-change baseline: " + ("yes (nothing configured yet)" if at_baseline else "NO (already changed)") + ". Nothing was changed.")
        return 0

    if args.command == "rollback":
        saved = sorted(save_dir.glob("auth-before-*.json")) if save_dir.exists() else []
        values = json.loads(saved[-1].read_text()) if saved else dict(BASELINE)
        payload = {k: values.get(k, BASELINE[k]) for k in BASELINE}
        payload["external_google_skip_nonce_check"] = False
        payload["external_google_secret"] = None
        out("Rollback would set: " + ", ".join(f"{k}={v}" for k, v in payload.items() if k != "external_google_secret") + ", external_google_secret=(cleared)")
        out("(values from " + (saved[-1].name if saved else "the built-in baseline") + "; nothing else is touched)")
        if not args.apply:
            out("DRY RUN: nothing was changed. Re-run with --apply to roll back.")
            return 0
        if ask(f"Type exactly '{ROLLBACK_PHRASE}' to continue: ").strip() != ROLLBACK_PHRASE:
            raise Abort("confirmation phrase not typed; nothing was changed")
        api("PATCH", config_path(ref), payload)
        after = api("GET", config_path(ref))
        bad = [k for k in BASELINE if not same(k, after.get(k), payload[k])]
        other = [k for k in before if k not in TARGET_KEYS and before.get(k) != after.get(k)]
        if bad or other:
            raise Abort(f"read-back mismatch (target keys: {bad}, other keys: {other}); check the dashboard (Authentication -> Providers)")
        out("Rolled back. Read-back: the target keys hold their baseline values and no other setting changed.")
        if after.get("external_google_secret"):
            out("NOTE: a Google client secret is still stored (the provider is disabled, so it is unused). Clear it in the dashboard: Authentication -> Providers -> Google.")
        return 0

    # apply
    web = web or web_client_id()
    problems = []
    for k, v in BASELINE.items():
        if not same(k, before.get(k), v):
            problems.append(f"{k} is already {before.get(k)!r} (expected the baseline {v!r})")
    if before.get("external_google_secret"):
        problems.append("a Google secret is already stored")
    if problems:
        raise Abort("refusing: production auth is not at the pre-change baseline: " + "; ".join(problems))
    secrets = lib.secrets_of(api, ref)
    missing = [n for n in ("APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_CLIENT_ID", "APPLE_PRIVATE_KEY") if n not in secrets]
    if missing:
        raise Abort("refusing: the Apple revocation secrets are missing: " + ", ".join(missing))
    for path in ("/", "/privacy/"):
        code = url_status(path)
        if code != 200:
            raise Abort(f"refusing: {SITE}{path} answered {code}, not 200 (the website must be live before Google sign-in is enabled)")
    after_values = expected_after(web)
    out("Preconditions met: auth is at the baseline, the Apple secrets exist, the website homepage and privacy page answer 200.")
    out("Preconditions only you can confirm (this script cannot see them): Google Auth platform -> Audience says In production (confirmed by you 2026-10-10); "
        "the Search Console domain is verified; no 1.1 build with these providers is expected to reach users before this is verified.")
    out("Would change (and nothing else):")
    for k, v in after_values.items():
        out(f"  {k}: {before.get(k)!r} -> {v!r}")
    out("  external_google_secret: (unset) -> (the Web client secret you type; never shown)")
    if not args.apply:
        out("DRY RUN: nothing was changed and no secret was requested. Re-run with --apply to change production.")
        return 0
    if ask(f"Type exactly '{APPLY_PHRASE}' to change production auth settings: ").strip() != APPLY_PHRASE:
        raise Abort("confirmation phrase not typed; nothing was changed")
    secret = ask_secret("Google WEB client secret for the production Supabase project (input hidden): ").strip()
    if len(secret) < 20 or re.search(r"\s", secret):
        raise Abort("that does not look like a Google client secret; nothing was changed")
    save_dir.mkdir(parents=True, exist_ok=True)
    save_file = save_dir / f"auth-before-{now().strftime('%Y%m%dT%H%M%SZ')}.json"
    fd = os.open(save_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump({k: before.get(k) for k in BASELINE}, handle)
    api("PATCH", config_path(ref), {**after_values, "external_google_secret": secret})
    del secret
    after = api("GET", config_path(ref))
    wrong = [k for k, v in after_values.items() if not same(k, after.get(k), v)]
    other = [k for k in before if k not in TARGET_KEYS and before.get(k) != after.get(k)]
    if wrong or other or not after.get("external_google_secret"):
        raise Abort(f"read-back mismatch (target keys: {wrong}, other keys changed: {other}, secret stored: {bool(after.get('external_google_secret'))}); "
                    "run `rollback --apply`")
    out("Changed. Read-back: every target key holds its new value, the Google secret is stored, and no other auth setting changed.")
    out(f"Rollback: supabase/prod/configure-auth.py rollback --apply   (uses {save_file.name})")
    out("Next, read-only: confirm with the app flows only after the production build exists; nothing else in this step needs the app.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run(sys.argv[1:]))
    except Abort as err:
        print(f"Stopped: {err}", file=sys.stderr)
        sys.exit(1)
