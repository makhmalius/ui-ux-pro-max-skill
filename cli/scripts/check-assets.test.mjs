// Plain node:assert tests for the pure helpers behind `sync-assets.mjs --check`
// and the git-history guard of gen-legacy-hashes.mjs.
// Run: node cli/scripts/check-assets.test.mjs
import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SUB_SKILL_EXCLUDED_DIRS,
  assertInsideRepo,
  diffFileMaps,
  diffPlatforms,
  findSymlinkEntries,
  isMainModule,
  parseAiTypes,
  repoRoot,
} from './sync-assets.mjs';
import { assertFullHistory } from './git-history.mjs';

let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}\n     ${err.message}`);
  }
};

test('findSymlinkEntries reports only mode 120000 entries', () => {
  const out = [
    '100644 aaa 0\tREADME.md',
    '120000 bbb 0\tgallery/data/styles.csv',
    '100755 ccc 0\tscripts/run.sh',
    '120000 ddd 0\tpath with space/link',
  ].join('\n');
  assert.deepEqual(findSymlinkEntries(out), ['gallery/data/styles.csv', 'path with space/link']);
  assert.deepEqual(findSymlinkEntries(''), []);
  assert.deepEqual(findSymlinkEntries('100644 aaa 0\tfile\n'), []);
});

test('parseAiTypes drops "all" and keeps the concrete types', () => {
  const src = `export const AI_TYPES: AIType[] = ['claude', 'zcode', 'all'];`;
  assert.deepEqual(parseAiTypes(src), ['claude', 'zcode']);
  assert.throws(() => parseAiTypes('nothing here'), /AI_TYPES/);
});

test('diffPlatforms flags missing and extra platforms', () => {
  const d = diffPlatforms({ platforms: ['claude', 'openclaw'] }, ['claude', 'zcode']);
  assert.deepEqual(d.missing, ['zcode']);
  assert.deepEqual(d.extra, ['openclaw']);
  const ok = diffPlatforms({ platforms: ['zcode', 'claude'] }, ['claude', 'zcode']);
  assert.deepEqual(ok, { missing: [], extra: [] });
});

test('assertInsideRepo accepts inside paths and rejects sibling/escape paths', () => {
  assert.equal(assertInsideRepo(resolve(repoRoot, 'cli', 'assets')), resolve(repoRoot, 'cli', 'assets'));
  assert.throws(() => assertInsideRepo(repoRoot + '-evil'), /outside repository/);
  assert.throws(() => assertInsideRepo(resolve(repoRoot, '..', 'elsewhere')), /outside repository/);
  assert.throws(() => assertInsideRepo(`${repoRoot}${sep}..${sep}x`), /outside repository/);
  assert.equal(assertInsideRepo('/repo/a', '/repo'), resolve('/repo/a'));
  assert.throws(() => assertInsideRepo('/repo-evil/a', '/repo'), /outside repository/);
});

test('diffFileMaps reports extra, missing and stale files, honouring exclusions', () => {
  const src = new Map([['a.md', 'h1'], ['b.md', 'h2'], ['canvas-fonts/x.txt', 'h3']]);
  const dst = new Map([['a.md', 'h1'], ['b.md', 'CHANGED'], ['c.md', 'h4']]);
  const drift = diffFileMaps('skills/s', src, dst, (f) => f.startsWith('canvas-fonts/'));
  assert.deepEqual(drift.sort(), ['extra asset file: skills/s/c.md', 'stale asset file: skills/s/b.md']);
  const missing = diffFileMaps('skills/s', new Map([['n.md', 'h']]), new Map(), () => false);
  assert.deepEqual(missing, ['missing asset file: skills/s/n.md']);
});

test('canvas-fonts exclusion is an explicit named constant', () => {
  assert.ok(SUB_SKILL_EXCLUDED_DIRS.includes('canvas-fonts'));
});

test('isMainModule compares file URLs (Windows-safe)', () => {
  const p = resolve('cli', 'scripts', 'sync-assets.mjs');
  assert.equal(isMainModule(pathToFileURL(p).href, p), true);
  assert.equal(isMainModule(pathToFileURL(p).href, undefined), false);
  assert.equal(isMainModule(pathToFileURL(p).href, resolve('other.mjs')), false);
});

test('assertFullHistory throws on a shallow clone only', () => {
  assert.throws(() => assertFullHistory('true\n'), /shallow/i);
  assert.doesNotThrow(() => assertFullHistory('false\n'));
  assert.doesNotThrow(() => assertFullHistory(''));
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall passed');
