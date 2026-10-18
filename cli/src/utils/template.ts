import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile, cp, access, readdir, lstat, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_CANDIDATES = [
  // Bun bundle: dist/index.js
  join(__dirname, '..', 'assets'),
  // TypeScript fallback: dist/utils/template.js
  join(__dirname, '..', '..', 'assets'),
];
const ASSETS_DIR = ASSETS_CANDIDATES.find(path => existsSync(path)) ?? ASSETS_CANDIDATES[0];

export interface PlatformConfig {
  platform: string;
  displayName: string;
  installType: 'full' | 'reference';
  folderStructure: {
    root: string;
    skillPath: string;
    filename: string;
    dataPath?: string;
  };
  scriptPath: string;
  frontmatter: Record<string, string> | null;
  sections: {
    quickReference: boolean;
  };
  title: string;
  description: string;
  skillOrWorkflow: string;
}

// Map AIType to platform config file name
const AI_TO_PLATFORM: Record<string, string> = {
  claude: 'claude',
  cursor: 'cursor',
  windsurf: 'windsurf',
  antigravity: 'agent',
  copilot: 'copilot',
  kiro: 'kiro',
  opencode: 'opencode',
  roocode: 'roocode',
  codex: 'codex',
  qoder: 'qoder',
  gemini: 'gemini',
  trae: 'trae',
  continue: 'continue',
  codebuddy: 'codebuddy',
  droid: 'droid',
  kilocode: 'kilocode',
  warp: 'warp',
  augment: 'augment',
  codewhale: 'codewhale',
  zcode: 'zcode',
  universal: 'universal',
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load platform configuration from JSON file
 */
export async function loadPlatformConfig(aiType: string): Promise<PlatformConfig> {
  const platformName = AI_TO_PLATFORM[aiType];
  if (!platformName) {
    throw new Error(`Unknown AI type: ${aiType}`);
  }

  const configPath = join(ASSETS_DIR, 'templates', 'platforms', `${platformName}.json`);
  const content = await readFile(configPath, 'utf-8');
  return JSON.parse(content) as PlatformConfig;
}

/**
 * Load all available platform configs
 */
export async function loadAllPlatformConfigs(): Promise<Map<string, PlatformConfig>> {
  const configs = new Map<string, PlatformConfig>();

  for (const [aiType, platformName] of Object.entries(AI_TO_PLATFORM)) {
    try {
      const config = await loadPlatformConfig(aiType);
      configs.set(aiType, config);
    } catch {
      // Skip if config doesn't exist
    }
  }

  return configs;
}

/**
 * Load a template file
 */
async function loadTemplate(templateName: string): Promise<string> {
  const templatePath = join(ASSETS_DIR, 'templates', templateName);
  return readFile(templatePath, 'utf-8');
}

/**
 * Render frontmatter section
 */
function renderFrontmatter(frontmatter: Record<string, string> | null): string {
  if (!frontmatter) return '';

  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    // Quote values that contain special characters
    if (value.includes(':') || value.includes('"') || value.includes('\n')) {
      lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

/**
 * Render skill file content from template
 * When isGlobal=true, rewrites script paths to use ~/{root}/ prefix
 */
export async function renderSkillFile(config: PlatformConfig, isGlobal = false): Promise<string> {
  // Load base template
  let content = await loadTemplate('base/skill-content.md');

  // Load quick reference if needed
  let quickReferenceContent = '';
  if (config.sections.quickReference) {
    quickReferenceContent = await loadTemplate('base/quick-reference.md');
  }

  // scriptPath is relative to the platform root. Generated commands run from
  // the user's project root, so local installs need the platform root prefix;
  // global installs need the same path anchored at the user's home directory.
  const rootedScriptPath = `${config.folderStructure.root}/${config.scriptPath}`
    .replace(/\/{2,}/g, '/');
  const commandScriptPath = isGlobal ? `~/${rootedScriptPath}` : rootedScriptPath;

  // Build the final content
  const frontmatter = renderFrontmatter(config.frontmatter);

  // Replace placeholders
  // Add newline before quick reference content if it exists
  const quickRefWithNewline = quickReferenceContent ? '\n' + quickReferenceContent : '';

  content = content
    .replace(/\{\{TITLE\}\}/g, config.title)
    .replace(/\{\{DESCRIPTION\}\}/g, config.description)
    .replace(/\{\{SCRIPT_PATH\}\}/g, commandScriptPath)
    .replace(/\{\{SKILL_OR_WORKFLOW\}\}/g, config.skillOrWorkflow)
    .replace(/\{\{QUICK_REFERENCE\}\}/g, quickRefWithNewline);

  return frontmatter + content;
}

/**
 * Replace a pre-existing non-directory at `path` so a real directory can be
 * created there. Older CLI installs (and Windows checkouts of the repo's
 * symlinked data/scripts) can leave plain "pointer" files at these paths;
 * mkdir then throws EEXIST and the install silently leaves stale files.
 */
async function ensureCleanDir(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory()) {
      await rm(path, { recursive: true, force: true });
    }
  } catch {
    // Nothing exists at the path yet — mkdir will create it.
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** One thing an install writes, and whether this run will write or skip it. */
export interface InstallArtifact {
  kind: 'skill-file' | 'data' | 'scripts' | 'sub-skill';
  /** Destination path. */
  path: string;
  /** Source inside the bundled assets (absent for the rendered SKILL.md). */
  source?: string;
  action: 'write' | 'skip';
}

/**
 * The single place that decides, per artifact, whether an install writes or
 * skips it. Used by the real install and by the --dry-run preview so they can
 * never disagree. An existing artifact is skipped unless `force`; a stale
 * non-directory at a data/scripts path counts as missing (it is replaced).
 */
async function decideInstall(
  config: PlatformConfig,
  targetDir: string,
  isGlobal: boolean,
  force: boolean
): Promise<{ artifacts: InstallArtifact[]; paths: ReturnType<typeof resolveInstallPaths> }> {
  const paths = resolveInstallPaths(config, targetDir, isGlobal);
  const artifacts: InstallArtifact[] = [];

  artifacts.push({
    kind: 'skill-file',
    path: paths.skillFilePath,
    action: !force && (await exists(paths.skillFilePath)) ? 'skip' : 'write',
  });

  for (const name of ['data', 'scripts'] as const) {
    const source = join(ASSETS_DIR, name);
    if (!(await exists(source))) continue;
    const path = join(paths.dataDir, name);
    artifacts.push({
      kind: name,
      path,
      source,
      action: !force && (await isDirectory(path)) ? 'skip' : 'write',
    });
  }

  for (const name of await listBundledSubSkills()) {
    const path = join(paths.skillsParentDir, name);
    artifacts.push({
      kind: 'sub-skill',
      path,
      source: join(ASSETS_DIR, 'skills', name),
      action: !force && (await exists(path)) ? 'skip' : 'write',
    });
  }

  return { artifacts, paths };
}

/**
 * List the static sub-skills bundled under assets/skills/ (everything except
 * the template-rendered orchestrator). Empty if the package predates bundling.
 */
export async function listBundledSubSkills(): Promise<string[]> {
  const skillsSource = join(ASSETS_DIR, 'skills');
  if (!(await exists(skillsSource))) return [];
  const entries = await readdir(skillsSource, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
}

/**
 * Resolve every path an install touches for one platform. Shared by the real
 * install (generatePlatformFiles) and the read-only preview
 * (planPlatformInstallActions) so the two can never disagree.
 */
function resolveInstallPaths(
  config: PlatformConfig,
  targetDir: string,
  isGlobal: boolean
): {
  skillDir: string;
  skillFilePath: string;
  dataDir: string;
  skillsParentDir: string;
} {
  // For global install, target the user's home directory
  const effectiveDir = isGlobal ? homedir() : targetDir;

  // Determine full skill directory path
  const skillDir = join(
    effectiveDir,
    config.folderStructure.root,
    config.folderStructure.skillPath
  );
  const skillFilePath = join(skillDir, config.folderStructure.filename);

  // Copy data and scripts into the data directory (may differ from skill file location)
  const dataDir = config.folderStructure.dataPath
    ? join(effectiveDir, config.folderStructure.root, config.folderStructure.dataPath)
    : skillDir;

  // The skills parent is the orchestrator's parent dir (skills/ for most
  // platforms, prompts/ for copilot, steering/ for kiro) — derived, not
  // hardcoded. For platforms with a separate dataPath (copilot), the
  // orchestrator's data dir is the anchor.
  const skillsParentDir = join(
    effectiveDir,
    config.folderStructure.root,
    config.folderStructure.dataPath
      ? dirname(config.folderStructure.dataPath)
      : dirname(config.folderStructure.skillPath)
  );

  return { skillDir, skillFilePath, dataDir, skillsParentDir };
}

export interface InstallResult {
  /** Platform root folders that received new files (empty if nothing was written). */
  folders: string[];
  /** Paths that already existed and were left untouched. */
  skipped: string[];
}

export interface InstallAllResult extends InstallResult {
  /** Platforms whose install threw; the remaining platforms are still installed. */
  failures: { aiType: string; error: string }[];
}

/**
 * Generate platform files for a specific AI type
 * All platforms use self-contained installation with data and scripts
 * When isGlobal=true, installs to ~/home directory with absolute script paths
 * Each artifact (SKILL.md, data, scripts, every sub-skill) is skipped on its
 * own when it already exists and `force` is not set, so a partial install is
 * repaired without clobbering user edits. Throws if any write fails.
 */
export async function generatePlatformFiles(
  targetDir: string,
  aiType: string,
  isGlobal = false,
  force = false
): Promise<InstallResult> {
  const config = await loadPlatformConfig(aiType);
  const { artifacts, paths } = await decideInstall(config, targetDir, isGlobal, force);
  const skipped = artifacts.filter(a => a.action === 'skip').map(a => a.path);
  const toWrite = artifacts.filter(a => a.action === 'write');

  // Create directory structure
  await mkdir(paths.skillDir, { recursive: true });
  await mkdir(paths.dataDir, { recursive: true });

  for (const artifact of toWrite) {
    if (artifact.kind === 'skill-file') {
      await writeFile(artifact.path, await renderSkillFile(config, isGlobal), 'utf-8');
      continue;
    }
    // Older installs can leave a plain "pointer" file where a directory belongs.
    await ensureCleanDir(artifact.path);
    await mkdir(artifact.path, { recursive: true });
    await cp(artifact.source!, artifact.path, { recursive: true });
  }

  return { folders: toWrite.length > 0 ? [config.folderStructure.root] : [], skipped };
}

/**
 * Preview the actions generatePlatformFiles would take for one AI type,
 * without writing anything. Used by `uipro init --dry-run`.
 */
export async function planPlatformInstallActions(
  targetDir: string,
  aiType: string,
  isGlobal = false,
  force = false
): Promise<string[]> {
  const config = await loadPlatformConfig(aiType);
  const { artifacts } = await decideInstall(config, targetDir, isGlobal, force);

  return artifacts.map(a =>
    a.action === 'skip'
      ? `Would skip (exists, use --force): ${a.path}`
      : `Would write: ${a.path}`
  );
}

export interface PlanAllResult {
  planned: Map<string, string[]>;
  /** Platforms whose plan could not be built (same condition the real install reports). */
  failures: { aiType: string; error: string }[];
}

/**
 * Preview the actions generateAllPlatformFiles would take, grouped per unique
 * platform layout, without writing anything. Used by `uipro init --dry-run`.
 */
export async function planAllPlatformInstallActions(
  targetDir: string,
  isGlobal = false,
  force = false
): Promise<PlanAllResult> {
  const planned = new Map<string, string[]>();
  const failures: { aiType: string; error: string }[] = [];
  const generatedSkillFiles = new Set<string>();

  for (const aiType of Object.keys(AI_TO_PLATFORM)) {
    try {
      const config = await loadPlatformConfig(aiType);
      const skillFile = join(
        config.folderStructure.root,
        config.folderStructure.skillPath,
        config.folderStructure.filename
      );
      if (generatedSkillFiles.has(skillFile)) continue;
      generatedSkillFiles.add(skillFile);

      planned.set(aiType, await planPlatformInstallActions(targetDir, aiType, isGlobal, force));
    } catch (error) {
      failures.push({ aiType, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { planned, failures };
}

/**
 * Generate files for all AI types. A platform that fails is recorded in
 * `failures` and does not stop the remaining platforms.
 */
export async function generateAllPlatformFiles(
  targetDir: string,
  isGlobal = false,
  force = false
): Promise<InstallAllResult> {
  const allFolders = new Set<string>();
  const allSkipped = new Set<string>();
  const failures: { aiType: string; error: string }[] = [];
  const generatedSkillFiles = new Set<string>();

  for (const aiType of Object.keys(AI_TO_PLATFORM)) {
    try {
      const config = await loadPlatformConfig(aiType);
      const skillFile = join(
        config.folderStructure.root,
        config.folderStructure.skillPath,
        config.folderStructure.filename
      );
      if (generatedSkillFiles.has(skillFile)) continue;

      const result = await generatePlatformFiles(targetDir, aiType, isGlobal, force);
      generatedSkillFiles.add(skillFile);
      result.folders.forEach(f => allFolders.add(f));
      result.skipped.forEach(p => allSkipped.add(p));
    } catch (error) {
      failures.push({
        aiType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { folders: Array.from(allFolders), skipped: Array.from(allSkipped), failures };
}

/**
 * Get list of supported AI types
 */
export function getSupportedAITypes(): string[] {
  return Object.keys(AI_TO_PLATFORM);
}
