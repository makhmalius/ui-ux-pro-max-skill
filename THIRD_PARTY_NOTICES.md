# Third-Party Notices

This repository vendors skills that were not written for UI UX Pro Max. This file
records, per skill, only what the repository itself says about its origin and
license. Nothing here is inferred or supplied from outside the repository: where
the repository records nothing, this file says so. Confirm anything marked
"not recorded in repository" with the upstream project before redistributing.

The repository's own license is in [`LICENSE`](LICENSE) and covers the original
UI UX Pro Max work, not the vendored skills below.

## claudekit-derived skills

The six skills below carry `metadata.author: claudekit` in their `SKILL.md`
frontmatter. The repository records no upstream URL, version source or copyright
holder for them beyond that author string.

| Skill dir (`.claude/skills/`) | Upstream / source as recorded | License as recorded | License text in repository | Modifications made here |
|---|---|---|---|---|
| `banner-design` | `metadata.author: claudekit` (no URL recorded) | `license: MIT` (frontmatter) | None; no MIT text or copyright holder is recorded in repository; confirm with upstream | unknown |
| `brand` | `metadata.author: claudekit` (no URL recorded) | not recorded in repository; confirm with upstream (no `license` field) | none | unknown |
| `design` | `metadata.author: claudekit` (no URL recorded) | `license: MIT` (frontmatter) | None; no MIT text or copyright holder is recorded in repository; confirm with upstream | unknown |
| `design-system` | `metadata.author: claudekit` (no URL recorded) | `license: MIT` (frontmatter) | None; no MIT text or copyright holder is recorded in repository; confirm with upstream | unknown |
| `slides` | `metadata.author: claudekit` (no URL recorded) | not recorded in repository; confirm with upstream (no `license` field) | none | unknown |
| `ui-styling` | `metadata.author: claudekit` (no URL recorded) | `license: MIT` (frontmatter) | See the note below: the directory contains an Apache-2.0 `LICENSE.txt` that conflicts with the frontmatter | unknown |

### ui-styling: files with their own license text

- `.claude/skills/ui-styling/LICENSE.txt` is the Apache License, Version 2.0 text.
  The repository does not say which files it applies to, and `SKILL.md` frontmatter
  says `license: MIT`. This conflict is not resolved in the repository; confirm
  with upstream.
- `.claude/skills/ui-styling/canvas-fonts/` holds font files with per-font license
  files (`*-OFL.txt`, SIL Open Font License) next to them. Those files are the
  license record for the fonts. The fonts ship with the repository checkout only;
  they are deliberately not included in the npm package.

## caveman

| Skill dir | Upstream / source as recorded | License as recorded | License text in repository | Modifications made here |
|---|---|---|---|---|
| `caveman` (`.claude/skills/caveman/`, identical copy in `.agents/skills/caveman/`) | `skills-lock.json`: source `juliusbrussee/caveman`, sourceType `github`, skillPath `skills/caveman/SKILL.md`, with a `computedHash` | not recorded in repository; confirm with upstream | none | See below |

Modification: the sentence in the "Persistence" section of `SKILL.md` that told
the reader to follow the `ultracave` or `megacave` skills and to relay a hook's
`Caveman mode:` value was replaced, because those sibling skills and that hook
are not part of this repository. The `README.md` next to it is unchanged and still
describes those sibling skills. The `computedHash` in `skills-lock.json` is the
hash recorded at install time and no longer matches the edited `SKILL.md`.

## Bundling

The six claudekit-derived skills are bundled into the npm package under
`cli/assets/skills/` (without `canvas-fonts`). `caveman` is not bundled.
