#!/usr/bin/env python3
"""Static documentation/licensing checks (stdlib only).

Exit 0 when clean, 1 with one line per violation ("<file>: <rule>: <detail>").

Usage: python3 scripts/validate-docs.py [repo_root]
"""
import re
import sys
from pathlib import Path

VENDORED = ("banner-design", "brand", "design", "design-system", "slides", "ui-styling", "caveman")
LITERAL_LT_RE = re.compile(r"&lt;\s*\d")
LITERAL_FILES = (
    ".claude/skills/ui-ux-pro-max/SKILL.md",
    "src/ui-ux-pro-max/templates/base/skill-content.md",
    "src/ui-ux-pro-max/templates/base/quick-reference.md",
)
# Skill-like references in caveman: on any line that mentions "skill", every
# bare backticked lowercase word (not `/command`) names a skill and must exist.
SKILL_REF_RE = re.compile(r"`([a-z][a-z0-9-]*)`")


def read(root, rel):
    p = root / rel
    return p.read_text(encoding="utf-8") if p.is_file() else None


def validate(root):
    root = Path(root)
    out = []

    def bad(f, rule, detail):
        out.append(f"{f}: {rule}: {detail}")

    notices = read(root, "THIRD_PARTY_NOTICES.md")
    if notices is None:
        bad("THIRD_PARTY_NOTICES.md", "notices-exist", "file is missing")
    else:
        for name in VENDORED:
            if not re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", notices):
                bad("THIRD_PARTY_NOTICES.md", "notices-skill", f"does not mention vendored skill '{name}'")

    readme = read(root, "stack/README.md")
    if readme is None:
        bad("stack/README.md", "stack-counts", "file is missing")
    else:
        for pat, label in ((r"\b79 searchable (UI )?styles", "79 searchable styles"),
                           (r"\b74 font pairings", "74 font pairings"),
                           (r"\b119 UX guidelines", "119 UX guidelines")):
            if not re.search(pat, readme):
                bad("stack/README.md", "stack-counts", f"expected '{label}'")

    mcp = read(root, "stack/.mcp.json")
    if mcp is None:
        bad("stack/.mcp.json", "mcp-pin", "file is missing")
    elif "@latest" in mcp:
        bad("stack/.mcp.json", "mcp-pin", "'@latest' is not allowed; pin an explicit version")

    for rel in LITERAL_FILES:
        text = read(root, rel)
        if text is None:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if LITERAL_LT_RE.search(line):
                bad(rel, "literal-lt", f"line {i}: raw '&lt;' in a literal comparison; use '<'")

    contrib = read(root, "CONTRIBUTING.md")
    if contrib is not None and ".factory/" in contrib:
        bad("CONTRIBUTING.md", "no-factory", "references nonexistent '.factory/'")

    skills_dir = root / ".claude" / "skills"
    cave = read(root, ".claude/skills/caveman/SKILL.md")
    if cave is not None:
        existing = {p.name for p in skills_dir.iterdir() if p.is_dir()} if skills_dir.is_dir() else set()
        for line in cave.splitlines():
            if not re.search(r"\bskills?\b", line):
                continue
            for m in SKILL_REF_RE.finditer(line):
                if m.group(1) not in existing:
                    bad(".claude/skills/caveman/SKILL.md", "caveman-refs", f"references skill '{m.group(1)}' that is not under .claude/skills/")
        for m in re.finditer(r"\bhook\b", cave):
            bad(".claude/skills/caveman/SKILL.md", "caveman-refs", "references a hook that is not shipped here")
            break
    return out


def main(argv):
    root = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parent.parent
    problems = validate(root)
    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} docs violation(s)", file=sys.stderr)
        return 1
    print(f"OK: docs in {root} pass")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
