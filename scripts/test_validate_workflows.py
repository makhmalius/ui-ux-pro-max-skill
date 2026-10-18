"""Self-test: each validate-workflows.py rule fires on a crafted violation."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "validate_workflows", Path(__file__).with_name("validate-workflows.py")
)
vw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vw)

SHA = "a" * 40
GOOD = {
    "tests.yml": f"""
name: t
on: push
permissions:
  contents: read
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@{SHA} # v6.1.0
        with:
          fetch-depth: 0
      - run: npm run typecheck
        working-directory: cli
      - run: npm run build
        working-directory: cli
      - run: npx playwright test
        working-directory: cli
""",
    "smoke-stacks.yml": "name: s\non: push\npermissions:\n  contents: read\njobs: {}\n",
    "check-asset-sync.yml": "name: c\non: push\npermissions:\n  contents: read\njobs: {}\n",
    "release.yml": f"""
name: r
on: push
permissions:
  contents: write
jobs:
  r:
    runs-on: ubuntu-latest
    steps:
      - uses: oven-sh/setup-bun@{SHA} # v2.2.0
        with:
          bun-version: 1.4.3
      - run: |
          npx --yes -p semantic-release@25.0.9 -p @semantic-release/npm@13.2.0 semantic-release
""",
    "bump-versions.yml": """
name: b
on: push
jobs:
  b:
    runs-on: ubuntu-latest
    steps:
      - env:
          V: ${{ steps.version.outputs.version }}
        run: echo "$V"
""",
}


def run_with(overrides):
    files = dict(GOOD)
    files.update(overrides)
    with tempfile.TemporaryDirectory() as d:
        for name, text in files.items():
            Path(d, name).write_text(text, encoding="utf-8")
        return vw.validate(d)


class ValidateWorkflows(unittest.TestCase):
    def assertRule(self, problems, rule, fname=None):
        hits = [p for p in problems if f": {rule}:" in p and (fname is None or p.startswith(fname))]
        self.assertTrue(hits, f"{rule} did not fire; got {problems}")

    def test_good_fixture_is_clean(self):
        self.assertEqual(run_with({}), [])

    def test_bun_latest(self):
        t = GOOD["release.yml"].replace("1.4.3", "latest")
        self.assertRule(run_with({"release.yml": t}), "pin-bun", "release.yml")

    def test_unpinned_semantic_release(self):
        t = GOOD["release.yml"].replace("semantic-release@25.0.9", "semantic-release")
        self.assertRule(run_with({"release.yml": t}), "pin-semantic-release")

    def test_unpinned_plugin(self):
        t = GOOD["release.yml"].replace("@semantic-release/npm@13.2.0", "@semantic-release/npm")
        self.assertRule(run_with({"release.yml": t}), "pin-semantic-release")

    def test_missing_permissions(self):
        for f in vw.PERMISSIONS_REQUIRED:
            t = GOOD[f].replace("permissions:\n  contents: read\n", "")
            self.assertRule(run_with({f: t}), "permissions", f)

    def test_id_token(self):
        t = GOOD["release.yml"].replace("permissions:\n  contents: write", "permissions:\n  contents: write\n  id-token: write")
        self.assertRule(run_with({"release.yml": t}), "id-token")

    def test_run_expression(self):
        t = GOOD["bump-versions.yml"].replace('run: echo "$V"', 'run: echo "${{ steps.version.outputs.version }}"')
        self.assertRule(run_with({"bump-versions.yml": t}), "run-expression")
        t = GOOD["bump-versions.yml"].replace('run: echo "$V"', 'run: echo "${{ github.event.release.tag_name }}"')
        self.assertRule(run_with({"bump-versions.yml": t}), "run-expression")

    def test_tests_missing_typecheck_and_build(self):
        t = GOOD["tests.yml"].replace("npm run typecheck", "echo x").replace("npm run build", "echo y")
        problems = run_with({"tests.yml": t})
        self.assertEqual(len([p for p in problems if "tests-steps" in p]), 2, problems)

    def test_tests_build_must_be_cli(self):
        t = GOOD["tests.yml"].replace("npm run build\n        working-directory: cli", "npm run build\n        working-directory: gallery")
        self.assertRule(run_with({"tests.yml": t}), "tests-steps")

    def test_checkout_versions_differ(self):
        t = GOOD["smoke-stacks.yml"].replace("jobs: {}", f"jobs:\n  s:\n    runs-on: x\n    steps:\n      - uses: actions/checkout@{'b' * 40} # v6.0.0\n")
        self.assertRule(run_with({"smoke-stacks.yml": t}), "checkout-version")

    def test_playwright_needs_full_history(self):
        t = GOOD["tests.yml"].replace("          fetch-depth: 0\n", "          fetch-depth: 1\n")
        self.assertRule(run_with({"tests.yml": t}), "playwright-fetch-depth")
        t = GOOD["tests.yml"].replace("        with:\n          fetch-depth: 0\n", "")
        self.assertRule(run_with({"tests.yml": t}), "playwright-fetch-depth")

    def test_sha_pin(self):
        t = GOOD["tests.yml"].replace(f"actions/checkout@{SHA}", "actions/checkout@v6")
        self.assertRule(run_with({"tests.yml": t}), "sha-pin")

    def test_real_workflows_pass(self):
        root = Path(__file__).resolve().parent.parent / ".github" / "workflows"
        self.assertEqual(vw.validate(root), [])


if __name__ == "__main__":
    unittest.main()
