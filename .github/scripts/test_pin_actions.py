import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import pin_actions as pa  # noqa: E402

SHA_A = "a" * 40
SHA_B = "b" * 40


class Parse(unittest.TestCase):
    def test_finds_plain_list_and_nested_references(self):
        self.assertEqual(pa.parse("      - uses: actions/checkout@v4\n")["ref"], "v4")
        self.assertEqual(pa.parse("        uses: actions/setup-node@v4\n")["action"], "actions/setup-node")
        p = pa.parse("      - uses: github/codeql-action/upload-sarif@v3\n")
        self.assertEqual((p["action"], p["ref"]), ("github/codeql-action/upload-sarif", "v3"))
        self.assertEqual(pa.repo_of(p["action"]), "github/codeql-action")

    def test_ignores_what_is_not_pinnable(self):
        for line in ["      - uses: ./.github/actions/local\n", "        uses: docker://alpine:3.19\n", "      - run: echo uses: x/y@v1\n",
                     "      - name: uses: nope\n", "name: x\n", "\n"]:
            self.assertIsNone(pa.parse(line), line)

    def test_knows_what_is_pinned(self):
        self.assertTrue(pa.is_pinned(SHA_A))
        for ref in ["v4", "main", "a" * 39, "a" * 41, "A" * 40, "g" * 40]:
            self.assertFalse(pa.is_pinned(ref), ref)

    def test_keeps_an_existing_pin_and_its_comment_untouched(self):
        line = f"        uses: aquasecurity/trivy-action@{SHA_A} # v0.36.0 (pinned by commit)\n"
        out, changes = pa.rewrite([line], lambda a, r: 1 / 0)
        self.assertEqual(out, [line])
        self.assertEqual(changes, [])


class Rewrite(unittest.TestCase):
    def test_pins_with_the_original_ref_as_a_comment_and_keeps_indentation(self):
        calls = []

        def resolver(action, ref):
            calls.append((action, ref))
            return SHA_B

        out, changes = pa.rewrite(["  steps:\n", "      - uses: actions/checkout@v4\n", "      - uses: actions/checkout@v4\n", "        with:\n"], resolver)
        self.assertEqual(out[1], f"      - uses: actions/checkout@{SHA_B} # v4\n")
        self.assertEqual(out[0], "  steps:\n")
        self.assertEqual(len(changes), 2)
        self.assertEqual(calls, [("actions/checkout", "v4")])          # resolved once, not per line

    def test_a_subpath_action_resolves_against_its_repository(self):
        seen = []
        pa.rewrite(["- uses: github/codeql-action/upload-sarif@v3\n"], lambda a, r: seen.append(a) or SHA_A)
        self.assertEqual(seen, ["github/codeql-action/upload-sarif"])

    def test_check_lists_only_unpinned(self):
        lines = ["- uses: actions/checkout@v4\n", f"- uses: actions/cache@{SHA_A} # v4\n", "- uses: ./local\n"]
        self.assertEqual([n for n, _ in pa.unpinned(lines)], [1])


class Resolve(unittest.TestCase):
    class R:
        def __init__(self, stdout, rc=0):
            self.stdout, self.returncode, self.stderr = stdout, rc, "boom"

    def runner(self, text, rc=0):
        return lambda *a, **k: Resolve.R(text, rc)

    def test_prefers_the_peeled_commit_of_an_annotated_tag(self):
        text = f"{SHA_A}\trefs/tags/v1\n{SHA_B}\trefs/tags/v1^{{}}\n"
        self.assertEqual(pa.resolve("o/r", "v1", self.runner(text)), SHA_B)

    def test_uses_a_lightweight_tag_then_a_branch(self):
        self.assertEqual(pa.resolve("o/r", "v1", self.runner(f"{SHA_A}\trefs/tags/v1\n")), SHA_A)
        self.assertEqual(pa.resolve("o/r", "main", self.runner(f"{SHA_B}\trefs/heads/main\n")), SHA_B)

    def test_fails_loudly_rather_than_guessing(self):
        with self.assertRaises(RuntimeError):
            pa.resolve("o/r", "nope", self.runner(""))
        with self.assertRaises(RuntimeError):
            pa.resolve("o/r", "v1", self.runner("", rc=128))
        with self.assertRaises(RuntimeError):                       # a malformed answer is not a SHA
            pa.resolve("o/r", "v1", self.runner("zzzz\trefs/tags/v1\n"))


if __name__ == "__main__":
    unittest.main()
