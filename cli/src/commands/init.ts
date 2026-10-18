import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import type { AIType } from '../types/index.js';
import { AI_TYPES } from '../types/index.js';
import {
  generatePlatformFiles,
  generateAllPlatformFiles,
  planPlatformInstallActions,
  planAllPlatformInstallActions,
} from '../utils/template.js';
import type { InstallAllResult } from '../utils/template.js';
import { detectAIType, getAITypeDescription } from '../utils/detect.js';
import { logger } from '../utils/logger.js';

const NOTHING_INSTALLED = 'Nothing installed (already present; use --force to overwrite)';

interface InitOptions {
  ai?: AIType;
  force?: boolean;
  offline?: boolean; // Accepted for script compatibility; installs always use bundled assets
  global?: boolean; // Install to home directory (global mode)
  dryRun?: boolean; // Preview install actions without writing files
  token?: string; // Accepted for script compatibility; init makes no GitHub requests
}

/**
 * Install using template generation. `failures` is only ever non-empty for
 * `--ai all`; a single-platform failure throws.
 */
async function templateInstall(
  targetDir: string,
  aiType: AIType,
  spinner: ReturnType<typeof ora>,
  isGlobal = false,
  force = false
): Promise<InstallAllResult> {
  spinner.text = isGlobal
    ? 'Generating skill files globally...'
    : 'Generating skill files from templates...';

  if (aiType === 'all') {
    return generateAllPlatformFiles(targetDir, isGlobal, force);
  }

  return { ...(await generatePlatformFiles(targetDir, aiType, isGlobal, force)), failures: [] };
}

export async function initCommand(options: InitOptions): Promise<void> {
  logger.title('UI/UX Pro Max Installer');

  let aiType = options.ai;

  // Auto-detect or prompt for AI type
  if (!aiType) {
    if (!process.stdin.isTTY) {
      logger.error('No --ai given and stdin is not a terminal, so the assistant cannot be chosen interactively.');
      logger.error(`Re-run with --ai <type> (${AI_TYPES.join(', ')}).`);
      process.exit(1);
    }

    const { detected, suggested } = detectAIType();

    if (detected.length > 0) {
      logger.info(`Detected: ${detected.map(t => chalk.cyan(t)).join(', ')}`);
    }

    const response = await prompts({
      type: 'select',
      name: 'aiType',
      message: 'Select AI assistant to install for:',
      choices: AI_TYPES.map(type => ({
        title: getAITypeDescription(type),
        value: type,
      })),
      initial: suggested ? AI_TYPES.indexOf(suggested) : 0,
    });

    if (!response.aiType) {
      logger.warn('Installation cancelled');
      return;
    }

    aiType = response.aiType as AIType;
  }

  const isGlobal = !!options.global;
  const modeLabel = isGlobal ? ' (global)' : '';
  logger.info(`Installing for: ${chalk.cyan(getAITypeDescription(aiType))}${modeLabel}`);

  // Dry run: print what the install would do, write nothing, exit 0
  if (options.dryRun) {
    const cwd = process.cwd();
    console.log();
    logger.info('Planned install actions (nothing will be written):');

    if (aiType === 'all') {
      const { planned, failures } = await planAllPlatformInstallActions(cwd, isGlobal, options.force);
      planned.forEach((actions, type) => {
        console.log();
        console.log(chalk.bold(getAITypeDescription(type as AIType)));
        actions.forEach(action => console.log(`  ${chalk.cyan('·')} ${action}`));
      });
      if (failures.length > 0) {
        console.log();
        logger.error('Failed platforms:');
        failures.forEach(({ aiType: failedType, error }) => {
          console.log(`  ${chalk.red('x')} ${failedType}: ${error}`);
        });
        process.exit(1);
      }
    } else {
      try {
        const actions = await planPlatformInstallActions(cwd, aiType, isGlobal, options.force);
        actions.forEach(action => console.log(`  ${chalk.cyan('·')} ${action}`));
      } catch (error) {
        console.log();
        logger.error('Failed platforms:');
        console.log(`  ${chalk.red('x')} ${aiType}: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    }

    console.log();
    logger.success('Dry run complete — no files were written.');
    return;
  }

  const spinner = ora('Installing files...').start();
  const cwd = process.cwd();

  try {
    const result = await templateInstall(cwd, aiType, spinner, isGlobal, options.force);

    if (result.failures.length > 0) {
      spinner.fail('Installation failed for some platforms');
    } else if (result.folders.length === 0) {
      spinner.info(NOTHING_INSTALLED);
    } else {
      spinner.succeed('Generated from templates!');
    }

    console.log();
    if (result.folders.length > 0) {
      logger.info('Installed folders:');
      result.folders.forEach(folder => {
        console.log(`  ${chalk.green('+')} ${folder}`);
      });
    }

    const alreadyInstalled = result.skipped.filter(p => !result.notManaged.includes(p));
    if (alreadyInstalled.length > 0) {
      console.log();
      logger.info('Skipped (already exist, use --force to overwrite):');
      alreadyInstalled.forEach(path => {
        console.log(`  ${chalk.yellow('-')} ${path}`);
      });
    }

    if (result.notManaged.length > 0) {
      console.log();
      logger.info('Skipped (not installed by uipro or not a directory, left untouched even with --force):');
      result.notManaged.forEach(path => {
        console.log(`  ${chalk.yellow('-')} ${path}`);
      });
    }

    if (result.failures.length > 0) {
      console.log();
      logger.error('Failed platforms:');
      result.failures.forEach(({ aiType: failedType, error }) => {
        console.log(`  ${chalk.red('x')} ${failedType}: ${error}`);
      });
      process.exit(1);
    }

    console.log();
    if (result.folders.length === 0) {
      logger.warn(NOTHING_INSTALLED);
      return;
    }

    logger.success('UI/UX Pro Max installed successfully!');

    // Next steps
    console.log();
    console.log(chalk.bold('Next steps:'));
    console.log(chalk.dim('  1. Restart your AI coding assistant'));
    console.log(chalk.dim('  2. Try: "Build a landing page for a SaaS product"'));
    console.log();
  } catch (error) {
    spinner.fail('Installation failed');
    if (error instanceof Error) {
      logger.error(error.message);
    }
    process.exit(1);
  }
}
