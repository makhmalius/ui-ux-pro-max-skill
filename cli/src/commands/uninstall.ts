import { rm, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import type { AIType, ConcreteAIType } from '../types/index.js';
import { AI_TYPES, AI_FOLDERS } from '../types/index.js';
import { detectAIType, getAITypeDescription } from '../utils/detect.js';
import { bundledSubSkillDir, isManagedSkill, listBundledSubSkills, loadPlatformConfig } from '../utils/template.js';
import { logger } from '../utils/logger.js';

interface UninstallOptions {
  ai?: AIType;
  global?: boolean;
}

interface RemovalPlan {
  /** Standalone skill files and directories that will be removed, as absolute paths. */
  targets: { abs: string; label: string; guard?: string }[];
  /** Existing sub-skill directories uipro did not install; never removed. */
  kept: string[];
}

/**
 * Work out what removing the skill for an AI type would delete. The
 * orchestrator dir (uipro's own name) is removed unconditionally; a
 * sub-skill dir only if uipro installed it (marker or identical legacy copy).
 */
async function planRemoval(baseDir: string, aiType: ConcreteAIType): Promise<RemovalPlan> {
  const plan: RemovalPlan = { targets: [], kept: [] };

  // The orchestrator plus the bundled sibling sub-skills installed by init.
  const skillNames = ['ui-ux-pro-max', ...(await listBundledSubSkills())];

  // Parent directories to clean. Derive the real install location from the
  // platform config's skillPath (same source the installer uses), so
  // non-`skills/` platforms are handled — copilot installs under
  // `.github/prompts/`, kiro under `.kiro/steering/`. Also clean the legacy
  // `<folder>/skills/` layout (incl. `.shared/`) so older installs are removed.
  const parents = new Set<string>();
  // Standalone skill files to remove (platforms with a dataPath keep the
  // rendered skill file apart from the data directory — e.g. copilot's
  // `.github/prompts/ui-ux-pro-max.prompt.md`).
  const skillFiles = new Set<string>();
  try {
    const { folderStructure } = await loadPlatformConfig(aiType);
    if (folderStructure.dataPath) {
      skillFiles.add(join(folderStructure.root, folderStructure.skillPath, folderStructure.filename));
      parents.add(join(folderStructure.root, dirname(folderStructure.dataPath)));
    } else {
      parents.add(join(folderStructure.root, dirname(folderStructure.skillPath)));
    }
  } catch {
    // No platform config — fall back to the legacy folders below.
  }
  for (const folder of AI_FOLDERS[aiType]) {
    parents.add(join(folder, 'skills'));
  }

  for (const skillFile of skillFiles) {
    const filePath = join(baseDir, skillFile);
    if (await pathExists(filePath)) {
      plan.targets.push({ abs: filePath, label: skillFile.replaceAll('\\', '/') });
    }
  }

  for (const parent of parents) {
    for (const name of skillNames) {
      const skillDir = join(baseDir, parent, name);
      if (!(await pathExists(skillDir))) continue;
      const guard = name === 'ui-ux-pro-max' ? undefined : bundledSubSkillDir(name);
      if (!guard || (await isManagedSkill(skillDir, guard))) {
        plan.targets.push({ abs: skillDir, label: `${parent.replaceAll('\\', '/')}/${name}`, guard });
      } else {
        plan.kept.push(skillDir);
      }
    }
  }

  return plan;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err: unknown) {
    // Skip non-existent paths; re-throw permission or other errors
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return false;
  }
}

async function executeRemoval(plan: RemovalPlan): Promise<string[]> {
  const removed: string[] = [];
  for (const { abs, label, guard } of plan.targets) {
    // Re-check ownership right before deleting (the user may have changed it since the prompt).
    if (guard && !(await isManagedSkill(abs, guard))) continue;
    await rm(abs, { recursive: true, force: true });
    removed.push(label);
  }
  return removed;
}

export async function uninstallCommand(options: UninstallOptions): Promise<void> {
  logger.title('UI/UX Pro Max Uninstaller');

  const isGlobal = !!options.global;
  const baseDir = isGlobal ? homedir() : process.cwd();
  const locationLabel = isGlobal ? '~/ (global)' : process.cwd();

  let aiType = options.ai;
  const { detected: initialDetected } = detectAIType(baseDir);

  // Auto-detect or prompt for AI type
  if (!aiType) {
    const detected = initialDetected;

    if (detected.length === 0) {
      logger.warn('No installed AI skill directories detected.');
      return;
    }

    logger.info(`Detected installations: ${detected.map(t => chalk.cyan(t)).join(', ')}`);

    const choices = [
      ...detected.map(type => ({
        title: getAITypeDescription(type),
        value: type,
      })),
      { title: 'All detected', value: 'all' as AIType },
    ];

    const response = await prompts({
      type: 'select',
      name: 'aiType',
      message: 'Select which AI skill to uninstall:',
      choices,
    });

    if (!response.aiType) {
      logger.warn('Uninstall cancelled');
      return;
    }

    aiType = response.aiType as AIType;
  }

  const typesToRemove: ConcreteAIType[] =
    aiType === 'all' ? initialDetected : [aiType as ConcreteAIType];
  const plan: RemovalPlan = { targets: [], kept: [] };
  for (const type of typesToRemove) {
    const p = await planRemoval(baseDir, type);
    for (const t of p.targets) {
      if (!plan.targets.some(x => x.abs === t.abs)) plan.targets.push(t);
    }
    for (const k of p.kept) {
      if (!plan.kept.includes(k)) plan.kept.push(k);
    }
  }

  if (plan.targets.length === 0) {
    logger.info('Nothing to remove.');
    if (plan.kept.length > 0) {
      logger.info(`Kept (not installed by uipro):\n${plan.kept.map(p => `  ${p}`).join('\n')}`);
    }
    return;
  }

  const keptNote = plan.kept.length > 0
    ? `\nKept (not installed by uipro):\n${plan.kept.map(p => `  ${p}`).join('\n')}\n`
    : '';

  // Confirm before removing, listing the exact paths
  const { confirmed } = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message: `Remove UI/UX Pro Max skill for ${chalk.cyan(getAITypeDescription(aiType))} from ${locationLabel}?\nWill remove:\n${plan.targets.map(t => `  ${t.abs}`).join('\n')}\n${keptNote}`,
    initial: false,
  });

  if (!confirmed) {
    logger.warn('Uninstall cancelled');
    return;
  }

  const spinner = ora('Removing skill files...').start();

  try {
    const allRemoved = await executeRemoval(plan);

    if (allRemoved.length === 0) {
      spinner.warn('No skill files found to remove');
      return;
    }

    spinner.succeed('Skill files removed!');

    console.log();
    logger.info('Removed:');
    allRemoved.forEach(folder => {
      console.log(`  ${chalk.red('-')} ${folder}`);
    });

    console.log();
    logger.success('UI/UX Pro Max uninstalled successfully!');
    console.log();
  } catch (error) {
    spinner.fail('Uninstall failed');
    if (error instanceof Error) {
      logger.error(error.message);
    }
    process.exit(1);
  }
}
