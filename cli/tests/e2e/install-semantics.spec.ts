import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectAIType } from '../../src/utils/detect.js';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_ENTRY = join(CLI_ROOT, 'dist', 'index.js');

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  const build = spawnSync('npm', ['run', 'build'], { cwd: CLI_ROOT, encoding: 'utf-8' });
  expect(build.status, build.stdout + build.stderr).toBe(0);
});

function runCli(cwd: string, args: string[]) {
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd,
    encoding: 'utf-8',
    input: '',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
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
