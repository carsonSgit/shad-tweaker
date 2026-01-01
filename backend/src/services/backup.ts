import fs from 'fs-extra';
import path from 'path';
import type { Backup, BackupManifest } from '../types/index.js';
import { logger } from '../utils/logger.js';

const BACKUP_DIR = '.shadcn-tweaker/backups';

function getBackupBasePath(): string {
  return path.join(process.cwd(), BACKUP_DIR);
}

function generateBackupId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `backup_${timestamp}`;
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
      const fileName = path.basename(componentPath);
      const destPath = path.join(backupPath, fileName);

      await fs.copy(componentPath, destPath);

      const stats = await fs.stat(destPath);
      totalSize += stats.size;

      manifest.files.push({
        originalPath: componentPath,
        backupPath: destPath,
      });
    } catch (error) {
      logger.error(`Failed to backup ${componentPath}`, error);
      throw error;
    }
  }

  const manifestPath = path.join(backupPath, 'manifest.json');
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });

  logger.info(`Created backup ${backupId} with ${componentPaths.length} files`);

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

export async function restoreBackup(backupId: string): Promise<{ success: boolean; restored: string[]; count: number }> {
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

export async function cleanupOldBackups(maxBackups: number = 20): Promise<number> {
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

  logger.info(`Cleaned up ${deleted} old backups`);
  return deleted;
}

export async function getBackupDetails(backupId: string): Promise<BackupManifest | null> {
  const manifestPath = path.join(getBackupBasePath(), backupId, 'manifest.json');

  if (!(await fs.pathExists(manifestPath))) {
    return null;
  }

  return fs.readJson(manifestPath);
}
