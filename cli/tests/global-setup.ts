import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Build dist/ exactly once, before any worker starts. Specs that run the built
// CLI used to build in their own beforeAll; with parallel workers two builds
// could overwrite dist/index.js while another spec was executing it.
export default function globalSetup(): void {
  const build = spawnSync('npm run build', { cwd: CLI_ROOT, encoding: 'utf-8', shell: true });
  if (build.status !== 0) {
    throw new Error(`npm run build failed (exit ${build.status})\n${build.stdout}\n${build.stderr}`);
  }
}
