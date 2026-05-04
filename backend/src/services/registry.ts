import path from 'node:path';
import fs from 'fs-extra';
import type {
  ComponentPackage,
  RegistryDependency,
  RegistryItemFile,
  RegistryItemSummary,
  RegistryReadWarning,
  RegistrySource,
  RegistrySourceHealth,
  RegistrySourceIssue,
  RegistrySourceListResult,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';
import { isHttpUrl, isSafeRegistryIdentifier } from '../utils/validation.js';
import { getWorkingDirectory, listRegistrySources } from './workspace.js';

interface RegistryItemRaw {
  name?: string;
  type?: string;
  files?: unknown[];
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
}

const REGISTRY_FETCH_TIMEOUT_MS = 10_000;
const NPM_PACKAGE_NAME_PART_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

async function fetchRegistryUrl(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRY_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { method: 'GET', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return `Request timed out after ${REGISTRY_FETCH_TIMEOUT_MS}ms`;
  }
  return error instanceof Error ? error.message : fallback;
}

function issue(code: string, message: string): RegistrySourceIssue {
  return { code, message };
}

function statusFromIssues(issues: RegistrySourceIssue[]): RegistrySourceHealth['status'] {
  if (issues.some((entry) => entry.code === 'NETWORK_ERROR' || entry.code === 'HTTP_ERROR')) {
    return 'unhealthy';
  }
  return issues.length === 0 ? 'healthy' : 'degraded';
}

function isValidNpmPackageName(value: string): boolean {
  if (value.length === 0 || value.length > 214 || value.includes('\\')) {
    return false;
  }
  if (
    [...value].some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) ||
    value.startsWith('.') ||
    value.startsWith('_')
  ) {
    return false;
  }
  if (value.startsWith('@')) {
    const parts = value.split('/');
    return (
      parts.length === 2 &&
      parts[0].startsWith('@') &&
      NPM_PACKAGE_NAME_PART_PATTERN.test(parts[0].slice(1)) &&
      NPM_PACKAGE_NAME_PART_PATTERN.test(parts[1]) &&
      parts.every((part) => !part.includes('..'))
    );
  }
  return !value.includes('/') && !value.includes('..') && NPM_PACKAGE_NAME_PART_PATTERN.test(value);
}

function encodeNpmPackageName(value: string): string {
  if (!value.startsWith('@')) {
    return encodeURIComponent(value);
  }
  const [scope, name = ''] = value.slice(1).split('/', 2);
  return `@${encodeURIComponent(scope)}%2F${encodeURIComponent(name)}`;
}

function normalizeType(value?: string): ComponentPackage['type'] {
  if (value === 'component' || value === 'hook' || value === 'utility' || value === 'page') {
    return value;
  }
  return 'registry-item';
}

function normalizeDeps(
  deps: string[] | undefined,
  type: RegistryDependency['type']
): RegistryDependency[] {
  return (deps ?? []).map((name) => ({ name, type }));
}

function normalizeFiles(files: unknown[] | undefined): string[] {
  return normalizeRegistryFiles(files).map((file) => file.path);
}

function normalizeRegistryFiles(files: unknown[] | undefined): RegistryItemFile[] {
  return (files ?? [])
    .map((file) => {
      if (typeof file === 'string') return { path: file };
      if (typeof file !== 'object' || file === null || !('path' in file)) return null;

      const candidate = file as { path?: unknown; content?: unknown; type?: unknown };
      if (typeof candidate.path !== 'string') return null;

      return {
        path: candidate.path,
        content: typeof candidate.content === 'string' ? candidate.content : undefined,
        type: typeof candidate.type === 'string' ? candidate.type : undefined,
      };
    })
    .filter((file): file is RegistryItemFile => file !== null);
}

function mapToPackage(raw: RegistryItemRaw, source: RegistrySource): ComponentPackage {
  const now = new Date().toISOString();
  const name = (raw.name ?? 'unknown').toString();
  return {
    id: `${source.id}:${name}`,
    name,
    type: normalizeType(raw.type),
    files: normalizeFiles(raw.files),
    registryFiles: normalizeRegistryFiles(raw.files),
    source: {
      originRegistry: source.name,
      originalComponentName: name,
      importedAt: now,
    },
    dependencies: normalizeDeps(raw.dependencies, 'package'),
    devDependencies: normalizeDeps(raw.devDependencies, 'package'),
    registryDependencies: normalizeDeps(raw.registryDependencies, 'registry'),
    createdAt: now,
    updatedAt: now,
  };
}

async function checkRemoteUrl(url: string): Promise<RegistrySourceIssue[]> {
  if (!isHttpUrl(url)) {
    return [issue('INVALID_URL', `Invalid HTTP URL: ${url}`)];
  }
  try {
    const response = await fetchRegistryUrl(url);
    if (!response.ok) {
      return [issue('HTTP_ERROR', `HTTP ${response.status} returned from ${url}`)];
    }
    return [];
  } catch (error) {
    return [issue('NETWORK_ERROR', errorMessage(error, 'Unknown network error'))];
  }
}

async function healthForSource(source: RegistrySource, cwd: string): Promise<RegistrySourceHealth> {
  const issues: RegistrySourceIssue[] = [];

  if (!source.enabled) {
    issues.push(issue('SOURCE_DISABLED', 'Source is disabled'));
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.type,
      status: statusFromIssues(issues),
      checkedAt: new Date().toISOString(),
      issues,
    };
  }

  if (source.type === 'local-folder') {
    if (!source.baseUrl || !isSafeProjectRelativePath(source.baseUrl)) {
      issues.push(issue('INVALID_LOCAL_PATH', 'baseUrl must be a safe project-relative path'));
    } else {
      const fullPath = path.resolve(cwd, source.baseUrl);
      if (!(await fs.pathExists(fullPath))) {
        issues.push(issue('LOCAL_PATH_MISSING', `Local folder does not exist: ${source.baseUrl}`));
      } else {
        const stats = await fs.stat(fullPath);
        if (!stats.isDirectory()) {
          issues.push(
            issue(
              'LOCAL_PATH_NOT_DIRECTORY',
              `Local folder path is not a directory: ${source.baseUrl}`
            )
          );
        }
      }
    }
  }

  if (source.type === 'shadcn-registry' || source.type === 'url-list') {
    if (!source.registryJsonUrl) {
      issues.push(issue('MISSING_REGISTRY_URL', 'Remote registry sources require registryJsonUrl'));
    } else {
      issues.push(...(await checkRemoteUrl(source.registryJsonUrl)));
    }
  }

  if (source.type === 'npm-package') {
    if (!source.baseUrl) {
      issues.push(
        issue('MISSING_PACKAGE_NAME', 'npm package source requires baseUrl package name')
      );
    } else if (!isValidNpmPackageName(source.baseUrl)) {
      issues.push(issue('INVALID_PACKAGE_NAME', `Invalid npm package name: ${source.baseUrl}`));
    } else {
      const lookup = `https://registry.npmjs.org/${encodeNpmPackageName(source.baseUrl)}`;
      issues.push(...(await checkRemoteUrl(lookup)));
      issues.push(
        issue(
          'LISTING_UNSUPPORTED',
          'npm package sources are not supported by registry item listing yet'
        )
      );
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

export async function getRegistrySourceHealth(
  cwd: string = getWorkingDirectory()
): Promise<RegistrySourceHealth[]> {
  const sources = await listRegistrySources(cwd);
  return Promise.all(sources.map((source) => healthForSource(source, cwd)));
}

export async function listRegistryItems(
  cwd: string = getWorkingDirectory()
): Promise<RegistrySourceListResult> {
  return listRegistryItemsBySource(undefined, cwd);
}

export async function listRegistryItemsBySource(
  sourceId: string | undefined,
  cwd: string = getWorkingDirectory()
): Promise<RegistrySourceListResult> {
  const sources = await listRegistrySources(cwd);
  const warnings: RegistryReadWarning[] = [];
  const items: RegistryItemSummary[] = [];

  const candidates = sources.filter((candidate) => candidate.enabled);
  const filtered = sourceId
    ? candidates.filter((candidate) => candidate.id === sourceId)
    : candidates;

  for (const source of filtered) {
    if (!source.registryJsonUrl || !isHttpUrl(source.registryJsonUrl)) {
      warnings.push({
        sourceId: source.id,
        sourceName: source.name,
        message:
          source.type === 'npm-package'
            ? 'npm package sources are not supported by registry item listing yet'
            : 'No registryJsonUrl configured',
      });
      continue;
    }

    try {
      const response = await fetchRegistryUrl(source.registryJsonUrl);
      if (!response.ok) {
        warnings.push({
          sourceId: source.id,
          sourceName: source.name,
          message: `Failed to fetch registry listing: HTTP ${response.status}`,
        });
        continue;
      }

      const payload = (await response.json()) as {
        items?: Array<{ name?: string; type?: string }>;
      };
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
      warnings.push({
        sourceId: source.id,
        sourceName: source.name,
        message: errorMessage(error, 'Unknown fetch error'),
      });
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
  if (!sourceId || !isSafeRegistryIdentifier(sourceId)) {
    return null;
  }
  if (!itemName || !isSafeRegistryIdentifier(itemName)) {
    return null;
  }
  const sources = await listRegistrySources(cwd);
  const source = sources.find((candidate) => candidate.id === sourceId && candidate.enabled);
  if (!source?.registryJsonUrl || !isHttpUrl(source.registryJsonUrl)) return null;

  try {
    const response = await fetchRegistryUrl(source.registryJsonUrl);
    if (!response.ok) return null;
    const payload = (await response.json()) as { items?: RegistryItemRaw[] };
    const match = (payload.items ?? []).find((entry) => entry.name === itemName);
    if (!match) return null;
    return mapToPackage(match, source);
  } catch (error) {
    logger.warn(`Failed to fetch registry item: ${sourceId}/${itemName}`, error);
    return null;
  }
}

export async function findRegistryItem(
  itemName: string,
  cwd: string = getWorkingDirectory()
): Promise<ComponentPackage | null> {
  if (!itemName || !isSafeRegistryIdentifier(itemName)) {
    return null;
  }
  const sources = (await listRegistrySources(cwd))
    .filter((source) => source.enabled)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const source of sources) {
    const item = await getRegistryItem(source.id, itemName, cwd);
    if (item) return item;
  }
  return null;
}
