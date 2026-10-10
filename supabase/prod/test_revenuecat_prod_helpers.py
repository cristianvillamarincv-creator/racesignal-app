"""Tests for set-revenuecat-secrets.py and schedule-revenuecat-cleanup.py with a fake Management API, fake RevenueCat answers and a fake database.
No network, no real keys, no production access.   Run from the repo root:  python3 -m unittest supabase/prod/test_revenuecat_prod_helpers.py"""
import importlib.util
import pathlib
import re
import unittest

HERE = pathlib.Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


secrets_mod = load("set_revenuecat_secrets", "set-revenuecat-secrets.py")
sched = load("schedule_revenuecat_cleanup", "schedule-revenuecat-cleanup.py")
lib = secrets_mod.lib

PROD, DEV = lib.PROD_REF, lib.DEV_REF
CFG = {"prod_ref": PROD, "dev_ref": DEV}
FAKE_KEY = "sk_" + "A" * 32            # a made-up value; never a real key
SERVICE_KEY = "eyJ" + "S" * 60          # made-up service key
SET_PHRASE, REMOVE_PHRASE = secrets_mod.SET_PHRASE, secrets_mod.REMOVE_PHRASE
APPLY_PHRASE, SCHED_REMOVE_PHRASE = sched.APPLY_PHRASE, sched.REMOVE_PHRASE


class Collect:
    def __init__(self):
        self.lines = []

    def __call__(self, text):
        self.lines.append(str(text))

    def text(self):
        return "\n".join(self.lines)


class FakeSupabase:
    """Management API + database in one fake."""

    def __init__(self, prod_secrets=None, dev_secrets=None, table=True, functions=("signal", "race-discovery", "delete-account", "revenuecat-cleanup"),
                 installed=("plpgsql", "supabase_vault"), with_secrets=True):
        base = {"ANTHROPIC_API_KEY": lib.digest("a"), "REVENUECAT_PUBLIC_API_KEY": lib.digest("b"), "SUPABASE_URL": lib.digest("u")}
        self.secrets = {PROD: dict(prod_secrets if prod_secrets is not None else base), DEV: dict(dev_secrets if dev_secrets is not None else {"REVENUECAT_SECRET_API_KEY": lib.digest("sk_DEVELOPMENT_KEY_VALUE_xxxxxxxx")})}
        if with_secrets and prod_secrets is None:
            self.secrets[PROD].update({n: lib.digest("x") for n in lib.SECRET_NAMES})
        self.table, self.functions, self.installed = table, list(functions), set(installed)
        self.job, self.vault, self.runs, self.http = None, set(), [], []
        self.calls, self.statements = [], []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        ref = re.match(r"/projects/([a-z]+)", path).group(1)
        rest = path[len(f"/projects/{ref}"):]
        if method == "GET" and rest == "":
            return {"name": "RaceSignal production", "status": "ACTIVE_HEALTHY"}
        if method == "GET" and rest == "/secrets":
            return [{"name": n, "value": v} for n, v in self.secrets[ref].items()]
        if method == "POST" and rest == "/secrets":
            for item in body:
                self.secrets[ref][item["name"]] = lib.digest(item["value"])
            return None
        if method == "DELETE" and rest == "/secrets":
            for n in body:
                self.secrets[ref].pop(n, None)
            return None
        if method == "GET" and rest == "/functions":
            return [{"slug": f} for f in self.functions]
        if method == "GET" and rest.startswith("/api-keys"):
            return [{"name": "anon", "api_key": "anon"}, {"name": "service_role", "api_key": SERVICE_KEY}]
        if method == "POST" and rest == "/database/query":
            return self.sql(body["query"])
        raise AssertionError((method, path))

    def sql(self, q):
        self.statements.append(q)
        low = q.lower()
        if "to_regclass('public.revenuecat_deletion_requests')" in low:
            return [{"present": self.table}]
        if "from pg_available_extensions" in low:
            return [{"name": n, "installed_version": "1" if n in self.installed else None} for n in ("pg_cron", "pg_net", "supabase_vault")]
        if "select extname from pg_extension" in low:
            return [{"extname": e} for e in sorted(self.installed)]
        if "from cron.job where" in low:
            return [self.job] if self.job else []
        if "from vault.secrets" in low and low.startswith("select count"):
            return [{"n": 1 if self.vault else 0}]
        if "from cron.job_run_details" in low:
            return list(self.runs)
        if "from net._http_response" in low:
            return list(self.http)
        if "group by status" in low:
            return [{"status": "verified", "n": 2}]
        if low.startswith("create extension"):
            self.installed |= {"pg_cron", "pg_net"}
            return []
        if "vault.create_secret" in low:
            self.vault.add("s")
            return []
        if "cron.schedule" in low:
            m = re.search(r"cron\.schedule\('revenuecat-cleanup', '([^']+)', \$job\$ (.*) \$job\$\)", q, re.S)
            self.job = {"jobid": 7, "schedule": m.group(1), "active": True, "command": m.group(2)}
            return []
        if "cron.unschedule" in low:
            self.job = None
            return []
        if low.startswith("delete from vault.secrets"):
            self.vault.clear()
            return []
        raise AssertionError(q)

    def writes(self):
        return [c for c in self.calls if c[0] in ("POST", "DELETE") and not c[1].endswith("/database/query")] + \
               [("SQL", s) for s in self.statements if not s.lstrip().lower().startswith("select")]


def status_of(prod=200, dev=403, purchases=403, offerings=403):
    def fn(url, key):
        assert key  # the key is only ever passed as the bearer
        if f"/{lib.RC_PROD_PROJECT}/customers?limit=1" in url:
            return prod
        if f"/{lib.RC_DEV_PROJECT}/customers?limit=1" in url:
            return dev
        if url.endswith("/purchases?limit=1"):
            return purchases
        if "/offerings" in url:
            return offerings
        raise AssertionError(url)
    return fn


def run_secrets(argv, fake, *, answers=(), key=FAKE_KEY, probe=None, cfg=CFG):
    out, queue = Collect(), list(answers)
    code = secrets_mod.run(argv, api=fake, ask=lambda _p: queue.pop(0), ask_secret=lambda _p: key, cfg=cfg, out=out, status_of=probe or status_of())
    return code, out


def run_sched(argv, fake, *, answers=(), cfg=CFG):
    out, queue = Collect(), list(answers)
    code = sched.run(argv, api=fake, ask=lambda _p: queue.pop(0), cfg=cfg, out=out)
    return code, out


class SecretsHelper(unittest.TestCase):
    def test_check_is_read_only(self):
        fake = FakeSupabase(with_secrets=False)
        code, out = run_secrets(["check"], fake)
        self.assertEqual(code, 0)
        self.assertEqual(fake.writes(), [])
        self.assertIn("none", out.text())

    def test_dry_run_validates_but_sends_nothing(self):
        fake = FakeSupabase(with_secrets=False)
        code, out = run_secrets(["set"], fake)
        self.assertEqual(code, 0)
        self.assertEqual(fake.writes(), [])
        self.assertIn("DRY RUN", out.text())
        self.assertIn(lib.RC_PROD_PROJECT, out.text())

    def test_no_secret_value_is_ever_printed(self):
        fake = FakeSupabase(with_secrets=False)
        _, out = run_secrets(["set", "--apply"], fake, answers=[SET_PHRASE])
        self.assertNotIn(FAKE_KEY, out.text())
        self.assertNotIn("A" * 32, out.text())

    def test_apply_needs_the_exact_phrase(self):
        fake = FakeSupabase(with_secrets=False)
        with self.assertRaises(lib.Abort):
            run_secrets(["set", "--apply"], fake, answers=["yes"])
        self.assertEqual(fake.writes(), [])

    def test_apply_sets_both_and_reads_back(self):
        fake = FakeSupabase(with_secrets=False)
        before = dict(fake.secrets[PROD])
        code, out = run_secrets(["set", "--apply"], fake, answers=[SET_PHRASE])
        self.assertEqual(code, 0)
        after = fake.secrets[PROD]
        self.assertEqual(after["REVENUECAT_SECRET_API_KEY"], lib.digest(FAKE_KEY))
        self.assertEqual(after["REVENUECAT_PROJECT_ID"], lib.digest(lib.RC_PROD_PROJECT))
        self.assertTrue(all(after[n] == before[n] for n in before))
        self.assertIn("Rollback", out.text())

    def test_apply_is_sent_to_production_only(self):
        fake = FakeSupabase(with_secrets=False)
        run_secrets(["set", "--apply"], fake, answers=[SET_PHRASE])
        for _method, path, _body in fake.calls:
            if path.endswith("/secrets") and _method in ("POST", "DELETE"):
                self.assertTrue(path.startswith(f"/projects/{PROD}/"))
        self.assertEqual(fake.secrets[DEV], {"REVENUECAT_SECRET_API_KEY": lib.digest("sk_DEVELOPMENT_KEY_VALUE_xxxxxxxx")})

    def test_refuses_when_already_set_without_sending_anything(self):
        fake = FakeSupabase()
        with self.assertRaises(lib.Abort) as ctx:
            run_secrets(["set", "--apply"], fake, answers=[SET_PHRASE])
        self.assertIn("already exist", str(ctx.exception))
        self.assertEqual(fake.writes(), [])

    def test_refuses_the_development_project_as_target(self):
        fake = FakeSupabase(with_secrets=False)
        with self.assertRaises(lib.Abort):
            run_secrets(["check"], fake, cfg={"prod_ref": DEV, "dev_ref": DEV})
        with self.assertRaises(lib.Abort):
            run_secrets(["check"], fake, cfg={"prod_ref": "someotherprojectref", "dev_ref": DEV})
        self.assertEqual(fake.calls, [])

    def test_refuses_the_development_key(self):
        fake = FakeSupabase(with_secrets=False)
        dev_key = "sk_DEVELOPMENT_KEY_VALUE_xxxxxxxx"
        with self.assertRaises(lib.Abort) as ctx:
            run_secrets(["set", "--apply"], fake, answers=[SET_PHRASE], key=dev_key)
        self.assertIn("development", str(ctx.exception))
        self.assertNotIn(dev_key, str(ctx.exception))
        self.assertEqual(fake.writes(), [])

    def test_refuses_a_key_equal_to_any_existing_secret(self):
        fake = FakeSupabase(with_secrets=False)
        fake.secrets[PROD]["REVENUECAT_PUBLIC_API_KEY"] = lib.digest(FAKE_KEY)
        with self.assertRaises(lib.Abort):
            run_secrets(["set", "--apply"], fake, answers=[SET_PHRASE])

    def test_refuses_the_wrong_kind_of_key(self):
        for bad in ("appl_" + "a" * 30, "sk_short", "sk_ has space " + "a" * 20, ""):
            with self.assertRaises(lib.Abort, msg=bad):
                run_secrets(["set"], FakeSupabase(with_secrets=False), key=bad)

    def test_refuses_a_key_revenuecat_rejects_for_production(self):
        with self.assertRaises(lib.Abort):
            run_secrets(["set"], FakeSupabase(with_secrets=False), probe=status_of(prod=401))

    def test_refuses_a_key_that_also_works_on_the_development_project(self):
        with self.assertRaises(lib.Abort) as ctx:
            run_secrets(["set"], FakeSupabase(with_secrets=False), probe=status_of(dev=200))
        self.assertIn("DEVELOPMENT", str(ctx.exception))

    def test_warns_about_a_key_with_extra_permissions(self):
        _, out = run_secrets(["set"], FakeSupabase(with_secrets=False), probe=status_of(purchases=200, offerings=404))
        self.assertIn("WARNING", out.text())
        self.assertIn("purchases", out.text())

    def test_no_warning_for_a_minimal_key(self):
        _, out = run_secrets(["set"], FakeSupabase(with_secrets=False))
        self.assertNotIn("WARNING", out.text())

    def test_read_back_mismatch_stops_and_names_the_rollback(self):
        fake = FakeSupabase(with_secrets=False)
        original = fake.__call__

        def flaky(method, path, body=None):
            result = original(method, path, body)
            if method == "POST" and path.endswith("/secrets"):
                fake.secrets[PROD]["ANTHROPIC_API_KEY"] = "changed"
            return result
        with self.assertRaises(lib.Abort) as ctx:
            out, queue = Collect(), [SET_PHRASE]
            secrets_mod.run(["set", "--apply"], api=flaky, ask=lambda _p: queue.pop(0), ask_secret=lambda _p: FAKE_KEY, cfg=CFG, out=out, status_of=status_of())
        self.assertIn("remove --apply", str(ctx.exception))

    def test_remove_dry_run_changes_nothing(self):
        fake = FakeSupabase()
        code, out = run_secrets(["remove"], fake)
        self.assertEqual(code, 0)
        self.assertEqual(fake.writes(), [])
        self.assertIn("DRY RUN", out.text())

    def test_remove_apply_removes_only_the_two_and_keeps_the_rest(self):
        fake = FakeSupabase()
        before = {n: v for n, v in fake.secrets[PROD].items() if n not in lib.SECRET_NAMES}
        code, out = run_secrets(["remove", "--apply"], fake, answers=[REMOVE_PHRASE])
        self.assertEqual(code, 0)
        self.assertEqual(fake.secrets[PROD], before)
        self.assertIn("revoke", out.text().lower())

    def test_remove_apply_needs_the_phrase(self):
        fake = FakeSupabase()
        with self.assertRaises(lib.Abort):
            run_secrets(["remove", "--apply"], fake, answers=["ok"])
        self.assertTrue(all(n in fake.secrets[PROD] for n in lib.SECRET_NAMES))


class ScheduleHelper(unittest.TestCase):
    def test_status_and_dry_run_send_only_selects_and_never_fetch_the_key(self):
        fake = FakeSupabase()
        run_sched(["status"], fake)
        code, out = run_sched(["apply"], fake)
        self.assertEqual(code, 0)
        self.assertEqual(fake.writes(), [])
        self.assertFalse(any("api-keys" in c[1] for c in fake.calls))
        self.assertIn("DRY RUN", out.text())
        self.assertIn("*/30 * * * *", out.text())
        self.assertNotIn(SERVICE_KEY, out.text())

    def test_apply_refuses_until_each_precondition_is_met(self):
        for label, fake in (("migration", FakeSupabase(table=False)), ("secrets", FakeSupabase(with_secrets=False)),
                            ("function", FakeSupabase(functions=("signal", "delete-account")))):
            with self.assertRaises(lib.Abort, msg=label):
                run_sched(["apply", "--apply"], fake, answers=[APPLY_PHRASE])
            self.assertEqual(fake.writes(), [], label)

    def test_apply_needs_the_exact_phrase(self):
        fake = FakeSupabase()
        with self.assertRaises(lib.Abort):
            run_sched(["apply", "--apply"], fake, answers=["go"])
        self.assertEqual(fake.writes(), [])

    def test_apply_schedules_with_the_key_only_in_vault(self):
        fake = FakeSupabase()
        code, out = run_sched(["apply", "--apply"], fake, answers=[APPLY_PHRASE])
        self.assertEqual(code, 0)
        self.assertEqual(fake.job["schedule"], "*/30 * * * *")
        self.assertTrue(fake.job["active"])
        self.assertNotIn(SERVICE_KEY[:20], fake.job["command"])
        self.assertIn("vault.decrypted_secrets", fake.job["command"])
        self.assertIn(f"https://{PROD}.supabase.co/functions/v1/revenuecat-cleanup", fake.job["command"])
        self.assertTrue(fake.vault)
        self.assertNotIn(SERVICE_KEY, out.text())
        self.assertIn("Rollback", out.text())

    def test_apply_refuses_a_second_time(self):
        fake = FakeSupabase()
        run_sched(["apply", "--apply"], fake, answers=[APPLY_PHRASE])
        with self.assertRaises(lib.Abort):
            run_sched(["apply", "--apply"], fake, answers=[APPLY_PHRASE])

    def test_cadence_is_validated(self):
        for bad in ("", "* * *", "*/30 * * * * *", "every 30 minutes", "*/30; drop table x * * *"):
            with self.assertRaises(lib.Abort, msg=bad):
                run_sched(["apply", "--cadence", bad] if bad else ["apply", "--cadence", " "], FakeSupabase())
        code, _ = run_sched(["apply", "--cadence", "*/15 * * * *"], FakeSupabase())
        self.assertEqual(code, 0)

    def test_targets_production_only(self):
        fake = FakeSupabase()
        with self.assertRaises(lib.Abort):
            run_sched(["status"], fake, cfg={"prod_ref": DEV, "dev_ref": DEV})
        self.assertEqual(fake.calls, [])
        run_sched(["apply", "--apply"], fake, answers=[APPLY_PHRASE])
        self.assertTrue(all(f"/projects/{PROD}" in c[1] for c in fake.calls))

    def test_remove_dry_run_then_apply_rolls_back(self):
        fake = FakeSupabase()
        run_sched(["apply", "--apply"], fake, answers=[APPLY_PHRASE])
        before = len(fake.writes())
        code, out = run_sched(["remove"], fake)
        self.assertEqual((code, len(fake.writes())), (0, before))
        self.assertIn("DRY RUN", out.text())
        with self.assertRaises(lib.Abort):
            run_sched(["remove", "--apply"], fake, answers=["no"])
        self.assertIsNotNone(fake.job)
        run_sched(["remove", "--apply"], fake, answers=[SCHED_REMOVE_PHRASE])
        self.assertIsNone(fake.job)
        self.assertFalse(fake.vault)
        self.assertIn("pg_cron", fake.installed)  # extensions deliberately stay

    def test_remove_with_nothing_scheduled_is_a_no_op(self):
        fake = FakeSupabase()
        code, out = run_sched(["remove", "--apply"], fake)
        self.assertEqual(code, 0)
        self.assertEqual(fake.writes(), [])
        self.assertIn("nothing to remove", out.text())

    def test_verify_before_and_after_a_good_run(self):
        fake = FakeSupabase()
        self.assertEqual(run_sched(["verify"], fake)[0], 1)
        run_sched(["apply", "--apply"], fake, answers=[APPLY_PHRASE])
        self.assertEqual(run_sched(["verify"], fake)[0], 1)  # no run yet
        fake.runs = [{"start_time": "t", "status": "succeeded"}]
        fake.http = [{"created": "t", "status_code": 200, "body": "{}"}]
        code, out = run_sched(["verify"], fake)
        self.assertEqual(code, 0)
        self.assertIn("VERIFIED", out.text())

    def test_verify_fails_on_a_failed_run_a_bad_answer_or_a_key_in_the_job(self):
        fake = FakeSupabase()
        run_sched(["apply", "--apply"], fake, answers=[APPLY_PHRASE])
        fake.runs = [{"start_time": "t", "status": "failed"}]
        fake.http = [{"created": "t", "status_code": 200, "body": "{}"}]
        self.assertEqual(run_sched(["verify"], fake)[0], 1)
        fake.runs = [{"start_time": "t", "status": "succeeded"}]
        fake.http = [{"created": "t", "status_code": 401, "body": "{}"}]
        self.assertEqual(run_sched(["verify"], fake)[0], 1)
        fake.http = [{"created": "t", "status_code": 200, "body": "{}"}]
        fake.job["command"] += " eyJleakedkey"
        code, out = run_sched(["verify"], fake)
        self.assertEqual(code, 1)
        self.assertIn("contains a key", out.text())

    def test_read_only_sql_guard_rejects_non_selects(self):
        with self.assertRaises(lib.Abort):
            lib.sql_select(FakeSupabase(), PROD, "delete from vault.secrets")


if __name__ == "__main__":
    unittest.main()
