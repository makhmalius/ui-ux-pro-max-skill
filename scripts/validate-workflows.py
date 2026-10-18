#!/usr/bin/env python3
"""Static checks for .github/workflows/*.yml (cannot run Actions locally).

Exit 0 when clean, 1 with one line per violation ("<file>: <rule>: <detail>").
Requires PyYAML (CI: `pip install pyyaml`).

Usage: python3 scripts/validate-workflows.py [workflows_dir]
"""
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("validate-workflows.py needs PyYAML: pip install pyyaml")

PERMISSIONS_REQUIRED = ("tests.yml", "smoke-stacks.yml", "check-asset-sync.yml")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
EXPR_RE = re.compile(r"\$\{\{(.*?)\}\}", re.S)
UNSAFE_EXPR_RE = re.compile(r"\b(steps|needs)\.|\bgithub\.event|\bgithub\.head_ref")


def steps_of(doc):
    """Yield (job_name, step_dict) for every step of every job."""
    for job_name, job in (doc.get("jobs") or {}).items():
        for step in (job or {}).get("steps") or []:
            if isinstance(step, dict):
                yield job_name, step


def check_workflow(path, doc, text):
    name = path.name
    out = []

    def bad(rule, detail):
        out.append(f"{name}: {rule}: {detail}")

    if not isinstance(doc, dict):
        bad("parse", "not a YAML mapping")
        return out

    runs = [(j, s.get("run", "")) for j, s in steps_of(doc) if isinstance(s.get("run"), str)]

    # No floating bun.
    if re.search(r"bun-version:\s*['\"]?latest\b", text):
        bad("pin-bun", "bun-version: latest is not allowed; use an explicit version")

    # semantic-release via npx must be fully versioned.
    for job, run in runs:
        if "semantic-release" not in run or "npx" not in run:
            continue
        pkgs = re.findall(r"(?:^|\s)-p\s+(\S+)", run)
        if not any(p.startswith("semantic-release@") for p in pkgs):
            bad("pin-semantic-release", f"job {job}: npx semantic-release without '-p semantic-release@<version>'")
        for p in pkgs:
            if not re.search(r"(?<=.)@\d[^\s@]*$", p):
                bad("pin-semantic-release", f"job {job}: '-p {p}' has no @<version>")

    # Least privilege permissions on read-only workflows.
    if name in PERMISSIONS_REQUIRED and "permissions" not in doc:
        bad("permissions", "missing top-level 'permissions:'")

    # Unused OIDC permission.
    if name == "release.yml" and re.search(r"id-token:\s*write", text):
        bad("id-token", "'id-token: write' is not used by release.yml; remove it")

    # Script injection: no step/event-derived expressions inside run scripts.
    if name == "bump-versions.yml":
        for job, run in runs:
            for m in EXPR_RE.finditer(run):
                if UNSAFE_EXPR_RE.search(m.group(1)):
                    bad("run-expression", f"job {job}: '${{{{{m.group(1)}}}}}' interpolated in run:; pass via env:")

    # CLI jobs must typecheck and build.
    if name == "tests.yml":
        for needle in ("npm run typecheck", "npm run build"):
            if not any(
                needle in str(s.get("run", ""))
                and (s.get("working-directory") == "cli" or "--prefix cli" in str(s.get("run", "")))
                for _, s in steps_of(doc)
            ):
                bad("tests-steps", f"no cli/ step runs '{needle}'")

    # Playwright needs full history (cli/tests/e2e/ownership.spec.ts reads git history).
    for job_name, job in (doc.get("jobs") or {}).items():
        steps = [s for s in (job or {}).get("steps") or [] if isinstance(s, dict)]
        if not any("playwright test" in str(s.get("run", "")) for s in steps):
            continue
        checkouts = [s for s in steps if str(s.get("uses", "")).startswith("actions/checkout@")]
        if not checkouts:
            bad("playwright-fetch-depth", f"job {job_name}: runs playwright but has no checkout step")
        for s in checkouts:
            if str((s.get("with") or {}).get("fetch-depth", "1")) != "0":
                bad("playwright-fetch-depth", f"job {job_name}: checkout needs 'fetch-depth: 0' (playwright reads git history)")

    # Every uses: pinned by full commit SHA.
    for job, step in steps_of(doc):
        ref = step.get("uses")
        if isinstance(ref, str) and not ref.startswith("./"):
            _, _, rev = ref.partition("@")
            if not SHA_RE.match(rev):
                bad("sha-pin", f"job {job}: '{ref}' is not pinned to a 40-hex commit SHA")
    for job_name, job in (doc.get("jobs") or {}).items():
        ref = (job or {}).get("uses")
        if isinstance(ref, str) and not ref.startswith("./") and not SHA_RE.match(ref.partition("@")[2]):
            bad("sha-pin", f"job {job_name}: '{ref}' is not pinned to a 40-hex commit SHA")
    return out


def validate(wf_dir):
    wf_dir = Path(wf_dir)
    files = sorted(wf_dir.glob("*.yml")) + sorted(wf_dir.glob("*.yaml"))
    out = []
    for f in files:
        text = f.read_text(encoding="utf-8")
        try:
            doc = yaml.safe_load(text)
        except yaml.YAMLError as e:
            out.append(f"{f.name}: parse: {e}")
            continue
        out += check_workflow(f, doc, text)
    # One checkout version across all workflows (compare pins incl. trailing comment).
    pins = {}
    for f in files:
        for m in re.finditer(r"actions/checkout@([0-9a-fA-F]{40}|\S+)(?:[ \t]+#[ \t]*(\S+))?", f.read_text(encoding="utf-8")):
            pins.setdefault((m.group(1), m.group(2) or ""), []).append(f.name)
    if len(pins) > 1:
        detail = "; ".join(f"{k[0]} {k[1]} in {sorted(set(v))}" for k, v in sorted(pins.items()))
        out.append(f"(all): checkout-version: actions/checkout used with more than one version: {detail}")
    return out


def main(argv):
    root = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent.parent / ".github" / "workflows"
    problems = validate(root)
    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} workflow violation(s)", file=sys.stderr)
        return 1
    print(f"OK: workflows in {root} pass")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
