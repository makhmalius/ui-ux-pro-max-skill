import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_MARKER, isManagedSkill, planPlatformInstallActions } from '../../src/utils/template.js';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_ENTRY = join(CLI_ROOT, 'dist', 'index.js');
const SUB_SKILLS = ['banner-design', 'brand', 'design', 'design-system', 'slides', 'ui-styling'];

test.describe.configure({ mode: 'serial' });

function runCli(cwd: string, args: string[], input = '') {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd,
    encoding: 'utf-8',
    input,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

async function writeUserDesign(scratch: string): Promise<string> {
  const dir = join(scratch, '.claude', 'skills', 'design');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), 'my own design skill');
  return dir;
}

test('init --force never overwrites a user-owned sub-skill and says it was skipped', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-own-force-'));
  const userDesign = await writeUserDesign(scratch);

  const result = runCli(scratch, ['init', '--ai', 'claude', '--force']);

  expect(result.status).toBe(0);
  expect(await readFile(join(userDesign, 'SKILL.md'), 'utf-8')).toBe('my own design skill');
  expect(existsSync(join(userDesign, OWNER_MARKER))).toBe(false);
  expect(result.output).toContain('not installed by uipro');
  expect(result.output).toContain(userDesign);
});

test('dry-run reports an unmanaged same-named sub-skill as skipped, even with --force', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-own-dry-'));
  const userDesign = await writeUserDesign(scratch);

  for (const force of [false, true]) {
    const joined = (await planPlatformInstallActions(scratch, 'claude', false, force)).join('\n');
    expect(joined).toContain(`Would skip (not installed by uipro): ${userDesign}`);
    expect(joined.split('\n')).not.toContain(`Would write: ${userDesign}`);
  }
});

test('a normal init writes the ownership marker into every installed sub-skill', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-own-marker-'));

  expect(runCli(scratch, ['init', '--ai', 'claude']).status).toBe(0);

  for (const name of SUB_SKILLS) {
    expect(existsSync(join(scratch, '.claude', 'skills', name, OWNER_MARKER)), name).toBe(true);
  }
});

test('bundled assets and the repo skill never contain the ownership marker', async () => {
  for (const root of [join(CLI_ROOT, 'assets', 'skills'), join(CLI_ROOT, '..', '.claude', 'skills')]) {
    const entries = await readdir(root, { recursive: true });
    expect(entries.filter(e => e.endsWith(OWNER_MARKER)), root).toEqual([]);
  }
});

test('uninstall removes uipro-installed sub-skills, keeps a user-owned one, and lists exact dirs in the prompt', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-own-uninstall-'));
  const skills = join(scratch, '.claude', 'skills');
  const userDesign = await writeUserDesign(scratch);
  expect(runCli(scratch, ['init', '--ai', 'claude']).status).toBe(0);

  const result = runCli(scratch, ['uninstall', '--ai', 'claude'], 'y\n');

  expect(result.status).toBe(0);
  expect(await readFile(join(userDesign, 'SKILL.md'), 'utf-8')).toBe('my own design skill');
  expect(existsSync(join(skills, 'ui-ux-pro-max'))).toBe(false);
  for (const name of SUB_SKILLS.filter(n => n !== 'design')) {
    expect(existsSync(join(skills, name)), name).toBe(false);
    expect(result.output).toContain(join(skills, name));
  }
  // The user's directory is listed only under "Kept", never under "Will remove".
  const willRemove = result.output.slice(result.output.indexOf('Will remove:'), result.output.indexOf('Kept'));
  expect(willRemove.split('\n')).not.toContain(`  ${join(skills, 'design')}`);
  expect(result.output).toContain('Kept');
});

test('uninstall removes a legacy sub-skill (no marker, SKILL.md identical to the bundle)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-own-legacy-'));
  const legacy = join(scratch, '.claude', 'skills', 'brand');
  await mkdir(join(scratch, '.claude', 'skills'), { recursive: true });
  await cp(join(CLI_ROOT, 'assets', 'skills', 'brand'), legacy, { recursive: true });
  expect(existsSync(join(legacy, OWNER_MARKER))).toBe(false);

  const result = runCli(scratch, ['uninstall', '--ai', 'claude'], 'y\n');

  expect(result.status).toBe(0);
  expect(existsSync(legacy)).toBe(false);
  expect(result.output).toContain(legacy);
});

/** A previously shipped SKILL.md of `name` that differs from the current bundle, read from git history. */
function previousSkillMd(name: string): string {
  const path = `cli/assets/skills/${name}/SKILL.md`;
  const repo = join(CLI_ROOT, '..');
  const current = spawnSync('git', ['show', `HEAD:${path}`], { cwd: repo, encoding: 'utf-8' }).stdout;
  const shas = spawnSync('git', ['log', '--format=%H', '--', path], { cwd: repo, encoding: 'utf-8' })
    .stdout.split('\n').filter(Boolean);
  for (const sha of shas) {
    const old = spawnSync('git', ['show', `${sha}:${path}`], { cwd: repo, encoding: 'utf-8' });
    if (old.status === 0 && old.stdout !== current) return old.stdout;
  }
  throw new Error(`no earlier version of ${path} in git history`);
}

async function installLegacy(scratch: string, name: string, skillMd: string): Promise<string> {
  const dir = join(scratch, '.claude', 'skills', name);
  await mkdir(join(scratch, '.claude', 'skills'), { recursive: true });
  await cp(join(CLI_ROOT, 'assets', 'skills', name), dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), skillMd);
  return dir;
}

test('a legacy install of an OLDER released SKILL.md is still managed', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-own-old-'));
  const dir = await installLegacy(scratch, 'design', previousSkillMd('design'));
  expect(await isManagedSkill(dir, join(CLI_ROOT, 'assets', 'skills', 'design'))).toBe(true);
  // CRLF checkout of an old release is the same release.
  await writeFile(join(dir, 'SKILL.md'), previousSkillMd('design').replace(/\n/g, '\r\n'));
  expect(await isManagedSkill(dir, join(CLI_ROOT, 'assets', 'skills', 'design'))).toBe(true);
});

test('uninstall removes, and init --force refreshes, a legacy install of an older SKILL.md', async () => {
  const removeScratch = await mkdtemp(join(tmpdir(), 'uipro-own-old-rm-'));
  const toRemove = await installLegacy(removeScratch, 'brand', previousSkillMd('brand'));
  const un = runCli(removeScratch, ['uninstall', '--ai', 'claude'], 'y\n');
  expect(un.status).toBe(0);
  expect(existsSync(toRemove)).toBe(false);

  const refreshScratch = await mkdtemp(join(tmpdir(), 'uipro-own-old-refresh-'));
  const toRefresh = await installLegacy(refreshScratch, 'brand', previousSkillMd('brand'));
  const init = runCli(refreshScratch, ['init', '--ai', 'claude', '--force']);
  expect(init.status).toBe(0);
  expect(existsSync(join(toRefresh, OWNER_MARKER))).toBe(true);
  expect(await readFile(join(toRefresh, 'SKILL.md'), 'utf-8')).toBe(
    await readFile(join(CLI_ROOT, 'assets', 'skills', 'brand', 'SKILL.md'), 'utf-8')
  );
});

test('a user-edited SKILL.md without the marker is not managed', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-own-edited-'));
  const dir = await installLegacy(scratch, 'brand', 'something the user wrote');
  expect(await isManagedSkill(dir, join(CLI_ROOT, 'assets', 'skills', 'brand'))).toBe(false);
});

test('a plain file at a sub-skill path is skipped as "not a directory", never replaced or deleted', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-own-file-'));
  const file = join(scratch, '.claude', 'skills', 'slides');
  await mkdir(join(scratch, '.claude', 'skills'), { recursive: true });
  await writeFile(file, 'i am a file');

  const plan = (await planPlatformInstallActions(scratch, 'claude', false, true)).join('\n');
  expect(plan).toContain(`Would skip (not installed by uipro, not a directory): ${file}`);

  const init = runCli(scratch, ['init', '--ai', 'claude', '--force']);
  expect(init.status).toBe(0);
  expect(init.output).toContain('not a directory');
  expect(await readFile(file, 'utf-8')).toBe('i am a file');

  const un = runCli(scratch, ['uninstall', '--ai', 'claude'], 'y\n');
  expect(un.status).toBe(0);
  expect(await readFile(file, 'utf-8')).toBe('i am a file');
});

test('uninstall with nothing to remove does not prompt and exits 0', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-own-empty-'));
  await mkdir(join(scratch, '.claude'), { recursive: true });
  const result = runCli(scratch, ['uninstall', '--ai', 'claude'], '');
  expect(result.status).toBe(0);
  expect(result.output).toContain('Nothing to remove');
  expect(result.output).not.toContain('Will remove');
});

test('uninstall --ai all lists each path once', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-own-dedupe-'));
  expect(runCli(scratch, ['init', '--ai', 'claude']).status).toBe(0);
  expect(runCli(scratch, ['init', '--ai', 'universal']).status).toBe(0);
  const result = runCli(scratch, ['uninstall', '--ai', 'all'], 'y\n');
  expect(result.status).toBe(0);
  const prompt = result.output.slice(result.output.indexOf('Will remove:'), result.output.indexOf('(y/N)'));
  // Path lines are indented absolute paths on every platform (POSIX '/...', Windows 'C:\\...').
  const lines = prompt.split('\n').filter(l => l.startsWith('  ') && isAbsolute(l.trim()));
  expect(lines.length).toBeGreaterThan(0);
  expect(new Set(lines).size).toBe(lines.length);
});
