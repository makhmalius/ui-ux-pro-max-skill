import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectAIType } from '../../src/utils/detect.js';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_ENTRY = join(CLI_ROOT, 'dist', 'index.js');

test.describe.configure({ mode: 'serial' });

function runCli(cwd: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd,
    encoding: 'utf-8',
    input: '',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', ...env },
  });
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

test('init --ai all reports a failing platform by name, exits 1, installs the rest', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-all-fail-'));
  await writeFile(join(scratch, '.cursor'), 'not a directory');

  const result = runCli(scratch, ['init', '--ai', 'all']);

  expect(result.status).toBe(1);
  expect(result.output).toContain('cursor');
  expect(result.output).toContain('ENOTDIR');
  expect(existsSync(join(scratch, '.windsurf', 'skills', 'ui-ux-pro-max', 'SKILL.md'))).toBe(true);
  expect(existsSync(join(scratch, '.claude', 'skills', 'ui-ux-pro-max', 'SKILL.md'))).toBe(true);
});

test('init --ai claude twice says nothing was installed, then repairs missing data without touching SKILL.md', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-repeat-'));
  const skillDir = join(scratch, '.claude', 'skills', 'ui-ux-pro-max');

  const first = runCli(scratch, ['init', '--ai', 'claude']);
  expect(first.status).toBe(0);
  expect(first.output).not.toContain('Nothing installed');

  const second = runCli(scratch, ['init', '--ai', 'claude']);
  expect(second.status).toBe(0);
  expect(second.output).toContain('Nothing installed');
  expect(second.output.split('Nothing installed').length - 1).toBe(1);
  expect(second.output).not.toContain('installed successfully');

  await writeFile(join(skillDir, 'SKILL.md'), 'my customised skill');
  await rm(join(skillDir, 'data'), { recursive: true, force: true });
  expect(existsSync(join(skillDir, 'data'))).toBe(false);

  const third = runCli(scratch, ['init', '--ai', 'claude']);
  expect(third.status).toBe(0);
  expect(existsSync(join(skillDir, 'data', 'styles.csv'))).toBe(true);
  expect(await readFile(join(skillDir, 'SKILL.md'), 'utf-8')).toBe('my customised skill');
  expect(third.output).not.toContain('Nothing installed');
});

test('detectAIType suggests the first detected type, never all', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-detect-'));
  await mkdir(join(scratch, '.claude'));
  await mkdir(join(scratch, '.cursor'));
  await mkdir(join(scratch, '.github'));

  const result = detectAIType(scratch);

  expect(result.detected).toEqual(['claude', 'cursor']);
  expect(result.suggested).toBe('claude');
});

test('detectAIType counts .github as Copilot only when .github/prompts exists', async () => {
  const bare = await mkdtemp(join(tmpdir(), 'uipro-detect-github-'));
  await mkdir(join(bare, '.github'));
  expect(detectAIType(bare)).toEqual({ detected: [], suggested: null });

  const withPrompts = await mkdtemp(join(tmpdir(), 'uipro-detect-prompts-'));
  await mkdir(join(withPrompts, '.github', 'prompts'), { recursive: true });
  const result = detectAIType(withPrompts);
  expect(result.detected).toEqual(['copilot']);
  expect(result.suggested).toBe('copilot');
});

test('init without --ai and without a TTY exits 1 and mentions --ai', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-no-tty-'));

  const result = runCli(scratch, ['init']);

  expect(result.status).toBe(1);
  expect(result.output).toContain('--ai');
});

test('init still accepts --offline and --token', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-compat-flags-'));

  const result = runCli(scratch, ['init', '--ai', 'claude', '--offline', '--token', 'x']);

  expect(result.status).toBe(0);
});

test('dry-run on a partial tree skips what exists per artifact and would write what is missing', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-dry-partial-'));
  const skillDir = join(scratch, '.claude', 'skills', 'ui-ux-pro-max');
  expect(runCli(scratch, ['init', '--ai', 'claude']).status).toBe(0);
  await rm(join(skillDir, 'data'), { recursive: true, force: true });
  await rm(join(scratch, '.claude', 'skills', 'design'), { recursive: true, force: true });

  const result = runCli(scratch, ['init', '--ai', 'claude', '--dry-run']);

  expect(result.status).toBe(0);
  const lines = result.output.split('\n');
  const has = (verb: string, path: string) =>
    lines.some(l => l.includes(verb) && l.includes(path));
  expect(has('Would skip', join(skillDir, 'SKILL.md'))).toBe(true);
  expect(has('Would skip', join(skillDir, 'scripts'))).toBe(true);
  expect(has('Would skip', join(scratch, '.claude', 'skills', 'brand'))).toBe(true);
  expect(has('Would write', join(skillDir, 'data'))).toBe(true);
  expect(has('Would write', join(scratch, '.claude', 'skills', 'design'))).toBe(true);
  expect(has('Would write', join(skillDir, 'SKILL.md'))).toBe(false);
  // dry-run must not create anything
  expect(existsSync(join(skillDir, 'data'))).toBe(false);
  expect((await readdir(join(scratch, '.claude', 'skills'))).includes('design')).toBe(false);
});

test('dry-run on a fully installed tree reports nothing to write', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-dry-full-'));
  expect(runCli(scratch, ['init', '--ai', 'claude']).status).toBe(0);

  const result = runCli(scratch, ['init', '--ai', 'claude', '--dry-run']);

  expect(result.status).toBe(0);
  expect(result.output).not.toContain('Would write');
  expect(result.output).toContain('Would skip');
  expect(result.output).toContain(`Would skip (exists, use --force): ${join(scratch, '.claude', 'skills', 'ui-ux-pro-max', 'scripts')}`);
  expect(result.output).not.toContain('Would copy');
});

test('dry-run agrees with the real install when a platform dir is a plain file', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-dry-enotdir-'));
  await writeFile(join(scratch, '.cursor'), 'not a directory');

  const dry = runCli(scratch, ['init', '--ai', 'all', '--dry-run']);
  expect(dry.status).toBe(1);
  expect(dry.output).toContain('Failed platforms');
  expect(dry.output).toContain('cursor');
  expect(dry.output).toContain('ENOTDIR');
  // The healthy platforms are still previewed.
  expect(dry.output).toContain(join(scratch, '.claude', 'skills', 'ui-ux-pro-max', 'SKILL.md'));
  expect(dry.output).not.toContain(`Would write: ${join(scratch, '.cursor')}`);

  const real = runCli(scratch, ['init', '--ai', 'all']);
  expect(real.status).toBe(1);
  expect(real.output).toContain('ENOTDIR');
});

test('single-platform dry-run fails like the real install when its dir is a plain file', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-dry-enotdir-one-'));
  await writeFile(join(scratch, '.cursor'), 'not a directory');

  const dry = runCli(scratch, ['init', '--ai', 'cursor', '--dry-run']);
  expect(dry.status).toBe(1);
  expect(dry.output).toContain('cursor');
  expect(dry.output).toContain('ENOTDIR');
  expect(dry.output).not.toContain('Would write');

  const real = runCli(scratch, ['init', '--ai', 'cursor']);
  expect(real.status).toBe(1);
  expect(real.output).toContain('ENOTDIR');
});

test('--global dry-run treats a plain-file platform dir in the home directory the same way', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-dry-enotdir-g-'));
  const home = await mkdtemp(join(tmpdir(), 'uipro-home-'));
  await writeFile(join(home, '.cursor'), 'not a directory');
  const env = { HOME: home, USERPROFILE: home };

  const dry = runCli(scratch, ['init', '--ai', 'all', '--global', '--dry-run'], env);
  expect(dry.status).toBe(1);
  expect(dry.output).toContain('Failed platforms');
  expect(dry.output).toContain('cursor');

  const real = runCli(scratch, ['init', '--ai', 'cursor', '--global'], env);
  expect(real.status).toBe(1);
  expect(real.output).toContain('ENOTDIR');
});

test('init --help describes --token as accepted but ignored', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'uipro-help-'));
  const help = runCli(scratch, ['init', '--help']);
  expect(help.status).toBe(0);
  const tokenLine = help.output.split('\n').find(l => l.includes('--token')) ?? '';
  expect(tokenLine).not.toContain('rate limit');
  expect(help.output).toMatch(/--token[\s\S]*ignored by init/);
});
