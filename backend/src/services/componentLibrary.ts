import path from 'node:path';
import fs from 'fs-extra';
import type {
  ComponentLibraryDetail,
  ComponentLibraryDuplicate,
  ComponentLibraryInventoryItem,
  RegistryDependency,
  WorkspaceComponent,
} from '../types/index.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';
import { parseComponentSource } from './parser.js';
import { findComponentDirectory } from './scanner.js';
import { loadWorkspaceManifest } from './workspace.js';

const SUPPORTED_COMPONENT_EXTENSIONS = new Set(['.tsx', '.jsx']);
const TOKEN_PATTERN = /\b(?:bg|text|border|ring|shadow|fill|stroke|from|via|to)-[a-z0-9-:/[\].%]+/g;
const PRIMITIVE_PATTERNS = [
  { pattern: /@radix-ui\/react-([a-z0-9-]+)/, label: 'radix' },
  { pattern: /@base-ui-components\/react\/([a-z0-9-]+)/, label: 'base-ui' },
  { pattern: /@headlessui\/react/, label: 'headless-ui' },
];

export class ComponentLibraryNotFoundError extends Error {
  readonly code = 'COMPONENT_LIBRARY_NOT_FOUND';
}

export class ComponentLibraryValidationError extends Error {
  readonly code = 'COMPONENT_LIBRARY_VALIDATION_ERROR';
}

export class ComponentLibraryConflictError extends Error {
  readonly code = 'COMPONENT_LIBRARY_CONFLICT';
}

interface ComponentFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  stats: fs.Stats;
  manifestComponent?: WorkspaceComponent;
}

function toComponentName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function toKebabCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-');
}

function normalizeComponentName(value: string): string {
  const name = toKebabCase(value);
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new ComponentLibraryValidationError('Component name must be a safe kebab-case name.');
  }
  return name;
}

function ensureSafeRelativePath(value: string): string {
  if (!value || !isSafeProjectRelativePath(value)) {
    throw new ComponentLibraryValidationError('Component path must stay inside the project.');
  }
  const normalized = path.normalize(value).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!SUPPORTED_COMPONENT_EXTENSIONS.has(path.extname(normalized))) {
    throw new ComponentLibraryValidationError('Component path must point to a TSX or JSX file.');
  }
  return normalized;
}

async function getComponentDirectory(cwd: string): Promise<string> {
  const manifest = await loadWorkspaceManifest(cwd);
  const configured = manifest.config.componentDirectory;
  const found = await findComponentDirectory(cwd, configured);
  if (found) return found;

  throw new ComponentLibraryNotFoundError('No component directory found.');
}

function matchManifestComponent(
  manifestComponents: WorkspaceComponent[],
  relativePath: string,
  absolutePath: string
): WorkspaceComponent | undefined {
  return manifestComponents.find((component) => {
    const componentPath = component.path.replace(/\\/g, '/');
    return componentPath === relativePath || path.resolve(component.path) === absolutePath;
  });
}

async function readComponentFiles(cwd: string): Promise<ComponentFile[]> {
  const componentDirectory = await getComponentDirectory(cwd);
  const manifest = await loadWorkspaceManifest(cwd);
  const entries = await fs.readdir(componentDirectory);
  const files: ComponentFile[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(componentDirectory, entry);
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile() || !SUPPORTED_COMPONENT_EXTENSIONS.has(path.extname(entry))) continue;

    const relativePath = path.relative(cwd, absolutePath).replace(/\\/g, '/');
    files.push({
      absolutePath,
      relativePath,
      content: await fs.readFile(absolutePath, 'utf-8'),
      stats,
      manifestComponent: matchManifestComponent(manifest.components, relativePath, absolutePath),
    });
  }

  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function getPrimitiveBase(content: string): string | undefined {
  for (const { pattern, label } of PRIMITIVE_PATTERNS) {
    const match = content.match(pattern);
    if (match) return match[1] ? `${label}:${match[1]}` : label;
  }
  return undefined;
}

function getTokenUsage(content: string): string[] {
  return [...new Set(content.match(TOKEN_PATTERN) ?? [])].sort();
}

function getDependencies(content: string, manifestComponent?: WorkspaceComponent): RegistryDependency[] {
  const dependencies = manifestComponent?.source?.dependencies ?? [];
  const packageImports = [...content.matchAll(/from\s+['"]([^.'"][^'"]*)['"]/g)].map(
    (match) => match[1]
  );
  const parsedDependencies = packageImports.map((name) => ({
    name,
    type: 'package' as const,
  }));
  return [...dependencies, ...parsedDependencies].filter(
    (dependency, index, all) => all.findIndex((item) => item.name === dependency.name) === index
  );
}

function toInventoryItem(file: ComponentFile): ComponentLibraryInventoryItem {
  const parsed = parseComponentSource(file.relativePath, file.content);
  const dependencies = getDependencies(file.content, file.manifestComponent);

  return {
    name: file.manifestComponent?.name ?? toComponentName(file.relativePath),
    path: file.relativePath,
    sourceRegistry: file.manifestComponent?.source?.originRegistry,
    primitiveBase: getPrimitiveBase(file.content),
    variantCount: parsed.variantDefinitions.length,
    lastModified: file.stats.mtime.toISOString(),
    dependencyStatus: dependencies.length > 0 ? 'ok' : 'none',
    tokenUsage: getTokenUsage(file.content),
    filePath: file.relativePath,
  };
}

function toDetail(file: ComponentFile): ComponentLibraryDetail {
  const parsed = parseComponentSource(file.relativePath, file.content);
  const inventory = toInventoryItem(file);

  return {
    ...inventory,
    content: file.content,
    exports: parsed.exports.map((item) => item.name),
    dependencies: getDependencies(file.content, file.manifestComponent),
    localComponentName: file.manifestComponent?.source?.localComponentName,
    originalComponentName: file.manifestComponent?.source?.originalComponentName,
  };
}

export async function listComponentLibrary(cwd: string): Promise<ComponentLibraryInventoryItem[]> {
  return (await readComponentFiles(cwd)).map(toInventoryItem);
}

export async function getComponentLibraryDetail(
  cwd: string,
  identifier: string
): Promise<ComponentLibraryDetail> {
  const normalizedPath = isSafeProjectRelativePath(identifier)
    ? identifier.replace(/\\/g, '/').replace(/^\.\//, '')
    : '';
  const files = await readComponentFiles(cwd);
  const file = files.find(
    (candidate) =>
      candidate.relativePath === normalizedPath ||
      toComponentName(candidate.relativePath) === identifier ||
      candidate.manifestComponent?.name === identifier
  );

  if (!file) {
    throw new ComponentLibraryNotFoundError(`Component not found: ${identifier}`);
  }

  return toDetail(file);
}

export async function findComponentLibraryDuplicates(
  cwd: string
): Promise<ComponentLibraryDuplicate[]> {
  const files = await readComponentFiles(cwd);
  const details = files.map(toDetail);
  const groups = new Map<string, { type: ComponentLibraryDuplicate['type']; paths: string[] }>();

  for (const detail of details) {
    addDuplicateCandidate(groups, 'name', detail.name, detail.path);
    for (const exportName of detail.exports) addDuplicateCandidate(groups, 'export', exportName, detail.path);
    for (const dependency of detail.dependencies) {
      addDuplicateCandidate(groups, 'dependency', dependency.name, detail.path);
    }
  }

  return [...groups.entries()]
    .filter(([, group]) => group.paths.length > 1)
    .map(([value, group]) => ({
      type: group.type,
      value,
      componentPaths: group.paths,
      suggestedNames: suggestedNames(value),
    }));
}

function addDuplicateCandidate(
  groups: Map<string, { type: ComponentLibraryDuplicate['type']; paths: string[] }>,
  type: ComponentLibraryDuplicate['type'],
  value: string,
  componentPath: string
): void {
  const key = `${type}:${value}`;
  const group = groups.get(key) ?? { type, paths: [] };
  group.paths.push(componentPath);
  groups.set(key, group);
}

function suggestedNames(value: string): string[] {
  const base = toKebabCase(value);
  return ['linear', 'minimal', 'acme'].map((suffix) => `${base}-${suffix}`);
}
