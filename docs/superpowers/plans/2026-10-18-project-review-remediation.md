# Project Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding (F1-F14 plus minors m1-m7) from the whole-project review so none of them reproduces.

**Architecture:** Six sequential tasks grouped by subsystem: Python search (T1), CLI install semantics (T2), CLI ownership of installed sub-skills (T3), repo hygiene + asset-sync checks (T4), CI workflows (T5), docs/licensing/minor cleanups (T6). Each task is test-first where code behaviour changes and ends with the repo's gates green and a commit.

**Tech Stack:** Python 3 stdlib + `unittest` (`src/ui-ux-pro-max/scripts/tests`), TypeScript CLI (`cli/`, Playwright specs in `cli/tests/e2e`, `npm run typecheck`, `npm run build`), Node `.mjs` sync script, GitHub Actions YAML.

**Spec:** `docs/superpowers/specs/2026-10-18-project-review-findings.md`

## Global Constraints

- Source of truth is `src/ui-ux-pro-max/`; after any change under `src/ui-ux-pro-max/{data,scripts,templates}` run `cd cli && npm run sync:assets && npm run check:assets` and commit the mirrors (`cli/assets/`, `.claude/skills/ui-ux-pro-max/{data,scripts}`). `.claude/skills/ui-ux-pro-max/SKILL.md` is hand-authored.
- No symlinks anywhere in the repo.
- Python: stdlib only, must also work on Windows (`python` vs `python3`), UTF-8 explicit.
- Work only on branch `claude/monthly-partnerships-dashboard-31bpa0`. Never push to `main`. Do not open a PR.
- Commit messages: conventional style (`fix(cli): ...`), one commit per task minimum, ending with the two attribution lines from the session reminder (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_016LoQCLydq2x5pmuTMCg8GQ`). Do not name a model anywhere else.
- Gates before each commit: `python3 -m unittest discover -s src/ui-ux-pro-max/scripts/tests -p 'test_*.py'` (all pass), `cd cli && npm run typecheck && npm run build && npm run check:assets` (when `cli/` or mirrored files change), and `cd cli && npx playwright test` when CLI behaviour changes.
- Do not invent license text or copyright holders (F10).

## Review Focus

- Gibberish single token (`zzqxv`) in every domain still returns no results after the floor change (precision must not regress; `scripts/evaluate-relevance.py` still passes).
- `init --ai all` in a project where one platform dir is a regular file: failure named, exit 1, the other platforms still installed.
- `init` run twice without `--force`: second run says "nothing installed", exit 0, and a deleted `data/` dir is restored.
- `uninstall` in a project containing the user's own `.claude/skills/design/SKILL.md` leaves it untouched; a legacy uipro install (no marker, SKILL.md identical to bundled) is still removed.
- `check:assets` fails when a symlink is tracked, when `skill.json` platforms drift from `AI_TYPES`, and when a sub-skill file differs from its mirror.

---

### Task 1: Search engine — single-term recall, no-token message, stdout, docs (F4, F14, m2, m3, m7)

**Files:**
- Modify: `src/ui-ux-pro-max/scripts/core.py` (`_DOMAIN_SCORE_FLOORS` / `_SEARCH_THRESHOLDS` use near lines 200-215 and the abstain logic near 440-480; `_INDEX_VERSION`, `_SEARCH_CALIBRATION_VERSION`; the user-facing "No matches" formatting path)
- Modify: `src/ui-ux-pro-max/scripts/search.py` (docstring version; lines ~36-39 stdout handling), `src/ui-ux-pro-max/scripts/design_system.py` (lines ~31-34 stdout handling)
- Modify: `CLAUDE.md` (m3)
- Test: `src/ui-ux-pro-max/scripts/tests/test_single_term_recall.py` (create)

**Interfaces:**
- Consumes: the existing search entry point in `core.py` that `search.py` calls per domain (read `search.py` to find its name and signature) and the existing `test_core.py` style for calling it.
- Produces: no new public API. Behaviour: a single-term query whose term exactly matches a row keyword/identity returns that row; queries with zero indexable tokens produce the text `No searchable terms in query`.

- [ ] **Step 1: Write failing tests** in `test_single_term_recall.py`:
  - `test_exact_single_keyword_returns_row` parametrized over at least these `(domain, query)` pairs, each asserting ≥1 result: `("icons","graph")`, `("icons","statistics")`, `("icons","chart")`, `("landing","dashboard")`, `("icons","dashboard")`, `("react","dashboard")`, `("web","dashboard")`, `("gsap","dashboard")`. Before writing, confirm each pair's keyword really exists in the domain CSV; replace a pair with another real keyword from that CSV if not, keeping ≥8 pairs across icons, react, web, gsap, landing.
  - `test_gibberish_single_token_returns_nothing` for every domain with query `zzqxvkw`: zero results.
  - `test_query_without_indexable_tokens_says_so`: query `日本語 デザイン` through the CLI path (subprocess of `search.py`, `-d style`) prints `No searchable terms in query` and exits 0.
- [ ] **Step 2: Run** `python3 -m unittest src/ui-ux-pro-max/scripts/tests/test_single_term_recall.py -v` (or discover with `-p test_single_term_recall.py`). Expected: first and third tests FAIL, gibberish test PASSES.
- [ ] **Step 3: Implement** in `core.py`: apply the absolute `min_score` floor only when the query has ≥2 indexed terms, or when the top hit has no exact keyword/identity-field match for any query term (choose the smallest change that makes the tests pass and keeps `scripts/evaluate-relevance.py` passing). Add the no-indexable-token branch with the exact message above. Bump `_INDEX_VERSION` and set `_SEARCH_CALIBRATION_VERSION` to a new value so cached indexes/calibration are invalidated.
- [ ] **Step 4: Implement** m2/m3: in `search.py` and `design_system.py` replace the `TextIOWrapper` replacement with `sys.stdout.reconfigure(encoding="utf-8", errors="replace")` (guard with `hasattr`); set the `search.py` docstring version to the value in `skill.json`; in `CLAUDE.md` document `-n` (1-20), dial range (1-10), `--stack` default `html-tailwind`, and the design-system flags (`--persist`, `--page`, `--output-dir`, `--format`) by reading `search.py --help`.
- [ ] **Step 5: Run gates**: full unittest discover (all pass, including `test_relevance_evaluator.py`), `python3 scripts/evaluate-relevance.py`, `bash scripts/smoke-domains.sh`, then `cd cli && npm run sync:assets && npm run check:assets`.
- [ ] **Step 6: Commit** `fix(search): return exact single-keyword matches, report queries without searchable terms` (include mirrors).

### Task 2: CLI install semantics (F1, F2, F5, F13, m1)

**Files:**
- Modify: `cli/src/utils/template.ts` (`generatePlatformFiles`, `generateAllPlatformFiles`, `copyDataAndScripts`, `copySubSkills`), `cli/src/commands/init.ts`, `cli/src/utils/detect.ts`, `cli/src/index.ts`
- Delete (if unreferenced after this task, verify with grep): `cli/src/utils/extract.ts`; remove `downloadRelease`/`getAssetUrl` from `cli/src/utils/github.ts` only if no remaining importer (`versions.ts`, `update.ts` use other exports — keep those)
- Test: `cli/tests/e2e/install-semantics.spec.ts` (create; follow the style of `cli/tests/e2e/dry-run.spec.ts`), update `cli/tests/e2e/*.spec.ts` that assert old detect/suggested behaviour

**Interfaces:**
- Produces in `template.ts`:
  - `export interface InstallResult { folders: string[]; skipped: string[]; }`
  - `export interface InstallAllResult extends InstallResult { failures: { aiType: string; error: string }[]; }`
  - `generatePlatformFiles(targetDir: string, aiType: string, isGlobal?: boolean, force?: boolean): Promise<InstallResult>` (throws on failure)
  - `generateAllPlatformFiles(targetDir: string, isGlobal?: boolean, force?: boolean): Promise<InstallAllResult>`
- Produces in `detect.ts`: `detectAIType` never returns `suggested: 'all'`; with several detections `suggested` is the first detected type; Copilot is detected only when `.github/prompts` exists.

- [ ] **Step 1: Write failing Playwright tests** (run the built CLI or import TS the way existing specs do) in a temp dir:
  - `init --ai all` with a regular file named `.cursor`: exit code 1, stderr/stdout names `cursor`, `.windsurf` etc. still installed.
  - `init --ai claude` twice: second run output contains `Nothing installed` and exit 0; after `rm -rf .claude/skills/ui-ux-pro-max/data`, a third run (no `--force`) recreates `data/` while leaving a modified `SKILL.md` untouched.
  - `detectAIType` in a dir with `.claude` and `.cursor` and `.github` returns `suggested === 'claude'` (first detected) and never `'all'`; a dir with only `.github` detects nothing; `.github/prompts` detects `copilot`.
  - `init` with no `--ai` and stdin not a TTY exits 1 with `--ai` mentioned in the message.
- [ ] **Step 2: Run** `cd cli && npx playwright test tests/e2e/install-semantics.spec.ts`. Expected: FAIL on each new assertion.
- [ ] **Step 3: Implement** the `template.ts` result types: collect per-platform errors in `generateAllPlatformFiles` instead of `catch {}`; `generatePlatformFiles` writes `SKILL.md` only if absent or `force`, copies `data`/`scripts` when the target dir is absent or `force`, copies missing sub-skills (ownership rules arrive in Task 3), and records `skipped` entries for what it left alone.
- [ ] **Step 4: Implement** `init.ts`: print skipped/failed; if `failures.length > 0` print each and `process.exit(1)`; if `folders` is empty print a `Nothing installed (already present; use --force to overwrite)` warning instead of the success banner; non-TTY without `--ai` → error + exit 1; delete the unreachable `--legacy` code (`tryGitHubInstall`, `copyFolders`/`installFromZip` use, `ASSETS_DIR` if now unused). Keep `--offline` and `--token` accepted. Update `detect.ts` per Interfaces and `getAITypeDescription` untouched.
- [ ] **Step 5: Run gates**: `npx playwright test` (all), `npm run typecheck`, `npm run build`.
- [ ] **Step 6: Commit** `fix(cli): report install failures and skips honestly, safer auto-detect, drop dead legacy path`.

### Task 3: CLI only touches skills it installed (F3)

**Files:**
- Modify: `cli/src/utils/template.ts` (`copySubSkills`), `cli/src/commands/uninstall.ts` (`removeSkillDir`)
- Test: `cli/tests/e2e/ownership.spec.ts` (create)

**Interfaces:**
- Consumes: Task 2 `generatePlatformFiles`/`InstallResult`.
- Produces in `template.ts`: `export const OWNER_MARKER = '.uipro-managed'` and `export async function isManagedSkill(targetDir: string, bundledSkillDir: string): Promise<boolean>`. A dir is managed if it contains the marker file, or (legacy install) its `SKILL.md` is byte-identical to the bundled `SKILL.md`.

- [ ] **Step 1: Write failing tests**: (a) user dir `.claude/skills/design/SKILL.md` with custom content, then `init --ai claude --force`: file content unchanged and output mentions it was skipped; (b) after a normal `init`, each installed sub-skill dir contains `.uipro-managed`; (c) `uninstall --ai claude` (confirm via stdin `y`) removes uipro-installed dirs but keeps the user's custom `design`; (d) a legacy install (copy bundled sub-skill dir without marker, identical SKILL.md) is removed by `uninstall`; the confirmation prompt text lists the exact directories to be removed.
- [ ] **Step 2: Run** the new spec; expected FAIL.
- [ ] **Step 3: Implement** `isManagedSkill`, write the marker in `copySubSkills`, skip-with-note (add to `InstallResult.skipped`) in `copySubSkills` when the target exists and is not managed (even with `--force`), and make `removeSkillDir` remove a sub-skill dir only when managed; list candidate paths in the confirm message. The orchestrator `ui-ux-pro-max` dir stays removed unconditionally (it is uipro's own name).
- [ ] **Step 4: Run gates** as in Task 2. Confirm `.uipro-managed` is not written into `cli/assets` (marker only in installed copies).
- [ ] **Step 5: Commit** `fix(cli): never delete or overwrite sub-skills uipro did not install`.

### Task 4: Repo hygiene and stricter asset sync (F6, F7, F11)

**Files:**
- Modify: `cli/scripts/sync-assets.mjs` (mirror `src/ui-ux-pro-max/data/styles.csv` → `gallery/data/styles.csv`; `--check` additionally fails on tracked mode-120000 entries via `git ls-files -s`, on `skill.json` `platforms` ≠ `AI_TYPES` (excluding `all`) parsed from `cli/src/types/index.ts`, and on any sub-skill file differing from its mirror; replace `startsWith` in `assertInsideRepo` with a `path.relative` check — m6)
- Replace symlink `gallery/data/styles.csv` with a real file (`git rm` the link, then sync creates the file)
- Modify: `skill.json` platforms list; `README.id.md`, `README.ko.md` examples using `openclaw`
- Delete tracked junk: `.claude/skills/ui-styling/scripts/.coverage`, `.claude/skills/ui-styling/scripts/tests/coverage-ui.json` and any copy under `cli/assets/skills/`; add `.coverage`, `coverage*.json` to `.gitignore`
- Modify: `cli/scripts/gen-legacy-hashes.mjs` (throw with a clear message when `git rev-parse --is-shallow-repository` prints `true`)
- Modify: `cli/src/utils/template.ts` (m6: remove duplicate `PlatformConfig` in favour of `types/index.ts` if types are compatible, remove unused `platformName`)
- Fix mirror gap: `ui-styling/canvas-fonts` — grep SKILL.md/references for `canvas-fonts`; if referenced, include the fonts in `cli/assets/skills/ui-styling/` via sync; if not referenced, state that in the commit and exclude explicitly with a comment.

**Interfaces:** Consumes `AI_TYPES` from `cli/src/types/index.ts`. Produces no new exports.

- [ ] **Step 1: Write failing checks first**: add a node test script `cli/scripts/check-assets.test.mjs` (plain `node:assert`, run with `node cli/scripts/check-assets.test.mjs`) that builds a temp copy of the relevant tree and asserts `sync-assets.mjs --check` exits non-zero when (a) a symlink is committed, (b) `skill.json` platforms lack `zcode`, (c) a mirrored sub-skill file is modified. If simulating git state in a temp repo is impractical, assert against exported pure helper functions instead (export `findSymlinkEntries(lsFilesOutput)`, `diffPlatforms(skillJson, aiTypes)`).
- [ ] **Step 2: Run** it; expected FAIL (helpers/behaviours missing).
- [ ] **Step 3: Implement** the sync-script changes, the real `gallery/data/styles.csv`, `skill.json`, README fixes, junk removal, `.gitignore`, canvas-fonts decision, and the `template.ts` cleanups.
- [ ] **Step 4: Run gates**: `node cli/scripts/check-assets.test.mjs` PASS, `cd cli && npm run sync:assets && npm run check:assets`, `git ls-files -s | grep ^120000` prints nothing, `cd gallery && npm ci && npm test` still passes, typecheck/build/playwright for `cli/`.
- [ ] **Step 5: Commit** `fix(repo): remove tracked symlink and junk, enforce platform and sub-skill sync`.

### Task 5: CI workflows (F8, F9)

**Files:**
- Modify: `.github/workflows/release.yml`, `.github/workflows/bump-versions.yml`, `.github/workflows/tests.yml`, `.github/workflows/smoke-stacks.yml`, `.github/workflows/check-asset-sync.yml`

**Interfaces:** none.

- [ ] **Step 1: Write the check first**: `scripts/validate-workflows.py` (stdlib only; parse YAML with a minimal line-based checker or `python3 -c "import yaml"` if available, otherwise regex) asserting: no `bun-version: latest`; no `npx --yes -p semantic-release` without `@<version>`; `permissions:` present in `tests.yml`, `smoke-stacks.yml`, `check-asset-sync.yml`; no `${{ steps.*.outputs.* }}` inside a `run:` block in `bump-versions.yml`; `tests.yml` contains `npm run typecheck` and `npm run build`; no `id-token: write` in `release.yml`; all `actions/checkout@` use one version. Run it: expected FAIL listing each violation.
- [ ] **Step 2: Fix workflows**: pin bun and semantic-release (+ its plugins) to explicit versions currently resolvable (`npm view semantic-release version` if the network allows, otherwise use the versions already in `cli/package-lock.json`/docs; record the choice); remove unused `id-token: write`; pass step outputs into `run:` via `env:`; add `permissions: contents: read`; add typecheck + build steps to the pytest/cli job; add a `cli-cross-platform` job with matrix `os: [windows-latest, macos-latest]` running `npm ci`, `npm run typecheck`, `npm run build`, `npm run check:assets`, and `node dist/index.js init --ai claude --dry-run` from `cli/`; unify checkout version; set `fetch-depth: 0` on the checkout in every job that runs Playwright (`cli/tests/e2e/ownership.spec.ts` reads historical SKILL.md versions from git history and fails on a shallow checkout) and make `scripts/validate-workflows.py` assert it; add `scripts/validate-workflows.py` to the `tests.yml` run steps. Try to resolve action SHAs (`git ls-remote https://github.com/actions/checkout`); if that works pin by SHA with a `# vX` comment, otherwise leave tags and note it.
- [ ] **Step 3: Run** `python3 scripts/validate-workflows.py` → PASS; run `python3 - <<<'import yaml,glob;[yaml.safe_load(open(f)) for f in glob.glob(".github/workflows/*.yml")]'` if PyYAML exists.
- [ ] **Step 4: Commit** `ci: pin release tooling, least-privilege permissions, typecheck/build and cross-platform CLI job`.

### Task 6: Docs, licensing, remaining minors (F10, F12, m4, m5)

**Files:**
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `.claude/skills/caveman/SKILL.md` (+ its `cli/assets/skills` mirror if present), `stack/README.md`, `stack/.mcp.json`, `CONTRIBUTING.md`, `.claude/skills/ui-ux-pro-max/SKILL.md`, `src/ui-ux-pro-max/templates/base/skill-content.md` (m5, only literal-comparison `&lt;`)
- Test: `scripts/validate-docs.py` (create)

**Interfaces:** none.

- [ ] **Step 1: Write failing validator** `scripts/validate-docs.py` (stdlib): asserts `THIRD_PARTY_NOTICES.md` exists and mentions every vendored skill dir named in the F10 list plus `caveman`; `stack/README.md` contains `79` styles, `74` font pairings and `119` UX; `stack/.mcp.json` has no `@latest`; no `&lt;` in the two SKILL files; `CONTRIBUTING.md` has no `.factory/`; caveman SKILL.md references only skill names that exist under `.claude/skills/`. Run: expected FAIL.
- [ ] **Step 2: Implement**: gather license facts from the repo only (`grep -ri "license" .claude/skills/*/SKILL.md`, `LICENSE*` files, `skills-lock.json`) into `THIRD_PARTY_NOTICES.md` (skill, upstream, license as recorded, file location of any license text; where the repo records nothing, say "not recorded in repository; confirm with upstream"); remove or reword caveman references to absent skills; fix `stack/` counts and pin `.mcp.json` package versions (`npm view <pkg> version` if network allows; otherwise pin to the lockstep versions found in the repo, or leave a comment-free note in the commit); fix CONTRIBUTING and `&lt;`.
- [ ] **Step 3: Run** `python3 scripts/validate-docs.py` PASS; `cd cli && npm run sync:assets && npm run check:assets`; full unittest discover; `cd cli && npm run verify:data` if runnable offline.
- [ ] **Step 4: Commit** `docs: third-party notices, correct stack counts, pin MCP packages, doc fixes`.
