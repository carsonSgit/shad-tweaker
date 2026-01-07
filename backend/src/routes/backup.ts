import path from 'node:path';
import { type Request, type Response, Router } from 'express';
import {
  createBackup,
  deleteBackup,
  getBackupDetails,
  listBackups,
  previewBackupRestore,
  restoreBackup,
} from '../services/backup.js';
import { getCachedComponents } from '../services/scanner.js';
import { logger } from '../utils/logger.js';
import { validateBackupId, validateComponentPaths } from '../utils/validation.js';

const router = Router();

// Get the project directory for path validation
// Backend runs from the backend/ directory, so we need to go up one level to the project root
const PROJECT_DIR = path.resolve(process.cwd(), '..');

router.post('/create', async (req: Request, res: Response) => {
  try {
    const componentPaths = req.body.componentPaths as string[] | undefined;

    let pathsToBackup: string[];

    if (componentPaths && Array.isArray(componentPaths) && componentPaths.length > 0) {
      // Validate component paths to prevent path traversal attacks
      const pathValidation = validateComponentPaths(componentPaths, PROJECT_DIR);
      if (!pathValidation.valid) {
        res.status(400).json({
          success: false,
          error: {
            message: pathValidation.error || 'Invalid component paths',
            code: 'PATH_TRAVERSAL_ERROR',
          },
        });
        return;
      }
      pathsToBackup = componentPaths;
    } else {
      const cached = getCachedComponents();
      if (cached.length === 0) {
        res.status(400).json({
          success: false,
          error: {
            message:
              'No components to backup. Either provide componentPaths or scan components first.',
            code: 'NO_COMPONENTS',
          },
        });
        return;
      }
      pathsToBackup = cached.map((c) => c.path);
    }

    const backup = await createBackup(pathsToBackup);

    res.json({
      success: true,
      backupId: backup.id,
      timestamp: backup.timestamp,
      components: backup.components,
      size: backup.size,
    });
  } catch (error) {
    logger.error('Failed to create backup', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to create backup',
        code: 'BACKUP_CREATE_ERROR',
      },
    });
  }
});

router.get('/list', async (_req: Request, res: Response) => {
  try {
    const backups = await listBackups();

    res.json({
      backups: backups.map((b) => ({
        id: b.id,
        timestamp: b.timestamp,
        components: b.components.length,
        size: b.size,
      })),
    });
  } catch (error) {
    logger.error('Failed to list backups', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to list backups',
        code: 'BACKUP_LIST_ERROR',
      },
    });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate backup ID to prevent path traversal attacks
    const idValidation = validateBackupId(id);
    if (!idValidation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: idValidation.error || 'Invalid backup ID',
          code: 'INVALID_BACKUP_ID',
        },
      });
      return;
    }

    const details = await getBackupDetails(id);

    if (!details) {
      res.status(404).json({
        success: false,
        error: {
          message: `Backup not found: ${id}`,
          code: 'BACKUP_NOT_FOUND',
        },
      });
      return;
    }

    res.json({
      success: true,
      backup: details,
    });
  } catch (error) {
    logger.error(`Failed to get backup details: ${req.params.id}`, error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get backup details',
        code: 'BACKUP_GET_ERROR',
      },
    });
  }
});

router.get('/:id/preview', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate backup ID to prevent path traversal attacks
    const idValidation = validateBackupId(id);
    if (!idValidation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: idValidation.error || 'Invalid backup ID',
          code: 'INVALID_BACKUP_ID',
        },
      });
      return;
    }

    const previews = await previewBackupRestore(id);

    // Filter to only files with changes
    const changedFiles = previews.filter((p) => p.hasChanges);

    res.json({
      success: true,
      backupId: id,
      totalFiles: previews.length,
      changedFiles: changedFiles.length,
      previews: changedFiles.map((p) => ({
        path: p.path,
        fileName: p.fileName,
        currentContent: p.currentContent,
        backupContent: p.backupContent,
      })),
    });
  } catch (error) {
    logger.error(`Failed to preview backup: ${req.params.id}`, error);
    const message = error instanceof Error ? error.message : 'Failed to preview backup';
    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'BACKUP_PREVIEW_ERROR',
      },
    });
  }
});

router.post('/restore', async (req: Request, res: Response) => {
  try {
    const { backupId } = req.body;

    if (!backupId || typeof backupId !== 'string') {
      res.status(400).json({
        success: false,
        error: {
          message: 'backupId is required',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    // Validate backup ID to prevent path traversal attacks
    const idValidation = validateBackupId(backupId);
    if (!idValidation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: idValidation.error || 'Invalid backup ID',
          code: 'INVALID_BACKUP_ID',
        },
      });
      return;
    }

    const result = await restoreBackup(backupId);

    res.json({
      success: true,
      restored: result.restored,
      count: result.count,
    });
  } catch (error) {
    logger.error('Failed to restore backup', error);
    const message = error instanceof Error ? error.message : 'Failed to restore backup';
    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'BACKUP_RESTORE_ERROR',
      },
    });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate backup ID to prevent path traversal attacks
    const idValidation = validateBackupId(id);
    if (!idValidation.valid) {
      res.status(400).json({
        success: false,
        error: {
          message: idValidation.error || 'Invalid backup ID',
          code: 'INVALID_BACKUP_ID',
        },
      });
      return;
    }

    const deleted = await deleteBackup(id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: {
          message: `Backup not found: ${id}`,
          code: 'BACKUP_NOT_FOUND',
        },
      });
      return;
    }

    res.json({
      success: true,
      message: `Backup ${id} deleted`,
    });
  } catch (error) {
    logger.error(`Failed to delete backup: ${req.params.id}`, error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to delete backup',
        code: 'BACKUP_DELETE_ERROR',
      },
    });
  }
});

export default router;
