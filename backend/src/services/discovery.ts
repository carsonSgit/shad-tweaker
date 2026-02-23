import path from 'node:path';
import fs from 'fs-extra';
import type { ComponentRoot } from '../types/index.js';
import { isPathSafe } from '../utils/validation.js';

const COMMON_COMPONENT_DIRS = [
  'src/components/ui',
  'components/ui',
  'app/components/ui',
  'src/ui',
  'frontend/src/components/ui',
  'frontend/src/components',
  'frontend/components/ui',
  'packages/ui/src/components',
];

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.shadcn-tweaker',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

export interface DiscoveryResult {
  projectRoot: string;
  packageRoots: string[];
  componentRoots: ComponentRoot[];
  ignoredDirectories: string[];
  pathViolations: string[];
}

function scoreRoot(rootPath: string, explicit: boolean): ComponentRoot {
  const normalized = rootPath.replace(/\\/g, '/');
  if (explicit) {
    return { path: rootPath, confidence: 100, reason: 'explicitly configured path' };
  }
  if (normalized.includes('/components/ui') || normalized.endsWith('/components/ui')) {
    return { path: rootPath, confidence: 95, reason: 'matches canonical components/ui location' };
  }
  if (normalized.includes('/src/ui') || normalized.endsWith('/src/ui')) {
    return { path: rootPath, confidence: 82, reason: 'matches common src/ui location' };
  }
  return { path: rootPath, confidence: 70, reason: 'matches known component root heuristic' };
}

async function discoverPackageRoots(projectRoot: string, maxDepth = 3): Promise<string[]> {
  const discovered = new Set<string>();

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    if (await fs.pathExists(path.join(currentDir, 'package.json'))) {
      discovered.add(currentDir);
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      await walk(path.join(currentDir, entry.name), depth + 1);
    }
  }

  await walk(projectRoot, 0);
  if (!discovered.has(projectRoot)) {
    discovered.add(projectRoot);
  }
  return Array.from(discovered).sort();
}

export async function discoverComponentRoots(
  projectRoot: string,
  explicitPaths: string[] = []
): Promise<DiscoveryResult> {
  const packageRoots = await discoverPackageRoots(projectRoot);
  const rootsByPath = new Map<string, ComponentRoot>();
  const pathViolations: string[] = [];

  const pushRoot = (candidatePath: string, explicit: boolean): void => {
    const resolved = path.resolve(candidatePath);
    if (!isPathSafe(resolved, projectRoot)) {
      pathViolations.push(resolved);
      return;
    }

    if (!rootsByPath.has(resolved)) {
      rootsByPath.set(resolved, scoreRoot(resolved, explicit));
    }
  };

  for (const explicitPath of explicitPaths) {
    const absolute = path.isAbsolute(explicitPath) ? explicitPath : path.join(projectRoot, explicitPath);
    if (await fs.pathExists(absolute)) {
      pushRoot(absolute, true);
    }
  }

  for (const packageRoot of packageRoots) {
    for (const knownDir of COMMON_COMPONENT_DIRS) {
      const candidate = path.join(packageRoot, knownDir);
      if (await fs.pathExists(candidate)) {
        pushRoot(candidate, false);
      }
    }
  }

  return {
    projectRoot,
    packageRoots,
    componentRoots: Array.from(rootsByPath.values()).sort((a, b) =>
      a.path.localeCompare(b.path)
    ),
    ignoredDirectories: Array.from(IGNORED_DIRS).sort(),
    pathViolations: Array.from(new Set(pathViolations)).sort(),
  };
}

export const DISCOVERY_IGNORED_DIRECTORIES = IGNORED_DIRS;
