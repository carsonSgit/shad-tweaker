import { open } from 'node:fs/promises';
import path from 'node:path';
import { createPatch } from 'diff';
import fs from 'fs-extra';
import type {
  ComponentLibraryActionResult,
  ComponentLibraryCompareResult,
  ComponentLibraryDetail,
  ComponentLibraryDuplicate,
  ComponentLibraryInventoryItem,
  RegistryDependency,
  WorkspaceComponent,
} from '../types/index.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';
import { parseComponentSource } from './parser.js';
import { findComponentDirectory } from './scanner.js';
import { loadWorkspaceManifest, saveWorkspaceManifest } from './workspace.js';

const SUPPORTED_COMPONENT_EXTENSIONS = new Set(['.tsx', '.jsx']);
const TOKEN_PATTERN = /\b(?:bg|text|border|ring|shadow|fill|stroke|from|via|to)-[a-z0-9-:/[\].%]+/g;
const PRIMITIVE_PATTERNS = [
  { pattern: /@radix-ui\/react-([a-z0-9-]+)/, label: 'radix' },
  { pattern: /@base-ui-components\/react\/([a-z0-9-]+)/, label: 'base-ui' },
  { pattern: /@headlessui\/react/, label: 'headless-ui' },
];
const SHARED_DEPENDENCIES = new Set(['class-variance-authority', 'clsx', 'tailwind-merge']);

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

interface WorkspaceContext {
  componentDirectory: string;
  manifestComponents: WorkspaceComponent[];
}

function toComponentName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function toKebabCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])|([A-Z]+)([A-Z][a-z])/g, (_match, lower, upper, acronym, word) =>
      lower ? `${lower}-${upper}` : `${acronym}-${word}`
    )
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

async function getWorkspaceContext(cwd: string): Promise<WorkspaceContext> {
  const manifest = await loadWorkspaceManifest(cwd);
  const configured = manifest.config.componentDirectory;
  const found = await findComponentDirectory(cwd, configured);
  if (found) {
    return {
      componentDirectory: found,
      manifestComponents: manifest.components,
    };
  }

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
  const { componentDirectory, manifestComponents } = await getWorkspaceContext(cwd);
  const entries = await fs.readdir(componentDirectory);
  const files: ComponentFile[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(componentDirectory, entry);
    if (!SUPPORTED_COMPONENT_EXTENSIONS.has(path.extname(entry))) continue;

    const handle = await open(absolutePath, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) continue;

      const relativePath = path.relative(cwd, absolutePath).replace(/\\/g, '/');
      files.push({
        absolutePath,
        relativePath,
        content: await handle.readFile('utf-8'),
        stats,
        manifestComponent: matchManifestComponent(manifestComponents, relativePath, absolutePath),
      });
    } finally {
      await handle.close();
    }
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

function getDependencies(
  content: string,
  manifestComponent?: WorkspaceComponent
): RegistryDependency[] {
  const dependencies = manifestComponent?.source?.dependencies ?? [];
  const packageImports = [...content.matchAll(/from\s+['"]([^.'"][^'"]*)['"]/g)].map(
    (match) => match[1]
  );
  const parsedDependencies = packageImports.filter(isPackageImport).map((name) => ({
    name,
    type: 'package' as const,
  }));
  return [...dependencies, ...parsedDependencies].filter(
    (dependency, index, all) => all.findIndex((item) => item.name === dependency.name) === index
  );
}

function isPackageImport(value: string): boolean {
  return (
    !value.startsWith('@/') &&
    !value.startsWith('~/') &&
    !value.startsWith('node:') &&
    !SHARED_DEPENDENCIES.has(value)
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
  return toDetail(await resolveDetailFile(cwd, identifier));
}

export async function findComponentLibraryDuplicates(
  cwd: string
): Promise<ComponentLibraryDuplicate[]> {
  const files = await readComponentFiles(cwd);
  const details = files.map(toDetail);
  const groups = new Map<string, { type: ComponentLibraryDuplicate['type']; paths: string[] }>();

  for (const detail of details) {
    addDuplicateCandidate(groups, 'name', detail.name, detail.path);
    for (const exportName of detail.exports)
      addDuplicateCandidate(groups, 'export', exportName, detail.path);
    for (const dependency of detail.dependencies) {
      addDuplicateCandidate(groups, 'dependency', dependency.name, detail.path);
    }
  }

  return [...groups.entries()]
    .filter(([, group]) => group.paths.length > 1)
    .map(([key, group]) => ({
      type: group.type,
      value: key.slice(group.type.length + 1),
      componentPaths: group.paths,
      suggestedNames: suggestedNames(key.slice(group.type.length + 1)),
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

async function resolveDetailFile(cwd: string, identifier: string): Promise<ComponentFile> {
  const files = await readComponentFiles(cwd);
  if (!isSafeProjectRelativePath(identifier)) {
    throw new ComponentLibraryValidationError('Component identifier must stay inside the project.');
  }
  const normalized = identifier.replace(/\\/g, '/').replace(/^\.\//, '');
  const file = files.find(
    (candidate) =>
      candidate.relativePath === normalized ||
      toComponentName(candidate.relativePath) === identifier ||
      candidate.manifestComponent?.name === identifier
  );
  if (!file) throw new ComponentLibraryNotFoundError('Component not found.');
  return file;
}

export async function renameComponentLibraryItem(
  cwd: string,
  identifier: string,
  newName: string
): Promise<ComponentLibraryActionResult> {
  const file = await resolveDetailFile(cwd, identifier);
  const normalizedName = normalizeComponentName(newName);
  const newRelativePath = path
    .join(path.dirname(file.relativePath), `${normalizedName}${path.extname(file.relativePath)}`)
    .replace(/\\/g, '/');
  const newAbsolutePath = path.join(cwd, ensureSafeRelativePath(newRelativePath));

  if ((await fs.pathExists(newAbsolutePath)) && newAbsolutePath !== file.absolutePath) {
    throw new ComponentLibraryConflictError(`Component already exists: ${newRelativePath}`);
  }

  await updateManifestComponentPath(cwd, file.relativePath, newRelativePath, normalizedName);
  try {
    await fs.move(file.absolutePath, newAbsolutePath, { overwrite: false });
  } catch (error) {
    await updateManifestComponentPath(
      cwd,
      newRelativePath,
      file.relativePath,
      toComponentName(file.relativePath)
    );
    throw error;
  }

  return {
    success: true,
    component: await getComponentLibraryDetail(cwd, newRelativePath),
    previousPath: file.relativePath,
    newPath: newRelativePath,
  };
}

export async function forkComponentLibraryItem(
  cwd: string,
  identifier: string,
  newName: string
): Promise<ComponentLibraryActionResult> {
  const file = await resolveDetailFile(cwd, identifier);
  const normalizedName = normalizeComponentName(newName);
  const newRelativePath = path
    .join(path.dirname(file.relativePath), `${normalizedName}${path.extname(file.relativePath)}`)
    .replace(/\\/g, '/');
  const newAbsolutePath = path.join(cwd, ensureSafeRelativePath(newRelativePath));

  if (await fs.pathExists(newAbsolutePath)) {
    throw new ComponentLibraryConflictError(`Component already exists: ${newRelativePath}`);
  }

  await fs.copyFile(file.absolutePath, newAbsolutePath);
  await addForkedManifestComponent(cwd, file, newRelativePath, normalizedName);

  return {
    success: true,
    component: await getComponentLibraryDetail(cwd, newRelativePath),
    previousPath: file.relativePath,
    newPath: newRelativePath,
  };
}

export async function detachComponentLibraryItem(
  cwd: string,
  identifier: string
): Promise<ComponentLibraryActionResult> {
  const file = await resolveDetailFile(cwd, identifier);
  const manifest = await loadWorkspaceManifest(cwd);
  manifest.components = manifest.components.map((component) => {
    if (component.path.replace(/\\/g, '/') !== file.relativePath) return component;
    const { source: _source, ...detached } = component;
    return detached;
  });
  await saveWorkspaceManifest(manifest, cwd);

  return {
    success: true,
    component: await getComponentLibraryDetail(cwd, file.relativePath),
    previousPath: file.relativePath,
  };
}

export async function resetComponentLibraryItem(
  cwd: string,
  identifier: string
): Promise<ComponentLibraryActionResult> {
  const file = await resolveDetailFile(cwd, identifier);
  const sourcePath = file.manifestComponent?.source?.originalPackageName;
  if (!sourcePath || !isSafeProjectRelativePath(sourcePath)) {
    throw new ComponentLibraryValidationError('Component does not have a reset source path.');
  }

  const absoluteSourcePath = path.join(cwd, sourcePath);
  if (!(await fs.pathExists(absoluteSourcePath))) {
    throw new ComponentLibraryNotFoundError(`Reset source not found: ${sourcePath}`);
  }

  await fs.copyFile(absoluteSourcePath, file.absolutePath);

  return {
    success: true,
    component: await getComponentLibraryDetail(cwd, file.relativePath),
    previousPath: file.relativePath,
  };
}

export async function compareComponentLibraryItem(
  cwd: string,
  identifier: string
): Promise<ComponentLibraryCompareResult> {
  const file = await resolveDetailFile(cwd, identifier);
  const sourcePath = file.manifestComponent?.source?.originalPackageName;
  if (!sourcePath || !isSafeProjectRelativePath(sourcePath)) {
    return {
      name: toComponentName(file.relativePath),
      path: file.relativePath,
      changed: true,
      diff: createPatch(file.relativePath, '', file.content, 'source', 'local'),
      localContent: file.content,
      sourceContent: '',
    };
  }

  const absoluteSourcePath = path.join(cwd, sourcePath);
  const sourceContent = (await fs.pathExists(absoluteSourcePath))
    ? await fs.readFile(absoluteSourcePath, 'utf-8')
    : '';

  return {
    name: toComponentName(file.relativePath),
    path: file.relativePath,
    sourcePath,
    changed: sourceContent !== file.content,
    diff:
      sourceContent === file.content
        ? ''
        : createPatch(file.relativePath, sourceContent, file.content, 'source', 'local'),
    localContent: file.content,
    sourceContent,
  };
}

async function addForkedManifestComponent(
  cwd: string,
  file: ComponentFile,
  newPath: string,
  newName: string
): Promise<void> {
  if (!file.manifestComponent) return;

  const manifest = await loadWorkspaceManifest(cwd);
  manifest.components = [
    ...manifest.components,
    {
      ...file.manifestComponent,
      id: newName,
      name: newName,
      path: newPath,
      source: file.manifestComponent.source
        ? {
            ...file.manifestComponent.source,
            localComponentName: newName,
          }
        : undefined,
    },
  ];
  await saveWorkspaceManifest(manifest, cwd);
}

async function updateManifestComponentPath(
  cwd: string,
  previousPath: string,
  newPath: string,
  newName: string
): Promise<void> {
  const manifest = await loadWorkspaceManifest(cwd);
  manifest.components = manifest.components.map((component) => {
    if (component.path.replace(/\\/g, '/') !== previousPath) return component;
    return {
      ...component,
      id: newName,
      name: newName,
      path: newPath,
      source: component.source
        ? {
            ...component.source,
            localComponentName: newName,
          }
        : undefined,
    };
  });
  await saveWorkspaceManifest(manifest, cwd);
}
