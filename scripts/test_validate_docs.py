"""Self-test: each validate-docs.py rule fires on a crafted violation."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location("validate_docs", Path(__file__).with_name("validate-docs.py"))
vd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vd)

GOOD = {
    "THIRD_PARTY_NOTICES.md": "# Notices\n" + "\n".join(f"- {n}" for n in vd.VENDORED) + "\n",
    "stack/README.md": "79 searchable styles, 74 font pairings, 119 UX guidelines\n",
    "stack/.mcp.json": '{"args": ["-y", "@playwright/mcp@0.0.83"]}\n',
    ".claude/skills/ui-ux-pro-max/SKILL.md": "Reserve space (CLS < 0.1)\n",
    "src/ui-ux-pro-max/templates/base/skill-content.md": "Text < 12px\n",
    "src/ui-ux-pro-max/templates/base/quick-reference.md": "CLS < 0.1\n",
    "CONTRIBUTING.md": "tree without the bad dir\n",
    ".claude/skills/caveman/SKILL.md": "Follow the `caveman` skill.\n",
    ".claude/skills/brand/SKILL.md": "x\n",
}


def run_with(overrides):
    files = dict(GOOD)
    files.update(overrides)
    with tempfile.TemporaryDirectory() as d:
        for rel, text in files.items():
            if text is None:
                continue
            p = Path(d, rel)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
        return vd.validate(d)


class ValidateDocs(unittest.TestCase):
    def assertRule(self, problems, rule):
        self.assertTrue([p for p in problems if f": {rule}:" in p], f"{rule} did not fire; got {problems}")

    def test_good_fixture_is_clean(self):
        self.assertEqual(run_with({}), [])

    def test_notices_missing(self):
        self.assertRule(run_with({"THIRD_PARTY_NOTICES.md": None}), "notices-exist")

    def test_notices_missing_skill(self):
        t = GOOD["THIRD_PARTY_NOTICES.md"].replace("- caveman", "")
        self.assertRule(run_with({"THIRD_PARTY_NOTICES.md": t}), "notices-skill")

    def test_notices_substring_is_not_a_mention(self):
        t = GOOD["THIRD_PARTY_NOTICES.md"].replace("- design\n", "").replace("design-system", "xdesign-system")
        self.assertRule(run_with({"THIRD_PARTY_NOTICES.md": t}), "notices-skill")

    def test_stack_counts(self):
        for old in ("79 searchable styles", "74 font pairings", "119 UX guidelines"):
            t = GOOD["stack/README.md"].replace(old, "1 thing")
            self.assertRule(run_with({"stack/README.md": t}), "stack-counts")

    def test_mcp_latest(self):
        self.assertRule(run_with({"stack/.mcp.json": '{"a": "x@latest"}'}), "mcp-pin")

    def test_literal_lt(self):
        for rel in vd.LITERAL_FILES:
            self.assertRule(run_with({rel: "CLS &lt; 0.1\n"}), "literal-lt")

    def test_factory(self):
        self.assertRule(run_with({"CONTRIBUTING.md": "├── .factory/\n"}), "no-factory")

    def test_caveman_missing_skill_ref(self):
        self.assertRule(run_with({".claude/skills/caveman/SKILL.md": "use the `ultracave` skill\n"}), "caveman-refs")

    def test_caveman_hook_ref(self):
        self.assertRule(run_with({".claude/skills/caveman/SKILL.md": "Relay the hook value\n"}), "caveman-refs")

    def test_real_repo_passes(self):
        self.assertEqual(vd.validate(Path(__file__).resolve().parent.parent), [])


if __name__ == "__main__":
    unittest.main()
