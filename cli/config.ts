import fs from 'fs-extra';
import path from 'path';

export interface ShadcnTweakerConfig {
  componentsPath: string;
  backupsDir: string;
  templatesDir: string;
  maxBackups: number;
}

const CONFIG_FILENAME = '.shadcn-tweaker.json';

const DEFAULT_CONFIG: ShadcnTweakerConfig = {
  componentsPath: './components/ui',
  backupsDir: './.shadcn-tweaker/backups',
  templatesDir: './.shadcn-tweaker/templates',
  maxBackups: 20,
};

export function getConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, CONFIG_FILENAME);
}

export async function configExists(cwd: string = process.cwd()): Promise<boolean> {
  return fs.pathExists(getConfigPath(cwd));
}

export async function loadConfig(cwd: string = process.cwd()): Promise<ShadcnTweakerConfig | null> {
  const configPath = getConfigPath(cwd);
  
  if (!(await fs.pathExists(configPath))) {
    return null;
  }

  try {
    const config = await fs.readJson(configPath);
    return {
      ...DEFAULT_CONFIG,
      ...config,
    };
  } catch (error) {
    console.error(`Failed to read config file: ${configPath}`);
    return null;
  }
}

export async function saveConfig(
  config: Partial<ShadcnTweakerConfig>,
  cwd: string = process.cwd()
): Promise<void> {
  const configPath = getConfigPath(cwd);
  const fullConfig: ShadcnTweakerConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  await fs.writeJson(configPath, fullConfig, { spaces: 2 });
}

export async function resolveComponentsPath(
  cliPath?: string,
  cwd: string = process.cwd()
): Promise<string | null> {
  // Priority 1: CLI argument
  if (cliPath) {
    const absolutePath = path.isAbsolute(cliPath) ? cliPath : path.join(cwd, cliPath);
    if (await fs.pathExists(absolutePath)) {
      return absolutePath;
    }
    return null;
  }

  // Priority 2: Config file
  const config = await loadConfig(cwd);
  if (config?.componentsPath) {
    const configPath = path.isAbsolute(config.componentsPath)
      ? config.componentsPath
      : path.join(cwd, config.componentsPath);
    if (await fs.pathExists(configPath)) {
      return configPath;
    }
  }

  // Priority 3: Auto-detect common paths
  const commonPaths = [
    'src/components/ui',
    'components/ui',
    'app/components/ui',
    'src/ui',
    'frontend/src/components/ui',
    'frontend/src/components',
    'frontend/components/ui',
    'packages/ui/src/components',
  ];

  for (const commonPath of commonPaths) {
    const fullPath = path.join(cwd, commonPath);
    if (await fs.pathExists(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

export function getDefaultConfig(): ShadcnTweakerConfig {
  return { ...DEFAULT_CONFIG };
}
