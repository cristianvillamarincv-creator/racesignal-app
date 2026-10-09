"""Tests for set-apple-secrets.py with a fake Management API and throwaway keys (no network, no real secrets).
Run: python3 -m unittest supabase/prod/test_set_apple_secrets.py   (from the repo root)"""
import importlib.util
import os
import pathlib
import subprocess
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("set_apple_secrets", HERE / "set-apple-secrets.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

CFG = {"prod_ref": "prodref00000000000000", "dev_ref": "devref000000000000000", "client_id": "com.cristianvillamarin.racesignal"}
TEAM, KEY = "ABCDE12345", "ZYXWV98765"


def make_key(directory: pathlib.Path, name: str, kind: str = "ec") -> pathlib.Path:
    path = directory / name
    if kind == "ec":
        subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", str(path)], check=True, capture_output=True)
    else:
        subprocess.run(["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", str(path)], check=True, capture_output=True)
    path.chmod(0o600)
    return path


class FakeApi:
    def __init__(self, secrets=None, apply_posts=True):
        self.secrets = dict(secrets or {"ANTHROPIC_API_KEY": "d1", "REVENUECAT_PUBLIC_API_KEY": "d2", "SUPABASE_URL": "d3"})
        self.calls = []
        self.apply_posts = apply_posts

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "GET" and path.endswith("/secrets"):
            return [{"name": n, "value": v} for n, v in self.secrets.items()]
        if method == "GET":
            return {"name": "RaceSignal production", "status": "ACTIVE_HEALTHY"}
        if method == "POST" and self.apply_posts:
            for item in body:
                self.secrets[item["name"]] = "digest-" + item["name"]
            return None
        if method == "POST":
            return None
        if method == "DELETE":
            for name in body:
                self.secrets.pop(name, None)
            return None
        raise AssertionError(method)

    def mutations(self):
        return [c for c in self.calls if c[0] in ("POST", "DELETE")]


class Collect:
    def __init__(self):
        self.lines = []

    def __call__(self, text):
        self.lines.append(text)

    def text(self):
        return "\n".join(self.lines)


def answers(*values):
    queue = list(values)
    return lambda prompt: queue.pop(0)


class SetAppleSecretsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.key = make_key(self.dir, f"AuthKey_{KEY}.p8")
        self.pem = self.key.read_text().strip()

    def tearDown(self):
        self.tmp.cleanup()

    def go(self, argv, api, *replies):
        out = Collect()
        code = mod.run(argv, api=api, ask=answers(*replies), cfg=CFG, out=out)
        return code, out.text()

    def test_check_changes_nothing_and_shows_names_only(self):
        api = FakeApi()
        code, text = self.go(["check"], api)
        self.assertEqual(code, 0)
        self.assertEqual(api.mutations(), [])
        self.assertIn("ANTHROPIC_API_KEY", text)
        self.assertNotIn("d1", text.replace("ANTHROPIC", ""))  # no digest or value is printed

    def test_dry_run_sends_nothing_and_prints_no_secret_values_or_ids(self):
        api = FakeApi()
        code, text = self.go(["set"], api, TEAM, KEY, str(self.key))
        self.assertEqual(code, 0)
        self.assertEqual(api.mutations(), [])
        self.assertIn("DRY RUN", text)
        for secret in (TEAM, KEY, "BEGIN PRIVATE KEY", self.pem[40:80]):
            self.assertNotIn(secret, text)
        self.assertIn("com.cristianvillamarin.racesignal", text)

    def test_apply_without_the_exact_phrase_sends_nothing(self):
        api = FakeApi()
        with self.assertRaises(mod.Abort):
            self.go(["set", "--apply"], api, TEAM, KEY, str(self.key), "yes")
        self.assertEqual(api.mutations(), [])

    def test_apply_with_the_phrase_sends_exactly_the_four_secrets_and_verifies_the_read_back(self):
        api = FakeApi()
        code, text = self.go(["set", "--apply"], api, TEAM, KEY, str(self.key), mod.SET_PHRASE)
        self.assertEqual(code, 0)
        posts = [c for c in api.calls if c[0] == "POST"]
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0][1], f"/projects/{CFG['prod_ref']}/secrets")
        sent = {item["name"]: item["value"] for item in posts[0][2]}
        self.assertEqual(sorted(sent), sorted(mod.NAMES))
        self.assertEqual(sent["APPLE_TEAM_ID"], TEAM)
        self.assertEqual(sent["APPLE_KEY_ID"], KEY)
        self.assertEqual(sent["APPLE_CLIENT_ID"], "com.cristianvillamarin.racesignal")
        self.assertEqual(sent["APPLE_PRIVATE_KEY"], self.pem)
        for secret in (TEAM, KEY, self.pem[40:80]):
            self.assertNotIn(secret, text)
        self.assertEqual(set(api.secrets) - set(mod.NAMES), {"ANTHROPIC_API_KEY", "REVENUECAT_PUBLIC_API_KEY", "SUPABASE_URL"})

    def test_refuses_when_apple_secrets_already_exist(self):
        api = FakeApi({"ANTHROPIC_API_KEY": "d1", "APPLE_KEY_ID": "x"})
        with self.assertRaises(mod.Abort):
            self.go(["set", "--apply"], api)
        self.assertEqual(api.mutations(), [])

    def test_refuses_when_the_linked_project_is_the_development_project(self):
        api = FakeApi()
        out = Collect()
        with self.assertRaises(mod.Abort):
            mod.run(["set", "--apply"], api=api, ask=answers(), cfg={**CFG, "prod_ref": CFG["dev_ref"]}, out=out)
        self.assertEqual(api.calls, [])

    def test_refuses_a_wrong_bundle_id_in_the_config(self):
        api = FakeApi()
        with self.assertRaises(mod.Abort):
            mod.run(["check"], api=api, ask=answers(), cfg={**CFG, "client_id": "com.cristianvillamarin.racesignal.dev"}, out=Collect())
        self.assertEqual(api.calls, [])

    def test_rejects_malformed_ids_a_missing_file_a_mismatched_name_and_a_non_ec_key(self):
        api = FakeApi()
        with self.assertRaises(mod.Abort):
            self.go(["set"], api, "short", KEY, str(self.key))
        with self.assertRaises(mod.Abort):
            self.go(["set"], api, TEAM, "lowercase1", str(self.key))
        with self.assertRaises(mod.Abort):
            self.go(["set"], api, TEAM, KEY, str(self.dir / "missing.p8"))
        with self.assertRaises(mod.Abort):
            self.go(["set"], api, TEAM, "ABCDEF1234", str(self.key))  # file is named for a different Key ID
        rsa = make_key(self.dir, "rsa.p8", kind="rsa")
        with self.assertRaises(mod.Abort):
            self.go(["set"], api, TEAM, KEY, str(rsa))
        not_pem = self.dir / "notes.p8"
        not_pem.write_text("hello")
        with self.assertRaises(mod.Abort):
            self.go(["set"], api, TEAM, KEY, str(not_pem))
        self.assertEqual(api.mutations(), [])

    def test_a_read_back_mismatch_stops_and_points_to_the_rollback(self):
        api = FakeApi(apply_posts=False)
        with self.assertRaises(mod.Abort) as ctx:
            self.go(["set", "--apply"], api, TEAM, KEY, str(self.key), mod.SET_PHRASE)
        self.assertIn("remove --apply", str(ctx.exception))

    def test_remove_dry_run_changes_nothing_and_remove_apply_removes_only_the_apple_secrets(self):
        api = FakeApi({"ANTHROPIC_API_KEY": "d1", "APPLE_TEAM_ID": "a", "APPLE_KEY_ID": "b", "APPLE_CLIENT_ID": "c", "APPLE_PRIVATE_KEY": "d"})
        code, text = self.go(["remove"], api)
        self.assertEqual(api.mutations(), [])
        self.assertIn("DRY RUN", text)
        with self.assertRaises(mod.Abort):
            self.go(["remove", "--apply"], api, "nope")
        self.assertEqual(api.mutations(), [])
        code, text = self.go(["remove", "--apply"], api, mod.REMOVE_PHRASE)
        deletes = [c for c in api.calls if c[0] == "DELETE"]
        self.assertEqual(len(deletes), 1)
        self.assertEqual(sorted(deletes[0][2]), sorted(mod.NAMES))
        self.assertEqual(set(api.secrets), {"ANTHROPIC_API_KEY"})


if __name__ == "__main__":
    unittest.main()
