import path from 'node:path';
import fs from 'fs-extra';
import type { Component, ScanResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

const COMMON_COMPONENT_DIRS = [
  'src/components/ui',
  'components/ui',
  'app/components/ui',
  'src/ui',
  'frontend/src/components/ui',
  'frontend/src/components',
  'frontend/components/ui',
  'packages/ui/src/components',
  // For monorepo: check parent directory
  '../src/components/ui',
  '../components/ui',
  '../frontend/src/components/ui',
  '../frontend/src/components',
];

let cachedComponents: Component[] = [];
let _componentDirectory = '';

// Get the working directory - either from environment or process.cwd()
export function getWorkingDirectory(): string {
  return process.env.SHADCN_TWEAKER_CWD || process.cwd();
}

// Get the configured components path from environment
export function getConfiguredComponentsPath(): string | undefined {
  return process.env.SHADCN_COMPONENTS_PATH;
}

export async function findComponentDirectory(
  basePath: string,
  customPath?: string
): Promise<string | null> {
  // Priority 1: Explicit custom path passed to function
  if (customPath) {
    const fullPath = path.isAbsolute(customPath) ? customPath : path.join(basePath, customPath);
    if (await fs.pathExists(fullPath)) {
      return fullPath;
    }
    return null;
  }

  // Priority 2: Environment variable from CLI
  const envPath = getConfiguredComponentsPath();
  if (envPath) {
    // If it's already an absolute path, use it directly
    if (path.isAbsolute(envPath)) {
      if (await fs.pathExists(envPath)) {
        return envPath;
      }
    } else {
      const fullPath = path.join(basePath, envPath);
      if (await fs.pathExists(fullPath)) {
        return fullPath;
      }
    }
    logger.warn(`Configured components path not found: ${envPath}`);
  }

  // Priority 3: Auto-detect from common paths
  for (const dir of COMMON_COMPONENT_DIRS) {
    const fullPath = path.join(basePath, dir);
    if (await fs.pathExists(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

export async function scanComponents(basePath: string, customPath?: string): Promise<ScanResult> {
  const dir = await findComponentDirectory(basePath, customPath);

  if (!dir) {
    return {
      success: false,
      count: 0,
      directory: '',
      components: [],
    };
  }

  _componentDirectory = dir;
  const components: Component[] = [];

  try {
    const files = await fs.readdir(dir);

    for (const file of files) {
      if (!file.endsWith('.tsx') && !file.endsWith('.jsx')) continue;

      const filePath = path.join(dir, file);
      const stats = await fs.stat(filePath);

      if (!stats.isFile()) continue;

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').length;

      const classMatches = content.match(/className\s*[=:]\s*["'`{]/g) || [];

      components.push({
        name: path.basename(file, path.extname(file)),
        path: filePath,
        metadata: {
          lines,
          size: stats.size,
          lastModified: stats.mtime.toISOString(),
          classCount: classMatches.length,
        },
      });
    }

    cachedComponents = components;

    logger.info(`Scanned ${components.length} components in ${dir}`);

    return {
      success: true,
      count: components.length,
      directory: dir,
      components,
    };
  } catch (error) {
    logger.error('Failed to scan components', error);
    throw error;
  }
}

export function getCachedComponents(): Component[] {
  return cachedComponents;
}

export async function getComponentByName(name: string): Promise<Component | null> {
  const component = cachedComponents.find((c) => c.name === name);

  if (!component) return null;

  try {
    const content = await fs.readFile(component.path, 'utf-8');

    const classRegex = /className\s*[=:]\s*["'`]([^"'`]+)["'`]/g;
    const classes: string[] = [];
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      const classString = match[1];
      classes.push(...classString.split(/\s+/).filter(Boolean));
    }

    const exportMatches = content.match(/export\s+(?:const|function|class)\s+(\w+)/g) || [];
    const exports = exportMatches
      .map((m) => {
        const match = m.match(/export\s+(?:const|function|class)\s+(\w+)/);
        return match ? match[1] : '';
      })
      .filter(Boolean);

    return {
      ...component,
      content,
      classes: [...new Set(classes)],
      metadata: {
        ...component.metadata,
        exports,
      },
    };
  } catch (error) {
    logger.error(`Failed to read component: ${name}`, error);
    return null;
  }
}

export async function getComponentsWithContent(): Promise<Component[]> {
  const components: Component[] = [];

  for (const comp of cachedComponents) {
    const content = await fs.readFile(comp.path, 'utf-8');
    components.push({
      ...comp,
      content,
    });
  }

  return components;
}
