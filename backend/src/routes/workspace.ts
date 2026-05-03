import { type Request, type Response, Router } from 'express';
import {
  initializeWorkspace,
  loadWorkspaceManifest,
  updateWorkspaceConfig,
} from '../services/workspace.js';
import type { WorkspaceConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

function validateConfigUpdates(body: unknown): Partial<WorkspaceConfig> | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const req = body as Record<string, unknown>;
  const updates: Partial<WorkspaceConfig> = {};

  if (req.componentDirectory !== undefined) {
    if (typeof req.componentDirectory !== 'string' || req.componentDirectory.trim().length === 0) {
      return null;
    }
    updates.componentDirectory = req.componentDirectory.trim();
  }

  if (req.backupRetentionDays !== undefined) {
    if (typeof req.backupRetentionDays !== 'number' || req.backupRetentionDays < 1) {
      return null;
    }
    updates.backupRetentionDays = req.backupRetentionDays;
  }

  if (req.maxBackups !== undefined) {
    if (typeof req.maxBackups !== 'number' || req.maxBackups < 1) {
      return null;
    }
    updates.maxBackups = req.maxBackups;
  }

  if (req.autoBackup !== undefined) {
    if (typeof req.autoBackup !== 'boolean') {
      return null;
    }
    updates.autoBackup = req.autoBackup;
  }

  if (req.validateAfterEdit !== undefined) {
    if (typeof req.validateAfterEdit !== 'boolean') {
      return null;
    }
    updates.validateAfterEdit = req.validateAfterEdit;
  }

  if (req.port !== undefined) {
    if (typeof req.port !== 'number' || req.port < 1 || req.port > 65535) {
      return null;
    }
    updates.port = req.port;
  }

  return updates;
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const manifest = await loadWorkspaceManifest();
    res.json({ success: true, manifest });
  } catch (error) {
    logger.error('Failed to load workspace manifest', error);
    const message = error instanceof Error ? error.message : 'Failed to load workspace manifest';

    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'WORKSPACE_LOAD_ERROR',
      },
    });
  }
});

router.post('/initialize', async (_req: Request, res: Response) => {
  try {
    const manifest = await initializeWorkspace();
    res.json({ success: true, manifest });
  } catch (error) {
    logger.error('Failed to initialize workspace', error);
    const message = error instanceof Error ? error.message : 'Failed to initialize workspace';

    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'WORKSPACE_INITIALIZE_ERROR',
      },
    });
  }
});

router.put('/config', async (req: Request, res: Response) => {
  try {
    const updates = validateConfigUpdates(req.body);

    if (!updates) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid workspace config update',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const manifest = await updateWorkspaceConfig(updates);
    res.json({ success: true, manifest });
  } catch (error) {
    logger.error('Failed to update workspace config', error);
    const message = error instanceof Error ? error.message : 'Failed to update workspace config';

    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'WORKSPACE_CONFIG_UPDATE_ERROR',
      },
    });
  }
});

export default router;
