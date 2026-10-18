import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER_MARKER, planPlatformInstallActions } from '../../src/utils/template.js';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_ENTRY = join(CLI_ROOT, 'dist', 'index.js');
const SUB_SKILLS = ['banner-design', 'brand', 'design', 'design-system', 'slides', 'ui-styling'];

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  const build = spawnSync('npm run build', { cwd: CLI_ROOT, encoding: 'utf-8', shell: true });
  expect(build.status, build.stdout + build.stderr).toBe(0);
});

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
