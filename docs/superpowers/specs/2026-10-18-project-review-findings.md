# Project review findings (spec for the remediation plan)

Source: three read-only reviewers (search engine + data, CLI + CI, skill content + docs) at HEAD `834ffd7`.
No Critical findings. Every item below is a requirement: after the work, the finding no longer reproduces.

## Requirements

- **F1** `uipro init --ai all` must not hide per-platform failures. A failing platform is reported by name and the command exits non-zero. (`cli/src/utils/template.ts` `generateAllPlatformFiles`, empty `catch {}`.)
- **F2** When `SKILL.md` already exists and `--force` is not set, `init` must say plainly that nothing was installed (not "installed successfully"), and must still repair missing data/scripts/sub-skills. Skip is decided per artifact, not on `SKILL.md` alone.
- **F3** `uninstall` and `init --force` must only delete/overwrite sub-skill directories (`brand`, `design`, `slides`, `design-system`, `banner-design`, `ui-styling`) that uipro installed. A user's own same-named skill is never removed or overwritten.
- **F4** Single-keyword queries must return the matching row in the small domains. Today `-d icons "graph"`, `-d icons "statistics"`, `-d icons "chart"` and `"dashboard"` in landing/icons/react/web/gsap return nothing although the CSVs contain the keyword. Nonsense single tokens must still return nothing. Cause: `_DOMAIN_SCORE_FLOORS` in `src/ui-ux-pro-max/scripts/core.py`.
- **F5** `init` auto-detection must never default the prompt to `all`; `.github` alone must not count as Copilot.
- **F6** No tracked symlinks (CLAUDE.md rule). `gallery/data/styles.csv` becomes a real file mirrored by `cli/scripts/sync-assets.mjs`; `check:assets` fails if any mode-120000 entry is tracked.
- **F7** `skill.json` `platforms` equals the CLI's supported AI types (no `openclaw`; includes `codewhale`, `zcode`, `universal`). `check:assets` fails on drift. README.id.md / README.ko.md examples must not use `openclaw`.
- **F8** `.github/workflows/release.yml`: no unpinned `bun-version: latest` or unpinned `npx semantic-release`; no unused `id-token: write`; `bump-versions.yml` must not interpolate step output directly into a shell script.
- **F9** CI: PRs run `npm run typecheck` and `npm run build` for `cli/`; a Windows and macOS leg exercises the CLI; `tests.yml`, `smoke-stacks.yml`, `check-asset-sync.yml` declare `permissions: contents: read`; checkout action version is consistent.
- **F10** Vendored third-party skills (claudekit-derived: banner-design, brand, design, design-system, slides, ui-styling; and caveman) get a `THIRD_PARTY_NOTICES.md` that states, per skill, upstream source and license **as recorded in the repo** (frontmatter / LICENSE files / skills-lock.json). Do not invent copyright holders or license text. `caveman` SKILL.md must not point at skills that are not in the repo.
- **F11** Remove tracked junk (`.claude/skills/ui-styling/scripts/.coverage`, `.claude/skills/ui-styling/scripts/tests/coverage-ui.json`), ignore it, and make `cli/assets/skills` a faithful mirror of `.claude/skills` (currently `ui-styling/canvas-fonts` is missing) with `check:assets` covering sub-skills.
- **F12** `stack/README.md` counts match reality (79 searchable styles, 74 font pairings, 119 UX guidelines); `stack/.mcp.json` does not use `@latest`.
- **F13** Unreachable `--legacy` ZIP install code in `cli/src/commands/init.ts` (and now-orphaned helpers in `cli/src/utils/extract.ts` / `github.ts`) is deleted. `--offline` and `--token` stay accepted on `init` for script compatibility.
- **F14** A query with no indexable tokens (e.g. `"日本語 デザイン"`) prints a distinct message instead of "No matches".

## Minor (also in scope)

- m1 Non-interactive `init` without `--ai` exits non-zero with a clear message.
- m2 `search.py` docstring version is current; `sys.stdout` UTF-8 handling uses `reconfigure(encoding="utf-8", errors="replace")` in `search.py` and `design_system.py`.
- m3 CLAUDE.md documents `-n` range 1-20, dial range 1-10, `--stack` default, and the design-system flags (`--persist`, `--page`, `--output-dir`, `--format`).
- m4 CONTRIBUTING.md does not reference nonexistent `.factory/`.
- m5 Raw `&lt;` in `SKILL.md` / templates becomes `<` where it is a literal comparison.
- m6 `sync-assets.mjs` `assertInsideRepo` uses `path.relative`, not `startsWith`; duplicate `PlatformConfig` interface and unused `platformName` variable in `template.ts` removed.
- m7 Bump `_INDEX_VERSION` / `_SEARCH_CALIBRATION_VERSION` when scoring changes (cache invalidation).

## Out of scope (ruled, to be reported)

- Major dependency upgrades (commander, chalk, ora, TypeScript): behaviour risk without a user-visible gain.
- `update.ts` offline fallback / confirmation before `npm install -g`: needs a product decision.
- Pinning GitHub Actions by commit SHA: only if SHAs can be resolved in this environment.
- English docs index, trimming binaries / Git LFS, Copilot sub-skill clutter, demo READMEs for `preview/` and `projects/`.
