"""Tests for configure-auth.py with a fake Management API and a fake config (no network, no real secrets, no production access).
Run from the repo root:  python3 -m unittest supabase/prod/test_configure_auth.py"""
import importlib.util
import json
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("configure_auth", HERE / "configure-auth.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
lib = mod.lib

PROD, DEV = lib.PROD_REF, lib.DEV_REF
CFG = {"prod_ref": PROD, "dev_ref": DEV}
WEB = "124971644702-0urm9vu8emtmjf8ucqni73em6ms656np.apps.googleusercontent.com"
SECRET = "GOCSPX-" + "q" * 28   # made up
APPLE_SECRETS = {n: "d" for n in ("APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_CLIENT_ID", "APPLE_PRIVATE_KEY")}


class Collect:
    def __init__(self):
        self.lines = []

    def __call__(self, text):
        self.lines.append(str(text))

    def text(self):
        return "\n".join(self.lines)


def baseline_config():
    return {
        "external_apple_enabled": False, "external_apple_client_id": None, "external_apple_additional_client_ids": None,
        "external_apple_secret": None, "external_apple_email_optional": False,
        "external_google_enabled": False, "external_google_client_id": None, "external_google_additional_client_ids": None,
        "external_google_secret": None, "external_google_skip_nonce_check": None, "external_google_email_optional": False,
        "security_manual_linking_enabled": False,
        "site_url": "racesignal://auth-callback", "uri_allow_list": "racesignal://auth-callback,racesignal://**",
        "smtp_host": "smtp.gmail.com", "smtp_port": "587", "mailer_autoconfirm": False, "disable_signup": False, "rate_limit_email_sent": 30,
    }


class FakeApi:
    def __init__(self, config=None, secrets=None, patch_side_effect=None, drop_secret=False):
        self.config = config or baseline_config()
        self.secrets = secrets if secrets is not None else dict(APPLE_SECRETS)
        self.calls = []
        self.patch_side_effect = patch_side_effect
        self.drop_secret = drop_secret
        self.patched_payloads = []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        ref = path.split("/")[2]
        assert ref in (PROD, DEV)
        if method == "GET" and path == f"/projects/{ref}":
            return {"name": "RaceSignal production", "status": "ACTIVE_HEALTHY"}
        if method == "GET" and path.endswith("/secrets"):
            return [{"name": n, "value": v} for n, v in self.secrets.items()]
        if method == "GET" and path.endswith("/config/auth"):
            return dict(self.config)
        if method == "PATCH" and path.endswith("/config/auth"):
            self.patched_payloads.append(dict(body))
            for k, v in body.items():
                if k == "external_google_secret" and self.drop_secret:
                    continue
                self.config[k] = v
            if self.patch_side_effect:
                self.patch_side_effect(self.config)
            return dict(self.config)
        raise AssertionError((method, path))

    def writes(self):
        return [c for c in self.calls if c[0] in ("PATCH", "POST", "PUT", "DELETE")]


def run(argv, fake, *, answers=(), secret=SECRET, site=lambda path: 200, cfg=CFG, save_dir=None):
    out, queue = Collect(), list(answers)
    code = mod.run(argv, api=fake, ask=lambda _p: queue.pop(0), ask_secret=lambda _p: secret, cfg=cfg, out=out, url_status=site,
                   save_dir=save_dir or pathlib.Path(tempfile.mkdtemp()), web=WEB)
    return code, out


class Status(unittest.TestCase):
    def test_status_is_read_only_and_reports_the_baseline(self):
        fake = FakeApi()
        code, out = run(["status"], fake)
        self.assertEqual(code, 0)
        self.assertEqual(fake.writes(), [])
        self.assertIn("yes (nothing configured yet)", out.text())

    def test_status_notices_a_configured_project_and_never_prints_the_secret(self):
        fake = FakeApi()
        run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE])
        code, out = run(["status"], fake)
        self.assertIn("NO (already changed)", out.text())
        self.assertNotIn(SECRET, out.text())
        self.assertIn("<set>", out.text())


class Apply(unittest.TestCase):
    def test_dry_run_changes_nothing_and_never_asks_for_the_secret(self):
        fake = FakeApi()
        out, asked = Collect(), []
        code = mod.run(["apply"], api=fake, ask=lambda p: asked.append(p), ask_secret=lambda p: asked.append(p), cfg=CFG, out=out,
                       url_status=lambda p: 200, save_dir=pathlib.Path(tempfile.mkdtemp()), web=WEB)
        self.assertEqual((code, fake.writes(), asked), (0, [], []))
        self.assertIn("DRY RUN", out.text())
        self.assertIn("com.cristianvillamarin.racesignal", out.text())
        self.assertIn(WEB, out.text())

    def test_needs_the_exact_phrase_and_nothing_is_sent_without_it(self):
        fake = FakeApi()
        with self.assertRaises(lib.Abort):
            run(["apply", "--apply"], fake, answers=["yes"])
        self.assertEqual(fake.writes(), [])

    def test_applies_exactly_the_documented_change_in_one_patch(self):
        fake = FakeApi()
        before = dict(fake.config)
        code, out = run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE])
        self.assertEqual(code, 0)
        self.assertEqual(len(fake.patched_payloads), 1)
        payload = fake.patched_payloads[0]
        self.assertEqual(set(payload), {"external_apple_enabled", "external_apple_client_id", "external_google_enabled", "external_google_client_id",
                                        "external_google_secret", "external_google_skip_nonce_check", "security_manual_linking_enabled"})
        self.assertEqual(payload["external_apple_client_id"], "com.cristianvillamarin.racesignal")
        self.assertIs(payload["external_google_skip_nonce_check"], False)
        changed = {k for k in before if before[k] != fake.config[k]}
        self.assertEqual(changed, set(payload))
        self.assertTrue(fake.config["security_manual_linking_enabled"])
        self.assertNotIn(SECRET, out.text())

    def test_nonce_check_is_never_skipped_and_only_production_is_patched(self):
        fake = FakeApi()
        run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE])
        self.assertTrue(all(c[1].startswith(f"/projects/{PROD}/") for c in fake.writes()))
        self.assertFalse(any(p.get("external_google_skip_nonce_check") for p in fake.patched_payloads))

    def test_saves_a_private_non_secret_rollback_file(self):
        fake, tmp = FakeApi(), pathlib.Path(tempfile.mkdtemp())
        run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE], save_dir=tmp)
        files = list(tmp.glob("auth-before-*.json"))
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].stat().st_mode & 0o777, 0o600)
        saved = json.loads(files[0].read_text())
        self.assertEqual(saved["external_apple_enabled"], False)
        self.assertNotIn(SECRET, files[0].read_text())
        self.assertNotIn("external_google_secret", saved)

    def test_refuses_unless_the_baseline_holds(self):
        for key, value in (("external_apple_enabled", True), ("external_google_enabled", True), ("security_manual_linking_enabled", True),
                           ("external_google_client_id", "x"), ("external_google_secret", "already")):
            cfg = baseline_config()
            cfg[key] = value
            fake = FakeApi(config=cfg)
            with self.assertRaises(lib.Abort, msg=key):
                run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE])
            self.assertEqual(fake.writes(), [], key)

    def test_refuses_without_the_apple_secrets(self):
        fake = FakeApi(secrets={"ANTHROPIC_API_KEY": "x"})
        with self.assertRaises(lib.Abort) as ctx:
            run(["apply"], fake)
        self.assertIn("APPLE_", str(ctx.exception))

    def test_refuses_if_the_website_is_not_live(self):
        for bad in (404, 0, 500):
            fake = FakeApi()
            with self.assertRaises(lib.Abort):
                run(["apply"], fake, site=lambda path, b=bad: b if path == "/privacy/" else 200)
            self.assertEqual(fake.writes(), [])

    def test_targets_production_only(self):
        fake = FakeApi()
        with self.assertRaises(lib.Abort):
            run(["status"], fake, cfg={"prod_ref": DEV, "dev_ref": DEV})
        with self.assertRaises(lib.Abort):
            run(["status"], fake, cfg={"prod_ref": "otherproject", "dev_ref": DEV})
        self.assertEqual(fake.calls, [])

    def test_rejects_a_bad_secret_before_sending_anything(self):
        for bad in ("", "short", "has a space in it 1234567890"):
            fake = FakeApi()
            with self.assertRaises(lib.Abort):
                run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE], secret=bad)
            self.assertEqual(fake.writes(), [], bad)

    def test_stops_if_another_setting_changes_as_a_side_effect(self):
        fake = FakeApi(patch_side_effect=lambda cfg: cfg.update({"site_url": "https://elsewhere.example"}))
        with self.assertRaises(lib.Abort) as ctx:
            run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE])
        self.assertIn("rollback --apply", str(ctx.exception))
        self.assertIn("site_url", str(ctx.exception))

    def test_stops_if_a_target_key_did_not_take_effect(self):
        fake = FakeApi(patch_side_effect=lambda cfg: cfg.update({"security_manual_linking_enabled": False}))
        with self.assertRaises(lib.Abort) as ctx:
            run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE])
        self.assertIn("security_manual_linking_enabled", str(ctx.exception))

    def test_stops_if_the_secret_was_not_stored(self):
        fake = FakeApi(drop_secret=True)
        with self.assertRaises(lib.Abort):
            run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE])


class Rollback(unittest.TestCase):
    def test_dry_run_changes_nothing(self):
        fake = FakeApi()
        run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE])
        writes = len(fake.writes())
        code, out = run(["rollback"], fake)
        self.assertEqual((code, len(fake.writes())), (0, writes))
        self.assertIn("DRY RUN", out.text())

    def test_rollback_needs_the_phrase(self):
        fake = FakeApi()
        run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE])
        with self.assertRaises(lib.Abort):
            run(["rollback", "--apply"], fake, answers=["ok"])
        self.assertTrue(fake.config["external_google_enabled"])

    def test_rollback_restores_the_baseline_and_clears_the_secret(self):
        fake, tmp = FakeApi(), pathlib.Path(tempfile.mkdtemp())
        base = dict(fake.config)
        run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE], save_dir=tmp)
        code, out = run(["rollback", "--apply"], fake, answers=[mod.ROLLBACK_PHRASE], save_dir=tmp)
        self.assertEqual(code, 0)
        for k in mod.BASELINE:
            self.assertTrue(mod.same(k, fake.config[k], base[k]), k)
        self.assertFalse(fake.config["external_google_secret"])
        self.assertEqual({k for k in base if base[k] != fake.config[k] and not mod.same(k, base[k], fake.config[k])}, set())

    def test_rollback_without_a_saved_file_uses_the_built_in_baseline(self):
        fake = FakeApi()
        run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE])
        code, out = run(["rollback", "--apply"], fake, answers=[mod.ROLLBACK_PHRASE], save_dir=pathlib.Path(tempfile.mkdtemp()))
        self.assertEqual(code, 0)
        self.assertIn("built-in baseline", out.text())
        self.assertFalse(fake.config["external_apple_enabled"])

    def test_rollback_warns_if_the_secret_could_not_be_cleared(self):
        fake = FakeApi()
        run(["apply", "--apply"], fake, answers=[mod.APPLY_PHRASE])
        fake.drop_secret = True
        _, out = run(["rollback", "--apply"], fake, answers=[mod.ROLLBACK_PHRASE])
        self.assertIn("still stored", out.text())


if __name__ == "__main__":
    unittest.main()
