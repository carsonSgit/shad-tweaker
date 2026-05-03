import { type Request, type Response, Router } from 'express';
import {
  deleteRegistrySource,
  initializeWorkspace,
  listRegistrySources,
  loadWorkspaceManifest,
  updateWorkspaceConfig,
  upsertRegistrySource,
} from '../services/workspace.js';
import type { RegistrySource, WorkspaceConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

const REGISTRY_SOURCE_TYPES: RegistrySource['type'][] = [
  'shadcn-registry',
  'url-list',
  'local-folder',
  'npm-package',
];

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

function validateRegistrySource(
  body: unknown
): (Omit<RegistrySource, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const req = body as Record<string, unknown>;

  if (req.id !== undefined && (typeof req.id !== 'string' || req.id.trim().length === 0)) {
    return null;
  }

  if (typeof req.name !== 'string' || req.name.trim().length === 0) {
    return null;
  }

  if (typeof req.type !== 'string' || !REGISTRY_SOURCE_TYPES.includes(req.type as never)) {
    return null;
  }

  if (req.baseUrl !== undefined && typeof req.baseUrl !== 'string') {
    return null;
  }

  if (req.registryJsonUrl !== undefined && typeof req.registryJsonUrl !== 'string') {
    return null;
  }

  if (req.enabled !== undefined && typeof req.enabled !== 'boolean') {
    return null;
  }

  return {
    id: req.id?.toString().trim(),
    name: req.name.trim(),
    type: req.type as RegistrySource['type'],
    baseUrl: typeof req.baseUrl === 'string' ? req.baseUrl.trim() : undefined,
    registryJsonUrl:
      typeof req.registryJsonUrl === 'string' ? req.registryJsonUrl.trim() : undefined,
    enabled: typeof req.enabled === 'boolean' ? req.enabled : true,
  };
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

router.get('/registry-sources', async (_req: Request, res: Response) => {
  try {
    const sources = await listRegistrySources();
    res.json({ success: true, sources });
  } catch (error) {
    logger.error('Failed to list registry sources', error);
    const message = error instanceof Error ? error.message : 'Failed to list registry sources';

    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'REGISTRY_SOURCE_LIST_ERROR',
      },
    });
  }
});

router.post('/registry-sources', async (req: Request, res: Response) => {
  try {
    const source = validateRegistrySource(req.body);

    if (!source) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid registry source',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const saved = await upsertRegistrySource(source);
    res.status(201).json({ success: true, source: saved });
  } catch (error) {
    logger.error('Failed to save registry source', error);
    const message = error instanceof Error ? error.message : 'Failed to save registry source';

    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'REGISTRY_SOURCE_SAVE_ERROR',
      },
    });
  }
});

router.delete('/registry-sources/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid registry source ID',
          code: 'INVALID_REGISTRY_SOURCE_ID',
        },
      });
      return;
    }

    const deleted = await deleteRegistrySource(id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: {
          message: `Registry source not found: ${id}`,
          code: 'REGISTRY_SOURCE_NOT_FOUND',
        },
      });
      return;
    }

    res.json({ success: true, message: `Registry source ${id} deleted` });
  } catch (error) {
    logger.error(`Failed to delete registry source: ${req.params.id}`, error);
    const message = error instanceof Error ? error.message : 'Failed to delete registry source';

    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'REGISTRY_SOURCE_DELETE_ERROR',
      },
    });
  }
});

export default router;
