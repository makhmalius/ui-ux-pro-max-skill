import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Cloud sandboxes ship a pre-installed Chromium whose build number can differ
// from the one this Playwright version downloads. Use it when present (or when
// PLAYWRIGHT_CHROMIUM_EXECUTABLE is set); otherwise Playwright's own browser is used.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
const chromiumExecutable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
      },
    },
  ],
});
