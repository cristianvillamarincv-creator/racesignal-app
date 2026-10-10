import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("dryrun", pathlib.Path(__file__).with_name("revenuecat-backfill-dryrun.py"))
dryrun = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dryrun)

ACCOUNT = "315411d2-f74b-49ac-9f40-8a818064d4c8"
ORPHAN = "028b609d-05ef-4b73-a937-4681ef9a1cee"


class Classify(unittest.TestCase):
    def test_kinds(self):
        accounts = {ACCOUNT}
        self.assertEqual(dryrun.classify(ACCOUNT, accounts), "matched")
        self.assertEqual(dryrun.classify(ORPHAN, accounts), "orphan")
        self.assertEqual(dryrun.classify("$RCAnonymousID:1a0033c1ae294ba5bfa92d3f7eaaf52d", accounts), "anonymous")
        self.assertEqual(dryrun.classify("some-custom-id", accounts), "other")

    def test_flag_needs_every_check_and_no_data(self):
        self.assertEqual(dryrun.review_flag(0, 0, 0), "candidate: no purchase data")
        self.assertTrue(dryrun.review_flag(0, 1, 0).startswith("review"))
        self.assertTrue(dryrun.review_flag(1, 0, 0).startswith("review"))
        self.assertTrue(dryrun.review_flag(0, None, 0).startswith("review"))

    def test_summary_never_lists_matched_or_anonymous(self):
        out = dryrun.summarize([ACCOUNT, ORPHAN, "$RCAnonymousID:x"], {ACCOUNT}, {ORPHAN: (0, 0, 0)})
        self.assertEqual((out["matched"], out["anonymous"], out["other"]), (1, 1, 0))
        self.assertEqual(out["orphans"], [(ORPHAN, "candidate: no purchase data")])

    def test_unchecked_orphan_is_review_not_candidate(self):
        out = dryrun.summarize([ORPHAN], set(), {})
        self.assertTrue(out["orphans"][0][1].startswith("review"))


class NoDeletePath(unittest.TestCase):
    def test_script_only_issues_get_requests_and_has_no_delete_verb(self):
        source = pathlib.Path(__file__).with_name("revenuecat-backfill-dryrun.py").read_text()
        code = source.split('"""', 2)[2]  # drop the module docstring, which explains that it cannot delete
        for forbidden in ('"DELETE"', "'DELETE'", '"POST"', '"PUT"', '"PATCH"', "method=\"DELETE\""):
            if forbidden == '"POST"':
                continue  # the one POST is the database SELECT, checked below
            self.assertNotIn(forbidden, code)
        self.assertEqual(code.count("method=\"POST\""), 1)
        self.assertIn("select id from auth.users", code)


if __name__ == "__main__":
    unittest.main()
