#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(__dirname, '..', '..');
const sourceRoot = join(repoRoot, 'src', 'ui-ux-pro-max');
const assetRoot = join(repoRoot, 'cli', 'assets');
const dirsToSync = ['data', 'scripts', 'templates'];

// The 6 sibling sub-skills are bundled (as static copies) so `uipro init`
// installs all 7 skills, not just the template-rendered orchestrator. Source
// of truth is .claude/skills/ (the orchestrator ui-ux-pro-max is rendered from
// templates at install time, so it is not mirrored here).
const skillsSourceRoot = join(repoRoot, '.claude', 'skills');
const skillsAssetRoot = join(assetRoot, 'skills');
const subSkills = ['banner-design', 'brand', 'design', 'design-system', 'slides', 'ui-styling'];

// The repo's own .claude/skills/ui-ux-pro-max/{data,scripts} is a second,
// independent copy of src/ui-ux-pro-max/{data,scripts} -- it's what Claude
// Code actually loads when this repo is installed as a plugin. Nothing
// previously checked it against src/, so it silently drifted (missing stack
// CSVs, stale content in several data files). SKILL.md there is hand-authored
// (not template-rendered like the CLI's copy), so only data/ and scripts/
// are mirrored -- never templates/ or SKILL.md itself.
const orchestratorSkillTargetRoot = join(skillsSourceRoot, 'ui-ux-pro-max');
const orchestratorDirsToSync = ['data', 'scripts'];

// Directories deliberately NOT mirrored from .claude/skills/<sub-skill>/ into
// cli/assets/skills/<sub-skill>/. ui-styling/canvas-fonts is ~5.5MB of .ttf plus
// OFL licences; the only mention of it is one loose line in
// references/canvas-design-system.md ("Search ./canvas-fonts directory"), and a
// skill registers from its SKILL.md, not its fonts. Shipping it would grow the
// npm package ~10x for a hint. This list is the single, explicit source of the
// exclusion: --check is exact about everything else.
export const SUB_SKILL_EXCLUDED_DIRS = ['canvas-fonts'];

// ponytail: only text is bundled. Excludes (a) the directories above and
// binary assets, and (b) Python build cruft (__pycache__/*.pyc, .coverage)
// that would otherwise be picked up from a local run.
const isExcludedAssetFile = (rel) =>
  rel.split('/').some((seg) => SUB_SKILL_EXCLUDED_DIRS.includes(seg) || seg === '__pycache__') ||
  /\.(ttf|otf|woff2?|png|jpe?g|gif|ico|coverage|pyc)$/i.test(rel);

// Single files mirrored as real copies (no symlinks in this repo).
const fileMirrors = [
  {
    source: join(sourceRoot, 'data', 'styles.csv'),
    target: join(repoRoot, 'gallery', 'data', 'styles.csv'),
  },
];

// --- pure helpers (exported for cli/scripts/check-assets.test.mjs) ---------

// `git ls-files -s` lines look like "<mode> <sha> <stage>\t<path>".
export function findSymlinkEntries(lsFilesOutput) {
  return lsFilesOutput
    .split('\n')
    .filter((line) => line.startsWith('120000 '))
    .map((line) => line.slice(line.indexOf('\t') + 1));
}

export function parseAiTypes(typesSource) {
  const match = typesSource.match(/export const AI_TYPES[^=]*=\s*\[([^\]]*)\]/);
  if (!match) throw new Error('Could not find AI_TYPES in cli/src/types/index.ts');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((t) => t !== 'all');
}

export function diffPlatforms(skillJson, aiTypes) {
  const have = new Set(skillJson.platforms ?? []);
  const want = new Set(aiTypes);
  return {
    missing: aiTypes.filter((t) => !have.has(t)),
    extra: [...have].filter((t) => !want.has(t)),
  };
}

// One fix hint per kind of drift present: sync:assets repairs only the mirrored
// files, not tracked symlinks or the skill.json platforms list.
export function driftHints(drift) {
  const hints = [];
  if (drift.some((d) => d.startsWith('tracked symlink'))) {
    hints.push('Tracked symlinks: replace each with a real file (a mirrored copy); syncing will not fix this.');
  }
  if (drift.some((d) => d.startsWith('skill.json platforms'))) {
    hints.push('skill.json: edit its "platforms" list to match AI_TYPES in cli/src/types/index.ts (without "all"); syncing will not fix this.');
  }
  if (drift.some((d) => !d.startsWith('tracked symlink') && !d.startsWith('skill.json platforms'))) {
    hints.push('Mirrored files: run `npm run sync:assets` (from cli/).');
  }
  return hints;
}

// sourceMap/targetMap: relative path -> content hash. Reports drift in both
// directions (extra/missing/stale) except files the predicate excludes.
export function diffFileMaps(label, sourceMap, targetMap, isExcluded) {
  const drift = [];
  const sourceFiles = [...sourceMap.keys()].filter((f) => !isExcluded(f));
  const targetFiles = [...targetMap.keys()].filter((f) => !isExcluded(f));
  for (const file of [...new Set([...sourceFiles, ...targetFiles])].sort()) {
    if (!sourceMap.has(file)) {
      drift.push(`extra asset file: ${label}/${file}`);
    } else if (!targetMap.has(file)) {
      drift.push(`missing asset file: ${label}/${file}`);
    } else if (sourceMap.get(file) !== targetMap.get(file)) {
      drift.push(`stale asset file: ${label}/${file}`);
    }
  }
  return drift;
}

export function isMainModule(moduleUrl, argv1) {
  return Boolean(argv1) && moduleUrl === pathToFileURL(resolve(argv1)).href;
}

// ponytail: all synced assets are text (csv/json/md/py); normalize CRLF->LF so
// the byte hash and the on-disk copy don't drift with git autocrlf across platforms.
const toLF = (text) => text.replace(/\r\n/g, '\n');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function assertInsideRepo(path, root = repoRoot) {
  const resolvedPath = resolve(path);
  const rel = relative(resolve(root), resolvedPath);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`Refusing to modify path outside repository: ${resolvedPath}`);
  }
  return resolvedPath;
}

async function listFiles(root) {
  const files = [];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(relative(root, fullPath).replaceAll('\\', '/'));
      }
    }
  }

  await walk(root);
  return files.sort();
}

async function fileHash(path) {
  const content = toLF(await readFile(path, 'utf8'));
  return createHash('sha256').update(content).digest('hex');
}

// Compares one source dir against one target dir; pushes human-readable
// drift descriptions (prefixed with `label`) onto `drift`.
async function diffDir(sourceDir, targetDir, label, drift) {
  if (!(await exists(sourceDir))) {
    drift.push(`missing source directory: ${relative(repoRoot, sourceDir)}`);
    return;
  }
  if (!(await exists(targetDir))) {
    drift.push(`missing asset directory: ${relative(repoRoot, targetDir)}`);
    return;
  }

  const hashMap = async (dir) =>
    new Map(
      await Promise.all(
        (await listFiles(dir)).map(async (f) => [f, await fileHash(join(dir, f))]),
      ),
    );
  drift.push(
    ...diffFileMaps(label, await hashMap(sourceDir), await hashMap(targetDir), isExcludedAssetFile),
  );
}

// Mirrors sourceDir -> targetDir (deletes targetDir first, so removed
// source files don't linger as orphans in the target).
async function syncDir(sourceDir, targetDir) {
  if (!(await exists(sourceDir))) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  const resolvedTarget = assertInsideRepo(targetDir);
  if (await exists(resolvedTarget)) {
    await rm(resolvedTarget, { recursive: true, force: true });
  }

  for (const file of await listFiles(sourceDir)) {
    if (isExcludedAssetFile(file)) continue;
    const targetPath = assertInsideRepo(join(resolvedTarget, file));
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, toLF(await readFile(join(sourceDir, file), 'utf8')));
  }
}

async function checkAssets() {
  const drift = [];

  // No tracked symlinks (git-on-Windows checks them out as plain text files).
  const lsFiles = execFileSync('git', ['ls-files', '-s'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  for (const link of findSymlinkEntries(lsFiles)) {
    drift.push(`tracked symlink (mode 120000): ${link}`);
  }

  // skill.json platforms must equal the CLI's supported AI types.
  const aiTypes = parseAiTypes(await readFile(join(repoRoot, 'cli', 'src', 'types', 'index.ts'), 'utf8'));
  const skillJson = JSON.parse(await readFile(join(repoRoot, 'skill.json'), 'utf8'));
  const platforms = diffPlatforms(skillJson, aiTypes);
  for (const t of platforms.missing) drift.push(`skill.json platforms is missing CLI type: ${t}`);
  for (const t of platforms.extra) drift.push(`skill.json platforms lists unsupported type: ${t}`);

  for (const { source, target } of fileMirrors) {
    const rel = relative(repoRoot, target).replaceAll('\\', '/');
    if (!(await exists(target))) {
      drift.push(`missing mirrored file: ${rel}`);
    } else if ((await fileHash(source)) !== (await fileHash(target))) {
      drift.push(`stale mirrored file: ${rel}`);
    }
  }

  for (const dir of dirsToSync) {
    await diffDir(join(sourceRoot, dir), join(assetRoot, dir), dir, drift);
  }

  // Sub-skills (text content only; fonts/binaries intentionally excluded)
  for (const name of subSkills) {
    await diffDir(join(skillsSourceRoot, name), join(skillsAssetRoot, name), `skills/${name}`, drift);
  }

  // Orchestrator skill's own data/scripts copy under .claude/skills/ui-ux-pro-max/
  // (the copy Claude Code actually loads when this repo is a plugin).
  for (const dir of orchestratorDirsToSync) {
    await diffDir(
      join(sourceRoot, dir),
      join(orchestratorSkillTargetRoot, dir),
      `.claude/skills/ui-ux-pro-max/${dir}`,
      drift,
    );
  }

  if (drift.length > 0) {
    console.error('Assets are out of sync with src/ui-ux-pro-max:');
    for (const item of drift) {
      console.error(`  - ${item}`);
    }
    console.error('');
    for (const hint of driftHints(drift)) {
      console.error(hint);
    }
    process.exit(1);
  }

  console.log('Assets are in sync.');
}

async function syncAssets() {
  assertInsideRepo(assetRoot);
  await mkdir(assetRoot, { recursive: true });

  for (const dir of dirsToSync) {
    await syncDir(join(sourceRoot, dir), join(assetRoot, dir));
  }

  // Sub-skills: copy text content only (fonts/binaries excluded) so all 7
  // skills ship in the package without bloating it with ~5.8MB of fonts.
  const skillsTarget = assertInsideRepo(skillsAssetRoot);
  if (await exists(skillsTarget)) {
    await rm(skillsTarget, { recursive: true, force: true });
  }
  for (const name of subSkills) {
    await syncDir(join(skillsSourceRoot, name), join(skillsTarget, name));
  }

  // Orchestrator skill's own data/scripts copy under .claude/skills/ui-ux-pro-max/.
  for (const dir of orchestratorDirsToSync) {
    await syncDir(join(sourceRoot, dir), join(orchestratorSkillTargetRoot, dir));
  }

  for (const { source, target } of fileMirrors) {
    const resolvedTarget = assertInsideRepo(target);
    await mkdir(dirname(resolvedTarget), { recursive: true });
    await rm(resolvedTarget, { force: true }); // replace a symlink, don't write through it
    await writeFile(resolvedTarget, toLF(await readFile(source, 'utf8')));
  }

  console.log('Synced CLI assets + .claude/skills/ui-ux-pro-max data/scripts from src/ui-ux-pro-max, and 6 sub-skills (normalized to LF).');
}

if (isMainModule(import.meta.url, process.argv[1])) {
  if (process.argv.includes('--check')) {
    await checkAssets();
  } else {
    await syncAssets();
  }
}
