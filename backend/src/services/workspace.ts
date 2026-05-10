import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import type {
  BackupManifest,
  BackupMetadata,
  Component,
  ComponentTokenOverride,
  DesignTokenSet,
  Preset,
  RegistrySource,
  Template,
  WorkspaceConfig,
  WorkspaceManifest,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';
import {
  createEmptyTokenMap,
  normalizeDesignTokenMap,
  TOKEN_CATEGORIES,
} from '../utils/validation.js';

const WORKSPACE_DIR = '.shadcn-tweaker';
const MANIFEST_FILE = 'manifest.json';
const LEGACY_CONFIG_FILE = '.shadcn-tweaker.json';
const TEMPLATE_FILE = 'templates/templates.json';
const BACKUP_DIR = 'backups';
const ensuredWorkspaceDirs = new Set<string>();
const manifestWriteQueues = new Map<string, Promise<void>>();

const DEFAULT_CONFIG: WorkspaceConfig = {
  componentDirectory: './components/ui',
  backupRetentionDays: 30,
  maxBackups: 20,
  autoBackup: true,
  validateAfterEdit: true,
  port: 3001,
};

interface LegacyConfig {
  componentsPath?: string;
  maxBackups?: number;
}

interface TemplateStore {
  templates?: Template[];
}

export function getWorkingDirectory(): string {
  return process.env.SHADCN_TWEAKER_CWD || process.cwd();
}

export function getWorkspaceDir(cwd: string = getWorkingDirectory()): string {
  return path.join(cwd, WORKSPACE_DIR);
}

export function getWorkspacePath(...segments: string[]): string {
  return path.join(getWorkspaceDir(), ...segments);
}

export function getManifestPath(cwd: string = getWorkingDirectory()): string {
  return path.join(getWorkspaceDir(cwd), MANIFEST_FILE);
}

function createDefaultManifest(now: string = new Date().toISOString()): WorkspaceManifest {
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    config: { ...DEFAULT_CONFIG },
    components: [],
    sources: [],
    packages: [],
    tokenSets: [],
    componentTokenOverrides: {},
    presets: [],
    backups: [],
  };
}

function normalizeDesignTokenSet(raw: DesignTokenSet): DesignTokenSet {
  const tokenSet = raw as DesignTokenSet & { tokens?: Record<string, unknown> };
  const now = new Date().toISOString();
  const tokens = normalizeDesignTokenMap(tokenSet.tokens, {
    now,
    fallbackCreatedAt: tokenSet.createdAt || now,
    fallbackUpdatedAt: tokenSet.updatedAt || now,
  });

  return {
    id: tokenSet.id,
    name: tokenSet.name,
    description: tokenSet.description,
    tokens: tokens ?? createEmptyTokenMap(),
    createdAt: tokenSet.createdAt,
    updatedAt: tokenSet.updatedAt,
  };
}

function normalizeComponentTokenOverrides(raw: unknown): Record<string, ComponentTokenOverride[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }

  const overrides: Record<string, ComponentTokenOverride[]> = {};

  for (const [componentPath, componentOverrides] of Object.entries(raw)) {
    if (typeof componentPath !== 'string' || !Array.isArray(componentOverrides)) {
      continue;
    }

    const normalized = componentOverrides
      .map((override): ComponentTokenOverride | null => {
        if (typeof override !== 'object' || override === null) {
          return null;
        }

        const candidate = override as Partial<ComponentTokenOverride>;
        if (typeof candidate.tokenSetId !== 'string') {
          return null;
        }

        const normalizedOverrides: ComponentTokenOverride['overrides'] = {};
        const rawOverrides = candidate.overrides;
        if (typeof rawOverrides !== 'object' || rawOverrides === null) {
          return null;
        }

        for (const category of TOKEN_CATEGORIES) {
          const categoryOverrides = rawOverrides[category];
          if (
            !categoryOverrides ||
            typeof categoryOverrides !== 'object' ||
            Array.isArray(categoryOverrides)
          ) {
            continue;
          }

          normalizedOverrides[category] = Object.fromEntries(
            Object.entries(categoryOverrides).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          );
        }

        return {
          componentPath,
          tokenSetId: candidate.tokenSetId,
          overrides: normalizedOverrides,
        };
      })
      .filter((override): override is ComponentTokenOverride => override !== null);

    if (normalized.length > 0) {
      overrides[componentPath] = normalized;
    }
  }

  return overrides;
}

function normalizeManifest(raw: unknown): WorkspaceManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Workspace manifest must be a JSON object');
  }

  const candidate = raw as Partial<WorkspaceManifest>;

  if (candidate.version !== 1) {
    throw new Error('Unsupported workspace manifest version');
  }

  if (!candidate.createdAt || !candidate.updatedAt || !candidate.config) {
    throw new Error('Workspace manifest is missing required fields');
  }

  const config = normalizeWorkspaceConfig(candidate.config);

  return {
    version: 1,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    config,
    components: Array.isArray(candidate.components) ? candidate.components : [],
    sources: Array.isArray(candidate.sources) ? candidate.sources : [],
    packages: Array.isArray(candidate.packages) ? candidate.packages : [],
    tokenSets: Array.isArray(candidate.tokenSets)
      ? candidate.tokenSets.map(normalizeDesignTokenSet)
      : [],
    componentTokenOverrides: normalizeComponentTokenOverrides(candidate.componentTokenOverrides),
    presets: Array.isArray(candidate.presets) ? candidate.presets : [],
    backups: Array.isArray(candidate.backups) ? candidate.backups : [],
  };
}

function normalizeWorkspaceConfig(rawConfig: unknown): WorkspaceConfig {
  if (typeof rawConfig !== 'object' || rawConfig === null) {
    throw new Error('Workspace manifest config must be a JSON object');
  }

  const candidate = rawConfig as Partial<WorkspaceConfig>;
  const config = { ...DEFAULT_CONFIG };

  if (candidate.componentDirectory !== undefined) {
    if (
      typeof candidate.componentDirectory !== 'string' ||
      candidate.componentDirectory.trim().length === 0 ||
      !isSafeProjectRelativePath(candidate.componentDirectory.trim())
    ) {
      throw new Error('Workspace manifest config has an invalid componentDirectory');
    }
    config.componentDirectory = candidate.componentDirectory.trim();
  }

  if (candidate.backupRetentionDays !== undefined) {
    if (
      typeof candidate.backupRetentionDays !== 'number' ||
      !Number.isInteger(candidate.backupRetentionDays) ||
      candidate.backupRetentionDays < 1 ||
      candidate.backupRetentionDays > 365
    ) {
      throw new Error('Workspace manifest config has an invalid backupRetentionDays');
    }
    config.backupRetentionDays = candidate.backupRetentionDays;
  }

  if (candidate.maxBackups !== undefined) {
    if (
      typeof candidate.maxBackups !== 'number' ||
      !Number.isInteger(candidate.maxBackups) ||
      candidate.maxBackups < 1 ||
      candidate.maxBackups > 1000
    ) {
      throw new Error('Workspace manifest config has an invalid maxBackups');
    }
    config.maxBackups = candidate.maxBackups;
  }

  if (candidate.autoBackup !== undefined) {
    if (typeof candidate.autoBackup !== 'boolean') {
      throw new Error('Workspace manifest config has an invalid autoBackup');
    }
    config.autoBackup = candidate.autoBackup;
  }

  if (candidate.validateAfterEdit !== undefined) {
    if (typeof candidate.validateAfterEdit !== 'boolean') {
      throw new Error('Workspace manifest config has an invalid validateAfterEdit');
    }
    config.validateAfterEdit = candidate.validateAfterEdit;
  }

  if (candidate.port !== undefined) {
    if (
      typeof candidate.port !== 'number' ||
      !Number.isInteger(candidate.port) ||
      candidate.port < 1024 ||
      candidate.port > 65535
    ) {
      throw new Error('Workspace manifest config has an invalid port');
    }
    config.port = candidate.port;
  }

  return config;
}

async function readLegacyConfig(cwd: string): Promise<Partial<WorkspaceConfig>> {
  const legacyPath = path.join(cwd, LEGACY_CONFIG_FILE);

  if (!(await fs.pathExists(legacyPath))) {
    return {};
  }

  try {
    const legacy = (await fs.readJson(legacyPath)) as LegacyConfig;
    const config: Partial<WorkspaceConfig> = {};

    if (typeof legacy.componentsPath === 'string') {
      config.componentDirectory = legacy.componentsPath;
    }

    if (typeof legacy.maxBackups === 'number') {
      config.maxBackups = legacy.maxBackups;
    }

    return config;
  } catch (error) {
    logger.warn(`Failed to read legacy config at ${legacyPath}`, error);
    return {};
  }
}

async function readMigratedPresets(cwd: string, existingPresets: Preset[]): Promise<Preset[]> {
  const templatePath = path.join(getWorkspaceDir(cwd), TEMPLATE_FILE);

  if (!(await fs.pathExists(templatePath))) {
    return existingPresets;
  }

  try {
    const store = (await fs.readJson(templatePath)) as TemplateStore;
    const templates = Array.isArray(store.templates) ? store.templates : [];
    const presets = [...existingPresets];

    for (const template of templates) {
      const alreadyMigrated = presets.some(
        (preset) => preset.migratedFromTemplateId === template.id || preset.id === template.id
      );

      if (alreadyMigrated) {
        continue;
      }

      presets.push({
        id: template.id,
        name: template.name,
        created: template.created,
        migratedFromTemplateId: template.id,
        tokenOverrides: [],
        classTransforms: template.rules.map((rule) => ({
          find: rule.find,
          replace: rule.replace,
          isRegex: rule.isRegex,
        })),
        astTransforms: [],
        motionOverrides: [],
        variantRecipes: [],
      });
    }

    return presets;
  } catch (error) {
    logger.warn(`Failed to migrate templates from ${templatePath}`, error);
    return existingPresets;
  }
}

async function deriveBackups(cwd: string): Promise<BackupMetadata[]> {
  const backupBasePath = path.join(getWorkspaceDir(cwd), BACKUP_DIR);

  if (!(await fs.pathExists(backupBasePath))) {
    return [];
  }

  const entries = await fs.readdir(backupBasePath, { withFileTypes: true });
  const backups: BackupMetadata[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('backup_')) {
      continue;
    }

    const manifestPath = path.join(backupBasePath, entry.name, 'manifest.json');

    try {
      if (!(await fs.pathExists(manifestPath))) {
        continue;
      }

      const manifest = (await fs.readJson(manifestPath)) as BackupManifest;
      const sizes = await Promise.all(
        manifest.files.map(async (file) => {
          if (await fs.pathExists(file.backupPath)) {
            const stats = await fs.stat(file.backupPath);
            return stats.size;
          }
          return 0;
        })
      );
      const totalSize = sizes.reduce((sum, size) => sum + size, 0);

      backups.push({
        id: manifest.id,
        timestamp: manifest.timestamp,
        components: manifest.files.map((file) => file.originalPath),
        size: totalSize,
      });
    } catch (error) {
      logger.warn(`Failed to read backup metadata for ${entry.name}`, error);
    }
  }

  backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return backups;
}

function mergeBackups(
  manifestBackups: BackupMetadata[],
  derivedBackups: BackupMetadata[]
): BackupMetadata[] {
  const backupsById = new Map<string, BackupMetadata>();

  for (const backup of manifestBackups) {
    backupsById.set(backup.id, backup);
  }

  for (const backup of derivedBackups) {
    backupsById.set(backup.id, backup);
  }

  return [...backupsById.values()].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

async function ensureWorkspaceDirs(cwd: string): Promise<void> {
  if (ensuredWorkspaceDirs.has(cwd)) {
    return;
  }

  await fs.ensureDir(getWorkspaceDir(cwd));
  await fs.ensureDir(path.join(getWorkspaceDir(cwd), 'templates'));
  await fs.ensureDir(path.join(getWorkspaceDir(cwd), BACKUP_DIR));
  ensuredWorkspaceDirs.add(cwd);
}

async function writeManifest(manifest: WorkspaceManifest, cwd: string): Promise<void> {
  await ensureWorkspaceDirs(cwd);
  const manifestPath = getManifestPath(cwd);
  const manifestDir = path.dirname(manifestPath);
  const tempManifestPath = path.join(manifestDir, `.manifest.${randomUUID()}.tmp`);
  const content = `${JSON.stringify(manifest, null, 2)}\n`;

  try {
    await fs.outputFile(tempManifestPath, content, { flag: 'wx', mode: 0o600 });
    await fs.rename(tempManifestPath, manifestPath);
  } catch (error) {
    await fs.remove(tempManifestPath);
    throw error;
  }
}

async function withManifestWriteLock<T>(cwd: string, operation: () => Promise<T>): Promise<T> {
  // Public load/save helpers acquire this queue. Code already inside the queue must use
  // the Unsafe helpers below so it does not wait on its own pending operation.
  const queueKey = path.resolve(cwd);
  const previous = manifestWriteQueues.get(queueKey) || Promise.resolve();
  let release: () => void = () => {};

  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  manifestWriteQueues.set(queueKey, next);

  await previous;

  try {
    return await operation();
  } finally {
    release();
    if (manifestWriteQueues.get(queueKey) === next) {
      manifestWriteQueues.delete(queueKey);
    }
  }
}

function presetsChanged(next: Preset[], current: Preset[]): boolean {
  if (next.length !== current.length) {
    return true;
  }

  return next.some((preset, index) => {
    const currentPreset = current[index];
    return (
      !currentPreset ||
      preset.id !== currentPreset.id ||
      preset.name !== currentPreset.name ||
      preset.created !== currentPreset.created ||
      preset.migratedFromTemplateId !== currentPreset.migratedFromTemplateId ||
      preset.classTransforms.length !== currentPreset.classTransforms.length
    );
  });
}

function backupsChanged(next: BackupMetadata[], current: BackupMetadata[]): boolean {
  if (next.length !== current.length) {
    return true;
  }

  return next.some((backup, index) => {
    const currentBackup = current[index];
    return (
      !currentBackup ||
      backup.id !== currentBackup.id ||
      backup.timestamp !== currentBackup.timestamp ||
      backup.size !== currentBackup.size ||
      backup.components.length !== currentBackup.components.length
    );
  });
}

async function saveWorkspaceManifestUnsafe(
  manifest: WorkspaceManifest,
  cwd: string
): Promise<WorkspaceManifest> {
  const updated: WorkspaceManifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
  };

  await writeManifest(updated, cwd);
  return updated;
}

async function loadWorkspaceManifestUnsafe(cwd: string): Promise<WorkspaceManifest> {
  await ensureWorkspaceDirs(cwd);

  const manifestPath = getManifestPath(cwd);
  let manifest: WorkspaceManifest;

  if (await fs.pathExists(manifestPath)) {
    try {
      manifest = normalizeManifest(await fs.readJson(manifestPath));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid workspace manifest';
      throw new Error(`Failed to load workspace manifest: ${message}`);
    }
  } else {
    manifest = createDefaultManifest();
    const legacyConfig = await readLegacyConfig(cwd);
    manifest.config = {
      ...manifest.config,
      ...legacyConfig,
    };
    await writeManifest(manifest, cwd);
  }

  const presets = await readMigratedPresets(cwd, manifest.presets);
  const backups =
    manifest.backups.length > 0
      ? manifest.backups
      : mergeBackups(manifest.backups, await deriveBackups(cwd));

  const hydrated: WorkspaceManifest = {
    ...manifest,
    presets,
    backups,
  };

  if (presetsChanged(presets, manifest.presets) || backupsChanged(backups, manifest.backups)) {
    await writeManifest(
      {
        ...hydrated,
        updatedAt: new Date().toISOString(),
      },
      cwd
    );
  }

  return hydrated;
}

export async function saveWorkspaceManifest(
  manifest: WorkspaceManifest,
  cwd: string = getWorkingDirectory()
): Promise<WorkspaceManifest> {
  return withManifestWriteLock(cwd, () => saveWorkspaceManifestUnsafe(manifest, cwd));
}

export async function loadWorkspaceManifest(
  cwd: string = getWorkingDirectory()
): Promise<WorkspaceManifest> {
  return withManifestWriteLock(cwd, () => loadWorkspaceManifestUnsafe(cwd));
}

export async function initializeWorkspace(
  cwd: string = getWorkingDirectory()
): Promise<{ manifest: WorkspaceManifest; created: boolean }> {
  return withManifestWriteLock(cwd, async () => {
    // This created flag is serialized within this process; another process could still
    // create the manifest between the existence check and write.
    const created = !(await fs.pathExists(getManifestPath(cwd)));
    const manifest = await loadWorkspaceManifestUnsafe(cwd);

    return { manifest, created };
  });
}

export async function mutateWorkspaceManifest<T>(
  operation: (manifest: WorkspaceManifest) => Promise<{ manifest: WorkspaceManifest; result: T }>,
  cwd: string = getWorkingDirectory()
): Promise<T> {
  return withManifestWriteLock(cwd, async () => {
    const manifest = await loadWorkspaceManifestUnsafe(cwd);
    const update = await operation(manifest);
    await saveWorkspaceManifestUnsafe(update.manifest, cwd);
    return update.result;
  });
}

export async function updateWorkspaceConfig(
  updates: Partial<WorkspaceConfig>,
  cwd: string = getWorkingDirectory()
): Promise<WorkspaceManifest> {
  return withManifestWriteLock(cwd, async () => {
    const manifest = await loadWorkspaceManifestUnsafe(cwd);
    const allowedKeys = Object.keys(DEFAULT_CONFIG) as Array<keyof WorkspaceConfig>;
    const nextConfig = { ...manifest.config };

    for (const key of allowedKeys) {
      if (updates[key] !== undefined) {
        Object.assign(nextConfig, { [key]: updates[key] });
      }
    }

    return saveWorkspaceManifestUnsafe(
      {
        ...manifest,
        config: nextConfig,
      },
      cwd
    );
  });
}

function createRegistrySourceId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

  return `registry_${slug || randomUUID().slice(0, 8)}`;
}

export async function listRegistrySources(
  cwd: string = getWorkingDirectory()
): Promise<RegistrySource[]> {
  const manifest = await loadWorkspaceManifest(cwd);
  return manifest.sources;
}

export async function upsertRegistrySource(
  source: Omit<RegistrySource, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  cwd: string = getWorkingDirectory()
): Promise<{ source: RegistrySource; created: boolean }> {
  return withManifestWriteLock(cwd, async () => {
    const manifest = await loadWorkspaceManifestUnsafe(cwd);
    const now = new Date().toISOString();
    const id = source.id || createRegistrySourceId(source.name);
    const existing = manifest.sources.find((candidate) => candidate.id === id);
    const created = !existing;
    const nextSource: RegistrySource = {
      id,
      name: source.name,
      type: source.type,
      baseUrl: source.baseUrl,
      registryJsonUrl: source.registryJsonUrl,
      enabled: source.enabled ?? true,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const sources = manifest.sources.filter((candidate) => candidate.id !== id);

    sources.push(nextSource);

    await saveWorkspaceManifestUnsafe(
      {
        ...manifest,
        sources: sources.sort((a, b) => a.name.localeCompare(b.name)),
      },
      cwd
    );

    return { source: nextSource, created };
  });
}

export async function deleteRegistrySource(
  id: string,
  cwd: string = getWorkingDirectory()
): Promise<boolean> {
  return withManifestWriteLock(cwd, async () => {
    const manifest = await loadWorkspaceManifestUnsafe(cwd);
    const sources = manifest.sources.filter((source) => source.id !== id);

    if (sources.length === manifest.sources.length) {
      return false;
    }

    await saveWorkspaceManifestUnsafe(
      {
        ...manifest,
        sources,
      },
      cwd
    );

    return true;
  });
}

export async function recordBackupMetadata(
  backup: BackupMetadata,
  cwd: string = getWorkingDirectory()
): Promise<void> {
  try {
    await withManifestWriteLock(cwd, async () => {
      const manifest = await loadWorkspaceManifestUnsafe(cwd);
      const backups = manifest.backups.filter((existing) => existing.id !== backup.id);

      backups.unshift(backup);

      await saveWorkspaceManifestUnsafe(
        {
          ...manifest,
          backups,
        },
        cwd
      );
    });
  } catch (error) {
    logger.warn(`Failed to record backup metadata for ${backup.id}`, error);
  }
}

export async function recordScannedComponents(
  components: Component[],
  cwd: string = getWorkingDirectory()
): Promise<void> {
  try {
    await withManifestWriteLock(cwd, async () => {
      const manifest = await loadWorkspaceManifestUnsafe(cwd);
      const scannedAt = new Date().toISOString();
      const componentsByPath = new Map(
        manifest.components.map((component) => [component.path, component])
      );

      for (const component of components) {
        componentsByPath.set(component.path, {
          id: component.name,
          name: component.name,
          path: component.path,
          lastScannedAt: scannedAt,
          metadata: component.metadata,
        });
      }

      await saveWorkspaceManifestUnsafe(
        {
          ...manifest,
          components: [...componentsByPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
        },
        cwd
      );
    });
  } catch (error) {
    logger.warn('Failed to record scanned components in workspace manifest', error);
  }
}
