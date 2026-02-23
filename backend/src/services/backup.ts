import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import type { Backup, BackupManifest } from '../types/index.js';
import { logger } from '../utils/logger.js';

const BACKUP_DIR = '.shadcn-tweaker/backups';

function getWorkingDirectory(): string {
  return process.env.SHADCN_TWEAKER_CWD || process.cwd();
}

function getBackupBasePath(): string {
  return path.join(getWorkingDirectory(), BACKUP_DIR);
}

function generateBackupId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `backup_${timestamp}_${suffix}`;
}

function getRelativeBackupPath(filePath: string): string {
  const relative = path.relative(getWorkingDirectory(), path.resolve(filePath));
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid file path for backup');
  }

  return relative;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const content = await fs.readFile(filePath);
  hash.update(content);
  return hash.digest('hex');
}

export async function createBackup(componentPaths: string[]): Promise<Backup> {
  const backupId = generateBackupId();
  const backupPath = path.join(getBackupBasePath(), backupId);

  await fs.ensureDir(backupPath);

  const manifest: BackupManifest = {
    id: backupId,
    timestamp: new Date().toISOString(),
    files: [],
  };

  let totalSize = 0;

  for (const componentPath of componentPaths) {
    try {
      const relativePath = getRelativeBackupPath(componentPath);
      const destPath = path.join(backupPath, relativePath);

      await fs.ensureDir(path.dirname(destPath));

      await fs.copy(componentPath, destPath);
      const sha256 = await hashFile(destPath);

      const stats = await fs.stat(destPath);
      totalSize += stats.size;

      manifest.files.push({
        originalPath: componentPath,
        backupPath: destPath,
        relativePath,
        sha256,
      });
    } catch (error) {
      logger.error(`Failed to backup ${componentPath}`, error);
      throw error;
    }
  }

  const manifestPath = path.join(backupPath, 'manifest.json');
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  logger.info(`Created backup ${backupId} with ${componentPaths.length} files`);

  // Cleanup old backups asynchronously (don't block the response)
  cleanupOldBackups().catch((err) => {
    logger.warn('Failed to cleanup old backups', err);
  });

  return {
    id: backupId,
    timestamp: manifest.timestamp,
    components: componentPaths,
    size: totalSize,
  };
}

export async function listBackups(): Promise<Backup[]> {
  const basePath = getBackupBasePath();

  if (!(await fs.pathExists(basePath))) {
    return [];
  }

  const entries = await fs.readdir(basePath, { withFileTypes: true });
  const backups: Backup[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('backup_')) continue;

    const backupPath = path.join(basePath, entry.name);
    const manifestPath = path.join(backupPath, 'manifest.json');

    try {
      if (await fs.pathExists(manifestPath)) {
        const manifest: BackupManifest = await fs.readJson(manifestPath);

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
          components: manifest.files.map((f) => f.originalPath),
          size: totalSize,
        });
      }
    } catch (error) {
      logger.warn(`Failed to read backup manifest for ${entry.name}`, error);
    }
  }

  backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return backups;
}

export async function restoreBackup(
  backupId: string
): Promise<{ success: boolean; restored: string[]; count: number }> {
  const backupPath = path.join(getBackupBasePath(), backupId);
  const manifestPath = path.join(backupPath, 'manifest.json');

  if (!(await fs.pathExists(manifestPath))) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  const manifest: BackupManifest = await fs.readJson(manifestPath);
  const restored: string[] = [];

  for (const file of manifest.files) {
    try {
      if (await fs.pathExists(file.backupPath)) {
        if (file.sha256) {
          const backupHash = await hashFile(file.backupPath);
          if (backupHash !== file.sha256) {
            throw new Error(`Backup integrity check failed for ${file.originalPath}`);
          }
        }

        await fs.ensureDir(path.dirname(file.originalPath));
        await fs.copy(file.backupPath, file.originalPath, { overwrite: true });
        restored.push(file.originalPath);
        logger.info(`Restored ${file.originalPath} from backup`);
      }
    } catch (error) {
      logger.error(`Failed to restore ${file.originalPath}`, error);
      throw error;
    }
  }

  return {
    success: true,
    restored,
    count: restored.length,
  };
}

export async function deleteBackup(backupId: string): Promise<boolean> {
  const backupPath = path.join(getBackupBasePath(), backupId);

  if (!(await fs.pathExists(backupPath))) {
    return false;
  }

  await fs.remove(backupPath);
  logger.info(`Deleted backup ${backupId}`);
  return true;
}

export async function getBackupDetails(backupId: string): Promise<BackupManifest | null> {
  const manifestPath = path.join(getBackupBasePath(), backupId, 'manifest.json');

  if (!(await fs.pathExists(manifestPath))) {
    return null;
  }

  return fs.readJson(manifestPath);
}

// Default max backups to keep
const DEFAULT_MAX_BACKUPS = 20;

export async function cleanupOldBackups(maxBackups: number = DEFAULT_MAX_BACKUPS): Promise<number> {
  const backups = await listBackups();

  if (backups.length <= maxBackups) {
    return 0;
  }

  const toDelete = backups.slice(maxBackups);
  let deleted = 0;

  for (const backup of toDelete) {
    if (await deleteBackup(backup.id)) {
      deleted++;
    }
  }

  if (deleted > 0) {
    logger.info(`Cleaned up ${deleted} old backups`);
  }

  return deleted;
}

export interface BackupPreview {
  path: string;
  fileName: string;
  currentContent: string;
  backupContent: string;
  hasChanges: boolean;
}

export async function previewBackupRestore(backupId: string): Promise<BackupPreview[]> {
  const backupPath = path.join(getBackupBasePath(), backupId);
  const manifestPath = path.join(backupPath, 'manifest.json');

  if (!(await fs.pathExists(manifestPath))) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  const manifest: BackupManifest = await fs.readJson(manifestPath);
  const previews: BackupPreview[] = [];

  for (const file of manifest.files) {
    try {
      const backupContent = (await fs.pathExists(file.backupPath))
        ? await fs.readFile(file.backupPath, 'utf-8')
        : '';

      const currentContent = (await fs.pathExists(file.originalPath))
        ? await fs.readFile(file.originalPath, 'utf-8')
        : '';

      const hasChanges = currentContent !== backupContent;

      previews.push({
        path: file.originalPath,
        fileName: path.basename(file.originalPath),
        currentContent,
        backupContent,
        hasChanges,
      });
    } catch (error) {
      logger.error(`Failed to preview ${file.originalPath}`, error);
    }
  }

  return previews;
}
