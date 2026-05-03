import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import type {
  BackupManifest,
  BackupMetadata,
  Component,
  Preset,
  RegistrySource,
  Template,
  WorkspaceConfig,
  WorkspaceManifest,
} from '../types/index.js';
import { logger } from '../utils/logger.js';

const WORKSPACE_DIR = '.shadcn-tweaker';
const MANIFEST_FILE = 'manifest.json';
const LEGACY_CONFIG_FILE = '.shadcn-tweaker.json';
const TEMPLATE_FILE = 'templates/templates.json';
const BACKUP_DIR = 'backups';

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
    presets: [],
    backups: [],
  };
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

  return {
    version: 1,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    config: {
      ...DEFAULT_CONFIG,
      ...candidate.config,
    },
    components: Array.isArray(candidate.components) ? candidate.components : [],
    sources: Array.isArray(candidate.sources) ? candidate.sources : [],
    packages: Array.isArray(candidate.packages) ? candidate.packages : [],
    tokenSets: Array.isArray(candidate.tokenSets) ? candidate.tokenSets : [],
    presets: Array.isArray(candidate.presets) ? candidate.presets : [],
    backups: Array.isArray(candidate.backups) ? candidate.backups : [],
  };
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
      let totalSize = 0;

      for (const file of manifest.files) {
        if (await fs.pathExists(file.backupPath)) {
          const stats = await fs.stat(file.backupPath);
          totalSize += stats.size;
        }
      }

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
  await fs.ensureDir(getWorkspaceDir(cwd));
  await fs.ensureDir(path.join(getWorkspaceDir(cwd), 'templates'));
  await fs.ensureDir(path.join(getWorkspaceDir(cwd), BACKUP_DIR));
}

async function writeManifest(manifest: WorkspaceManifest, cwd: string): Promise<void> {
  await ensureWorkspaceDirs(cwd);
  await fs.writeJson(getManifestPath(cwd), manifest, { spaces: 2 });
}

export async function saveWorkspaceManifest(
  manifest: WorkspaceManifest,
  cwd: string = getWorkingDirectory()
): Promise<WorkspaceManifest> {
  const updated: WorkspaceManifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
  };

  await writeManifest(updated, cwd);
  return updated;
}

export async function loadWorkspaceManifest(
  cwd: string = getWorkingDirectory()
): Promise<WorkspaceManifest> {
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
    await writeManifest(manifest, cwd);
  }

  const legacyConfig = await readLegacyConfig(cwd);
  const presets = await readMigratedPresets(cwd, manifest.presets);
  const backups = mergeBackups(manifest.backups, await deriveBackups(cwd));

  const hydrated: WorkspaceManifest = {
    ...manifest,
    config: {
      ...manifest.config,
      ...legacyConfig,
    },
    presets,
    backups,
  };

  if (
    presets.length !== manifest.presets.length ||
    backups.length !== manifest.backups.length ||
    JSON.stringify(backups) !== JSON.stringify(manifest.backups)
  ) {
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

export async function initializeWorkspace(
  cwd: string = getWorkingDirectory()
): Promise<WorkspaceManifest> {
  return loadWorkspaceManifest(cwd);
}

export async function updateWorkspaceConfig(
  updates: Partial<WorkspaceConfig>,
  cwd: string = getWorkingDirectory()
): Promise<WorkspaceManifest> {
  const manifest = await loadWorkspaceManifest(cwd);
  const allowedKeys: Array<keyof WorkspaceConfig> = [
    'componentDirectory',
    'backupRetentionDays',
    'maxBackups',
    'autoBackup',
    'validateAfterEdit',
    'port',
  ];
  const nextConfig = { ...manifest.config };

  for (const key of allowedKeys) {
    if (updates[key] !== undefined) {
      nextConfig[key] = updates[key] as never;
    }
  }

  return saveWorkspaceManifest(
    {
      ...manifest,
      config: nextConfig,
    },
    cwd
  );
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
): Promise<RegistrySource> {
  const manifest = await loadWorkspaceManifest(cwd);
  const now = new Date().toISOString();
  const id = source.id || createRegistrySourceId(source.name);
  const existing = manifest.sources.find((candidate) => candidate.id === id);
  const nextSource: RegistrySource = {
    id,
    name: source.name,
    type: source.type,
    baseUrl: source.baseUrl,
    registryJsonUrl: source.registryJsonUrl,
    enabled: source.enabled,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const sources = manifest.sources.filter((candidate) => candidate.id !== id);

  sources.push(nextSource);

  await saveWorkspaceManifest(
    {
      ...manifest,
      sources: sources.sort((a, b) => a.name.localeCompare(b.name)),
    },
    cwd
  );

  return nextSource;
}

export async function deleteRegistrySource(
  id: string,
  cwd: string = getWorkingDirectory()
): Promise<boolean> {
  const manifest = await loadWorkspaceManifest(cwd);
  const sources = manifest.sources.filter((source) => source.id !== id);

  if (sources.length === manifest.sources.length) {
    return false;
  }

  await saveWorkspaceManifest(
    {
      ...manifest,
      sources,
    },
    cwd
  );

  return true;
}

export async function recordBackupMetadata(
  backup: BackupMetadata,
  cwd: string = getWorkingDirectory()
): Promise<void> {
  try {
    const manifest = await loadWorkspaceManifest(cwd);
    const backups = manifest.backups.filter((existing) => existing.id !== backup.id);

    backups.unshift(backup);

    await saveWorkspaceManifest(
      {
        ...manifest,
        backups,
      },
      cwd
    );
  } catch (error) {
    logger.warn(`Failed to record backup metadata for ${backup.id}`, error);
  }
}

export async function recordScannedComponents(
  components: Component[],
  cwd: string = getWorkingDirectory()
): Promise<void> {
  try {
    const manifest = await loadWorkspaceManifest(cwd);
    const scannedAt = new Date().toISOString();

    await saveWorkspaceManifest(
      {
        ...manifest,
        components: components.map((component) => ({
          id: component.name,
          name: component.name,
          path: component.path,
          lastScannedAt: scannedAt,
          metadata: component.metadata,
        })),
      },
      cwd
    );
  } catch (error) {
    logger.warn('Failed to record scanned components in workspace manifest', error);
  }
}
