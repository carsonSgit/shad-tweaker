import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import type {
  ApplyImportPlanRequest,
  ApplyImportPlanResult,
  ComponentPackage,
  ImportConflict,
  ImportConflictResolution,
  ImportPlan,
  ImportPlanRequest,
  PlannedFile,
  RegistryItemFile,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';
import { createBackup, restoreBackup } from './backup.js';
import { findRegistryItem, getRegistryItem } from './registry.js';
import { getWorkingDirectory, loadWorkspaceManifest } from './workspace.js';

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface TsConfig {
  compilerOptions?: {
    paths?: Record<string, unknown>;
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function planId(item: ComponentPackage): string {
  return `${item.id}:${randomUUID()}`;
}

function normalizeRegistryPath(filePath: string): string | null {
  const trimmed = filePath.trim().replace(/\\/g, '/');
  if (!trimmed || !isSafeProjectRelativePath(trimmed)) return null;
  return trimmed.replace(/^\.?\//, '');
}

function resolveTargetPath(cwd: string, componentDirectory: string, registryPath: string): string {
  const normalized = normalizeRegistryPath(registryPath);
  if (!normalized) return '';

  const withoutLeadingUi = normalized.startsWith('ui/') ? normalized.slice(3) : normalized;
  return path.resolve(cwd, componentDirectory, withoutLeadingUi);
}

function toPlannedFile(
  cwd: string,
  componentDirectory: string,
  file: RegistryItemFile
): PlannedFile {
  return {
    sourcePath: file.path,
    targetPath: resolveTargetPath(cwd, componentDirectory, file.path),
    content: file.content ?? '',
  };
}

async function readPackageManifest(cwd: string): Promise<PackageManifest> {
  const manifestPath = path.join(cwd, 'package.json');
  if (!(await fs.pathExists(manifestPath))) return {};
  return fs.readJson(manifestPath) as Promise<PackageManifest>;
}

function dependencyDeltas(
  item: ComponentPackage,
  packageManifest: PackageManifest,
  dependencyType: 'dependencies' | 'devDependencies'
): string[] {
  const installed = {
    ...packageManifest.dependencies,
    ...packageManifest.devDependencies,
  };
  const sourceDeps =
    dependencyType === 'dependencies' ? item.dependencies : (item.devDependencies ?? []);
  const packageDeps = sourceDeps
    .filter((dependency) => dependency.type === 'package')
    .map((dependency) => dependency.name);

  return uniqueSorted(packageDeps.filter((dependency) => installed[dependency] === undefined));
}

async function detectAliases(cwd: string, files: PlannedFile[]): Promise<string[]> {
  const aliases = new Set<string>();
  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  const tsconfig = (await fs.pathExists(tsconfigPath))
    ? ((await fs.readJson(tsconfigPath)) as TsConfig)
    : {};
  const paths = tsconfig.compilerOptions?.paths ?? {};
  const hasAtAlias = Object.hasOwn(paths, '@/*');

  for (const file of files) {
    const matches = file.content.matchAll(
      /from\s+['"](@\/[^'"]+)['"]|import\(['"](@\/[^'"]+)['"]\)/g
    );
    for (const match of matches) {
      const alias = match[1] ?? match[2];
      if (!hasAtAlias) {
        aliases.add(alias.split('/').slice(0, 2).join('/'));
      }
    }
  }

  return uniqueSorted([...aliases]);
}

function validatePlannedFile(cwd: string, file: PlannedFile): ImportConflict | null {
  const sourcePath = normalizeRegistryPath(file.sourcePath);
  if (!sourcePath || !file.targetPath.startsWith(path.resolve(cwd) + path.sep)) {
    return {
      path: file.sourcePath,
      type: 'unsafe-path',
      message: 'Registry file path must stay inside the project.',
    };
  }

  if (file.content.length === 0) {
    return {
      path: file.sourcePath,
      type: 'missing-content',
      message: 'Registry file is missing content and cannot be applied safely.',
    };
  }

  return null;
}

async function resolveRegistryItem(
  request: ImportPlanRequest,
  cwd: string
): Promise<ComponentPackage> {
  const item = request.sourceId
    ? await getRegistryItem(request.sourceId, request.itemName, cwd)
    : await findRegistryItem(request.itemName, cwd);

  if (!item) {
    throw new Error(
      `Registry item not found: ${request.sourceId ? `${request.sourceId}/` : ''}${request.itemName}`
    );
  }

  return item;
}

async function resolveRegistryDependency(
  dependencyName: string,
  preferredSourceId: string | undefined,
  cwd: string
): Promise<ComponentPackage | null> {
  if (preferredSourceId) {
    const item = await getRegistryItem(preferredSourceId, dependencyName, cwd);
    if (item) return item;
  }

  return findRegistryItem(dependencyName, cwd);
}

async function collectRegistryItems(
  rootItem: ComponentPackage,
  preferredSourceId: string | undefined,
  cwd: string
): Promise<ComponentPackage[]> {
  const itemsById = new Map<string, ComponentPackage>();
  const queue: ComponentPackage[] = [rootItem];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || itemsById.has(item.id)) continue;

    itemsById.set(item.id, item);
    const sourceId = item.id.includes(':') ? item.id.split(':')[0] : preferredSourceId;

    for (const dependency of item.registryDependencies) {
      const dependencyItem = await resolveRegistryDependency(dependency.name, sourceId, cwd);
      if (dependencyItem && !itemsById.has(dependencyItem.id)) {
        queue.push(dependencyItem);
      }
    }
  }

  return [...itemsById.values()];
}

export async function generateImportPlan(
  request: ImportPlanRequest,
  cwd: string = getWorkingDirectory()
): Promise<ImportPlan> {
  const manifest = await loadWorkspaceManifest(cwd);
  const item = await resolveRegistryItem(request, cwd);
  const items = await collectRegistryItems(item, request.sourceId, cwd);
  const packageManifest = await readPackageManifest(cwd);
  const registryFiles = items.flatMap(
    (registryItem) =>
      registryItem.registryFiles ?? registryItem.files.map((filePath) => ({ path: filePath }))
  );
  const plannedFiles = registryFiles.map((file) =>
    toPlannedFile(cwd, manifest.config.componentDirectory, file)
  );
  const filesToAdd: PlannedFile[] = [];
  const filesToOverwrite: PlannedFile[] = [];
  const conflicts: ImportConflict[] = [];

  for (const file of plannedFiles) {
    const validationConflict = validatePlannedFile(cwd, file);
    if (validationConflict) {
      conflicts.push(validationConflict);
      continue;
    }

    if (await fs.pathExists(file.targetPath)) {
      filesToOverwrite.push(file);
      conflicts.push({
        path: file.targetPath,
        type: 'file-exists',
        message: 'Target file already exists and requires an import decision.',
      });
    } else {
      filesToAdd.push(file);
    }
  }

  return {
    id: planId(item),
    itemName: item.name,
    sourceId: request.sourceId,
    filesToAdd,
    filesToOverwrite,
    dependencies: uniqueSorted(
      items.flatMap((registryItem) =>
        dependencyDeltas(registryItem, packageManifest, 'dependencies')
      )
    ),
    devDependencies: uniqueSorted(
      items.flatMap((registryItem) =>
        dependencyDeltas(registryItem, packageManifest, 'devDependencies')
      )
    ),
    registryDependencies: uniqueSorted(
      items.flatMap((registryItem) =>
        registryItem.registryDependencies.map((dependency) => dependency.name)
      )
    ),
    aliasesNeeded: await detectAliases(cwd, plannedFiles),
    conflicts,
    backupPaths: filesToOverwrite.map((file) => path.relative(cwd, file.targetPath)),
  };
}

function resolutionFor(
  file: PlannedFile,
  resolutions: ImportConflictResolution[]
): ImportConflictResolution {
  return (
    resolutions.find(
      (resolution) => resolution.path === file.targetPath || resolution.path === file.sourcePath
    ) ?? { path: file.targetPath, action: 'overwrite' }
  );
}

function targetForResolution(
  cwd: string,
  file: PlannedFile,
  resolution: ImportConflictResolution
): string {
  if ((resolution.action === 'rename' || resolution.action === 'fork') && resolution.targetPath) {
    return path.resolve(cwd, resolution.targetPath);
  }
  return file.targetPath;
}

async function writePlannedFile(file: PlannedFile, targetPath: string): Promise<void> {
  await fs.ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, file.content, 'utf-8');
}

export async function applyImportPlan(
  request: ApplyImportPlanRequest,
  cwd: string = getWorkingDirectory()
): Promise<ApplyImportPlanResult> {
  const resolutions = request.resolutions ?? [];
  const added: string[] = [];
  const overwritten: string[] = [];
  const skipped: string[] = [];
  let backupId: string | undefined;

  const filesToWrite: Array<{
    file: PlannedFile;
    targetPath: string;
    overwrites: boolean;
    removeOriginalPath?: string;
  }> = [];

  for (const file of request.plan.filesToAdd) {
    filesToWrite.push({ file, targetPath: file.targetPath, overwrites: false });
  }

  for (const file of request.plan.filesToOverwrite) {
    const resolution = resolutionFor(file, resolutions);
    if (resolution.action === 'skip') {
      skipped.push(file.targetPath);
      continue;
    }

    const targetPath = targetForResolution(cwd, file, resolution);
    filesToWrite.push({
      file,
      targetPath,
      overwrites: resolution.action === 'overwrite',
      removeOriginalPath: resolution.action === 'rename' ? file.targetPath : undefined,
    });
  }

  const backupPaths = uniqueSorted(
    filesToWrite
      .flatMap((entry) => [
        entry.overwrites ? entry.targetPath : '',
        entry.removeOriginalPath ?? '',
      ])
      .filter((targetPath) => fs.existsSync(targetPath))
  );

  if (backupPaths.length > 0) {
    const backup = await createBackup(backupPaths);
    backupId = backup.id;
  }

  try {
    for (const entry of filesToWrite) {
      if (!entry.targetPath.startsWith(path.resolve(cwd) + path.sep)) {
        throw new Error(`Refusing to write outside project: ${entry.targetPath}`);
      }

      await writePlannedFile(entry.file, entry.targetPath);
      if (entry.removeOriginalPath && entry.removeOriginalPath !== entry.targetPath) {
        await fs.remove(entry.removeOriginalPath);
      }
      if (entry.overwrites) {
        overwritten.push(entry.targetPath);
      } else {
        added.push(entry.targetPath);
      }
    }
  } catch (error) {
    try {
      await Promise.all(added.map((targetPath) => fs.remove(targetPath)));
    } catch (cleanupError) {
      logger.warn('Failed to clean up partially imported files', cleanupError);
    }
    let rolledBack = false;
    let rollbackMessage = '';
    if (backupId) {
      try {
        await restoreBackup(backupId);
        rolledBack = true;
      } catch (rollbackError) {
        const message =
          rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error';
        rollbackMessage = ` Rollback failed: ${message}.`;
      }
    }
    const message = error instanceof Error ? error.message : 'Failed to apply import plan';
    throw new Error(`${message}${rolledBack ? ' Rolled back from backup.' : ''}${rollbackMessage}`);
  }

  return {
    success: true,
    added,
    overwritten,
    skipped,
    backupId,
    rolledBack: false,
  };
}
