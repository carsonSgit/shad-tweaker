import path from 'node:path';
import fs from 'fs-extra';
import type {
  ComponentPackage,
  RegistryDependency,
  RegistryItemSummary,
  RegistryReadWarning,
  RegistrySource,
  RegistrySourceHealth,
  RegistrySourceIssue,
  RegistrySourceListResult,
} from '../types/index.js';
import { getWorkingDirectory, listRegistrySources } from './workspace.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';

interface RegistryItemRaw {
  name?: string;
  type?: string;
  files?: unknown[];
  dependencies?: string[];
  registryDependencies?: string[];
}

function issue(code: string, message: string): RegistrySourceIssue {
  return { code, message };
}

function statusFromIssues(issues: RegistrySourceIssue[]): RegistrySourceHealth['status'] {
  return issues.length === 0 ? 'healthy' : 'degraded';
}

function normalizeType(value?: string): ComponentPackage['type'] {
  if (value === 'hook' || value === 'utility' || value === 'page') {
    return value;
  }
  return 'registry-item';
}

function normalizeDeps(deps: string[] | undefined, type: RegistryDependency['type']): RegistryDependency[] {
  return (deps ?? []).map((name) => ({ name, type }));
}

function mapToPackage(raw: RegistryItemRaw, source: RegistrySource): ComponentPackage {
  const now = new Date().toISOString();
  const name = (raw.name ?? 'unknown').toString();
  return {
    id: `${source.id}:${name}`,
    name,
    type: normalizeType(raw.type),
    files: [],
    source: {
      originRegistry: source.name,
      originalComponentName: name,
      importedAt: now,
    },
    dependencies: normalizeDeps(raw.dependencies, 'package'),
    registryDependencies: normalizeDeps(raw.registryDependencies, 'registry'),
    createdAt: now,
    updatedAt: now,
  };
}

async function checkRemoteUrl(url: string): Promise<RegistrySourceIssue[]> {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      return [issue('HTTP_ERROR', `HTTP ${response.status} returned from ${url}`)];
    }
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown network error';
    return [issue('NETWORK_ERROR', message)];
  }
}

async function healthForSource(source: RegistrySource, cwd: string): Promise<RegistrySourceHealth> {
  const issues: RegistrySourceIssue[] = [];

  if (!source.enabled) {
    issues.push(issue('SOURCE_DISABLED', 'Source is disabled'));
  }

  if (source.type === 'local-folder') {
    if (!source.baseUrl || !isSafeProjectRelativePath(source.baseUrl)) {
      issues.push(issue('INVALID_LOCAL_PATH', 'baseUrl must be a safe project-relative path'));
    } else {
      const fullPath = path.resolve(cwd, source.baseUrl);
      if (!(await fs.pathExists(fullPath))) {
        issues.push(issue('LOCAL_PATH_MISSING', `Local folder does not exist: ${source.baseUrl}`));
      }
    }
  }

  if ((source.type === 'shadcn-registry' || source.type === 'url-list') && source.registryJsonUrl) {
    issues.push(...(await checkRemoteUrl(source.registryJsonUrl)));
  }

  if (source.type === 'npm-package') {
    if (!source.baseUrl) {
      issues.push(issue('MISSING_PACKAGE_NAME', 'npm package source requires baseUrl package name'));
    } else {
      const lookup = `https://registry.npmjs.org/${encodeURIComponent(source.baseUrl)}`;
      issues.push(...(await checkRemoteUrl(lookup)));
    }
  }

  return {
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    status: statusFromIssues(issues),
    checkedAt: new Date().toISOString(),
    issues,
  };
}

export async function getRegistrySourceHealth(cwd: string = getWorkingDirectory()): Promise<RegistrySourceHealth[]> {
  const sources = await listRegistrySources(cwd);
  return Promise.all(sources.map((source) => healthForSource(source, cwd)));
}

export async function listRegistryItems(cwd: string = getWorkingDirectory()): Promise<RegistrySourceListResult> {
  const sources = await listRegistrySources(cwd);
  const warnings: RegistryReadWarning[] = [];
  const items: RegistryItemSummary[] = [];

  for (const source of sources.filter((candidate) => candidate.enabled)) {
    if (!source.registryJsonUrl) {
      warnings.push({ sourceId: source.id, sourceName: source.name, message: 'No registryJsonUrl configured' });
      continue;
    }

    try {
      const response = await fetch(source.registryJsonUrl, { method: 'GET' });
      if (!response.ok) {
        warnings.push({
          sourceId: source.id,
          sourceName: source.name,
          message: `Failed to fetch registry listing: HTTP ${response.status}`,
        });
        continue;
      }

      const payload = (await response.json()) as { items?: Array<{ name?: string; type?: string }> };
      for (const item of payload.items ?? []) {
        if (!item.name) continue;
        items.push({
          id: `${source.id}:${item.name}`,
          name: item.name,
          type: normalizeType(item.type),
          sourceId: source.id,
          sourceName: source.name,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown fetch error';
      warnings.push({ sourceId: source.id, sourceName: source.name, message });
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name) || a.sourceId.localeCompare(b.sourceId));
  return { items, warnings };
}

export async function getRegistryItem(
  sourceId: string,
  itemName: string,
  cwd: string = getWorkingDirectory()
): Promise<ComponentPackage | null> {
  const sources = await listRegistrySources(cwd);
  const source = sources.find((candidate) => candidate.id === sourceId && candidate.enabled);
  if (!source || !source.registryJsonUrl) return null;

  try {
    const response = await fetch(source.registryJsonUrl, { method: 'GET' });
    if (!response.ok) return null;
    const payload = (await response.json()) as { items?: RegistryItemRaw[] };
    const match = (payload.items ?? []).find((entry) => entry.name === itemName);
    if (!match) return null;
    return mapToPackage(match, source);
  } catch {
    return null;
  }
}
