#!/usr/bin/env python3
"""Sets (or removes) the two RevenueCat function secrets on the PRODUCTION Supabase project. For owner review; nothing here runs on its own.

  supabase/prod/set-revenuecat-secrets.py check            # read-only: shows the target and which of the two secrets exist
  supabase/prod/set-revenuecat-secrets.py set              # DRY RUN: validates your key against RevenueCat (read-only) and shows what would be set
  supabase/prod/set-revenuecat-secrets.py set --apply      # the real change, after you type a confirmation phrase
  supabase/prod/set-revenuecat-secrets.py remove           # DRY RUN of the rollback
  supabase/prod/set-revenuecat-secrets.py remove --apply   # rollback: removes only these two secrets, after a confirmation phrase

What it does, and nothing else: it writes REVENUECAT_SECRET_API_KEY and REVENUECAT_PROJECT_ID (the RevenueCat PRODUCTION project) that the
`delete-account` and `revenuecat-cleanup` functions read. It does not deploy, apply a migration, schedule anything or touch any other secret.

Safety design:
  * The target is the production project in supabase/.temp/project-ref, shown before anything is read or written; it must equal the
    expected production ref and must not be the development project.
  * The RevenueCat key is typed at a HIDDEN prompt (never an argument, environment variable or file) and goes to the Management API from
    memory. It is never printed; only its length and prefix class are.
  * It refuses a key that is the development key (SHA-256 compared with the digest of the development project's secret), or any key equal to
    an existing secret, and anything that is not an `sk_` secret key.
  * Before anything is sent it checks the key with read-only GETs to RevenueCat: it must be accepted by the PRODUCTION project and must be
    REJECTED by the development project (keys are per project), and it warns if the key can also read purchases or project configuration
    (it should only have Customers read & write).
  * `set --apply` refuses if either secret already exists, requires the exact phrase, then reads the secret names back and checks every
    other secret's digest is unchanged. `remove --apply` removes only these two names and checks the same.
"""
import argparse
import getpass
import re
import sys

import importlib.util
import pathlib

if "prodlib" not in sys.modules:  # one shared instance, so the scripts and their tests raise and catch the same Abort
    _spec = importlib.util.spec_from_file_location("prodlib", pathlib.Path(__file__).with_name("prodlib.py"))
    _module = importlib.util.module_from_spec(_spec)
    sys.modules["prodlib"] = _module
    _spec.loader.exec_module(_module)
lib = sys.modules["prodlib"]
Abort = lib.Abort

SET_PHRASE = "SET PRODUCTION REVENUECAT SECRETS"
REMOVE_PHRASE = "REMOVE PRODUCTION REVENUECAT SECRETS"
RC_API = "https://api.revenuecat.com/v2/projects"


def validate_key_shape(key: str) -> str:
    key = key.strip()
    if not re.fullmatch(r"sk_[A-Za-z0-9_\-]{16,200}", key):
        raise Abort("that does not look like a RevenueCat secret API key (it should start with sk_ and contain no spaces)")
    return key


def refuse_reuse(key: str, api, cfg) -> None:
    """The development key (or any key already stored as a secret anywhere we can see) must never be reused for production."""
    known = {}
    for label, ref in (("development", cfg["dev_ref"]), ("production", cfg["prod_ref"])):
        for name, dig in lib.secrets_of(api, ref).items():
            known[dig] = f"{label} secret {name}"
    hit = known.get(lib.digest(key))
    if hit:
        raise Abort(f"refusing: that value is the same as the {hit}. Create a separate key in the PRODUCTION RevenueCat project")


def probe_key(key: str, status_of=lib.http_get_status) -> list:
    """Read-only GETs to RevenueCat. Raises Abort if the key is not a valid production-only key; returns advisory warnings."""
    prod = status_of(f"{RC_API}/{lib.RC_PROD_PROJECT}/customers?limit=1", key)
    if prod != 200:
        raise Abort(f"RevenueCat rejected this key for the PRODUCTION project (HTTP {prod}); it needs Customers read & write there")
    dev = status_of(f"{RC_API}/{lib.RC_DEV_PROJECT}/customers?limit=1", key)
    if dev == 200:
        raise Abort("refusing: this key also works on the DEVELOPMENT RevenueCat project, so it is not a production-only key")
    warnings = []
    for label, path in (("purchases", f"{RC_API}/{lib.RC_PROD_PROJECT}/customers/00000000-0000-0000-0000-000000000000/purchases?limit=1"),
                        ("project configuration (offerings)", f"{RC_API}/{lib.RC_PROD_PROJECT}/offerings?limit=1")):
        if status_of(path, key) in (200, 404):
            warnings.append(f"this key can also access {label}; it should only have Customers read & write. Consider recreating it with fewer permissions")
    return warnings


def run(argv, *, api=lib.management_api, ask=input, ask_secret=getpass.getpass, cfg=None, out=print, status_of=lib.http_get_status):
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("command", choices=["check", "set", "remove"])
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    cfg = cfg or lib.load_config()
    name, status = lib.target(api, cfg)
    ref = cfg["prod_ref"]
    out(f"Target: PRODUCTION project '{name}' ({ref}), status {status}.")
    before = lib.secrets_of(api, ref)
    out("Secrets that exist now (names only): " + ", ".join(sorted(before)))
    have = [n for n in lib.SECRET_NAMES if n in before]

    if args.command == "check":
        out("RevenueCat secrets present: " + (", ".join(have) if have else "none") + ". Nothing was changed.")
        return 0

    if args.command == "remove":
        if not have:
            out("Neither RevenueCat secret exists; nothing to remove.")
            return 0
        out("Would remove: " + ", ".join(have) + " (no other secret is touched).")
        if not args.apply:
            out("DRY RUN: nothing was changed. Re-run with --apply to remove them.")
            return 0
        if ask(f"Type exactly '{REMOVE_PHRASE}' to continue: ").strip() != REMOVE_PHRASE:
            raise Abort("confirmation phrase not typed; nothing was changed")
        api("DELETE", f"/projects/{ref}/secrets", have)
        after = lib.secrets_of(api, ref)
        left = [n for n in lib.SECRET_NAMES if n in after]
        if left or any(before[n] != after.get(n) for n in before if n not in lib.SECRET_NAMES):
            raise Abort("read-back did not match expectations: " + str(left))
        out("Removed. Read-back: neither secret remains and every other secret is unchanged.")
        out("Also revoke the RevenueCat key itself in the dashboard (Project settings -> API keys); the functions can no longer use it.")
        return 0

    # set
    if have:
        raise Abort("refusing: these already exist on production: " + ", ".join(have) + " (remove them first with `remove --apply` if you mean to replace them)")
    key = validate_key_shape(ask_secret("RevenueCat secret API key for the PRODUCTION project (input hidden): "))
    refuse_reuse(key, api, cfg)
    warnings = probe_key(key, status_of)
    values = {"REVENUECAT_SECRET_API_KEY": key, "REVENUECAT_PROJECT_ID": lib.RC_PROD_PROJECT}
    out("Validated against RevenueCat (read-only requests): accepted by the PRODUCTION project, rejected by the development project.")
    for warning in warnings:
        out("WARNING: " + warning)
    out("Would set on production:")
    out(f"  REVENUECAT_SECRET_API_KEY (an sk_ key, {len(key)} characters, never shown)")
    out(f"  REVENUECAT_PROJECT_ID     ({lib.RC_PROD_PROJECT}, the RevenueCat production project)")
    if not args.apply:
        out("DRY RUN: nothing was sent or changed. Re-run with --apply to set them.")
        return 0
    if ask(f"Type exactly '{SET_PHRASE}' to send these to production: ").strip() != SET_PHRASE:
        raise Abort("confirmation phrase not typed; nothing was changed")
    api("POST", f"/projects/{ref}/secrets", [{"name": n, "value": values[n]} for n in lib.SECRET_NAMES])
    after = lib.secrets_of(api, ref)
    missing = [n for n in lib.SECRET_NAMES if n not in after]
    changed = [n for n in before if before[n] != after.get(n)]
    wrong = [n for n in lib.SECRET_NAMES if n in after and after[n] != lib.digest(values[n])]
    if missing or changed or wrong:
        raise Abort(f"read-back mismatch (missing: {missing}, changed: {changed}, unexpected value: {wrong}); run `remove --apply` to roll back")
    out("Set. Read-back: both secrets exist with the expected digests and every previously existing secret is unchanged.")
    out("Note: setting secrets makes Supabase bump every function's version; identify functions by hash and source.")
    out("Rollback: supabase/prod/set-revenuecat-secrets.py remove --apply (then revoke the key in the RevenueCat dashboard)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(run(sys.argv[1:]))
    except Abort as err:
        print(f"Stopped: {err}", file=sys.stderr)
        sys.exit(1)
