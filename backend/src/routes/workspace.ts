import { type Request, type Response, Router } from 'express';
import {
  deleteRegistrySource,
  initializeWorkspace,
  listRegistrySources,
  loadWorkspaceManifest,
  updateWorkspaceConfig,
  upsertRegistrySource,
} from '../services/workspace.js';
import {
  findRegistryItem,
  getRegistryItem,
  getRegistrySourceHealth,
  listRegistryItemsBySource,
} from '../services/registry.js';
import type { RegistrySource, WorkspaceConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';

const router = Router();

type ValidationResult<T> =
  | { value: T; errors: null }
  | { value: null; errors: Record<string, string> };

type RegistrySourceInput = Omit<RegistrySource, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
};

const REGISTRY_SOURCE_TYPES: RegistrySource['type'][] = [
  'shadcn-registry',
  'url-list',
  'local-folder',
  'npm-package',
];

function invalid<T>(errors: Record<string, string>): ValidationResult<T> {
  return { value: null, errors };
}

function valid<T>(value: T): ValidationResult<T> {
  return { value, errors: null };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateConfigUpdates(body: unknown): ValidationResult<Partial<WorkspaceConfig>> {
  if (typeof body !== 'object' || body === null) {
    return invalid({ body: 'Expected a JSON object.' });
  }

  const req = body as Record<string, unknown>;
  const updates: Partial<WorkspaceConfig> = {};
  const errors: Record<string, string> = {};

  if (req.componentDirectory !== undefined) {
    if (typeof req.componentDirectory !== 'string' || req.componentDirectory.trim().length === 0) {
      errors.componentDirectory = 'Must be a non-empty string.';
    } else if (!isSafeProjectRelativePath(req.componentDirectory.trim())) {
      errors.componentDirectory = 'Must be a relative path inside the project.';
    } else {
      updates.componentDirectory = req.componentDirectory.trim();
    }
  }

  if (req.backupRetentionDays !== undefined) {
    if (
      typeof req.backupRetentionDays !== 'number' ||
      !Number.isInteger(req.backupRetentionDays) ||
      req.backupRetentionDays < 1 ||
      req.backupRetentionDays > 365
    ) {
      errors.backupRetentionDays = 'Must be an integer between 1 and 365.';
    } else {
      updates.backupRetentionDays = req.backupRetentionDays;
    }
  }

  if (req.maxBackups !== undefined) {
    if (
      typeof req.maxBackups !== 'number' ||
      !Number.isInteger(req.maxBackups) ||
      req.maxBackups < 1 ||
      req.maxBackups > 1000
    ) {
      errors.maxBackups = 'Must be an integer between 1 and 1000.';
    } else {
      updates.maxBackups = req.maxBackups;
    }
  }

  if (req.autoBackup !== undefined) {
    if (typeof req.autoBackup !== 'boolean') {
      errors.autoBackup = 'Must be a boolean.';
    } else {
      updates.autoBackup = req.autoBackup;
    }
  }

  if (req.validateAfterEdit !== undefined) {
    if (typeof req.validateAfterEdit !== 'boolean') {
      errors.validateAfterEdit = 'Must be a boolean.';
    } else {
      updates.validateAfterEdit = req.validateAfterEdit;
    }
  }

  if (req.port !== undefined) {
    if (
      typeof req.port !== 'number' ||
      !Number.isInteger(req.port) ||
      req.port < 1024 ||
      req.port > 65535
    ) {
      errors.port = 'Must be an integer between 1024 and 65535.';
    } else {
      updates.port = req.port;
    }
  }

  return Object.keys(errors).length > 0 ? invalid(errors) : valid(updates);
}

function validateRegistrySource(body: unknown): ValidationResult<RegistrySourceInput> {
  if (typeof body !== 'object' || body === null) {
    return invalid({ body: 'Expected a JSON object.' });
  }

  const req = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (req.id !== undefined && (typeof req.id !== 'string' || req.id.trim().length === 0)) {
    errors.id = 'Must be a non-empty string when provided.';
  }

  if (typeof req.name !== 'string' || req.name.trim().length === 0) {
    errors.name = 'Must be a non-empty string.';
  }

  if (
    typeof req.type !== 'string' ||
    !REGISTRY_SOURCE_TYPES.includes(req.type as RegistrySource['type'])
  ) {
    errors.type = `Must be one of: ${REGISTRY_SOURCE_TYPES.join(', ')}.`;
  }

  if (req.enabled !== undefined && typeof req.enabled !== 'boolean') {
    errors.enabled = 'Must be a boolean.';
  }

  if (Object.keys(errors).length > 0) {
    return invalid(errors);
  }

  const name = req.name as string;
  const type = req.type as RegistrySource['type'];
  const baseUrl = hasValue(req.baseUrl) ? req.baseUrl.trim() : undefined;
  const registryJsonUrl = hasValue(req.registryJsonUrl) ? req.registryJsonUrl.trim() : undefined;

  if (type === 'local-folder') {
    if (!baseUrl) {
      errors.baseUrl = 'Local folder sources require a project-relative folder path.';
    } else if (!isSafeProjectRelativePath(baseUrl)) {
      errors.baseUrl = 'Must be a relative path inside the project for local folder sources.';
    }
    if (registryJsonUrl) {
      errors.registryJsonUrl = 'Local folder sources should use baseUrl as the folder path.';
    }
  } else {
    if (req.baseUrl !== undefined && (!baseUrl || !isHttpUrl(baseUrl))) {
      errors.baseUrl = 'Must be an http:// or https:// URL.';
    }
    if (req.registryJsonUrl !== undefined && (!registryJsonUrl || !isHttpUrl(registryJsonUrl))) {
      errors.registryJsonUrl = 'Must be an http:// or https:// URL.';
    }
  }

  if (Object.keys(errors).length > 0) {
    return invalid(errors);
  }

  return valid({
    id: req.id?.toString().trim(),
    name: name.trim(),
    type,
    baseUrl,
    registryJsonUrl,
    enabled: typeof req.enabled === 'boolean' ? req.enabled : true,
  });
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
    const { manifest, created } = await initializeWorkspace();
    res.status(created ? 201 : 200).json({ success: true, manifest, created });
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
    const validation = validateConfigUpdates(req.body);

    if (validation.errors !== null) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid workspace config update',
          code: 'VALIDATION_ERROR',
          fields: validation.errors,
        },
      });
      return;
    }

    const manifest = await updateWorkspaceConfig(validation.value);
    res.json({
      success: true,
      manifest,
      restartRequired: validation.value.port !== undefined,
      restartRequiredReason:
        validation.value.port !== undefined
          ? 'Port changes are persisted to the workspace manifest and take effect after restarting the backend.'
          : undefined,
    });
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
    const validation = validateRegistrySource(req.body);

    if (validation.errors !== null) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid registry source',
          code: 'VALIDATION_ERROR',
          fields: validation.errors,
        },
      });
      return;
    }

    const { source, created } = await upsertRegistrySource(validation.value);
    res.status(created ? 201 : 200).json({ success: true, source, created });
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

router.get('/registry-sources/health', async (_req: Request, res: Response) => {
  try {
    const health = await getRegistrySourceHealth();
    res.json({ success: true, health });
  } catch (error) {
    logger.error('Failed to check registry source health', error);
    const message = error instanceof Error ? error.message : 'Failed to check registry source health';
    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'REGISTRY_SOURCE_HEALTH_ERROR',
      },
    });
  }
});

router.get('/registry-items', async (req: Request, res: Response) => {
  try {
    const sourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId : undefined;
    const result = await listRegistryItemsBySource(sourceId);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to list registry items', error);
    const message = error instanceof Error ? error.message : 'Failed to list registry items';
    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'REGISTRY_ITEM_LIST_ERROR',
      },
    });
  }
});

router.get('/registry-items/:itemName', async (req: Request, res: Response) => {
  try {
    const item = await findRegistryItem(req.params.itemName);
    if (!item) {
      res.status(404).json({
        success: false,
        error: {
          message: `Registry item not found: ${req.params.itemName}`,
          code: 'REGISTRY_ITEM_NOT_FOUND',
        },
      });
      return;
    }
    res.json({ success: true, item });
  } catch (error) {
    logger.error(`Failed to fetch registry item: ${req.params.itemName}`, error);
    const message = error instanceof Error ? error.message : 'Failed to fetch registry item';
    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'REGISTRY_ITEM_FETCH_ERROR',
      },
    });
  }
});

router.get('/registry-items/:sourceId/:itemName', async (req: Request, res: Response) => {
  try {
    const { sourceId, itemName } = req.params;
    const item = await getRegistryItem(sourceId, itemName);
    if (!item) {
      res.status(404).json({
        success: false,
        error: {
          message: `Registry item not found: ${sourceId}/${itemName}`,
          code: 'REGISTRY_ITEM_NOT_FOUND',
        },
      });
      return;
    }
    res.json({ success: true, item });
  } catch (error) {
    logger.error(`Failed to fetch registry item: ${req.params.sourceId}/${req.params.itemName}`, error);
    const message = error instanceof Error ? error.message : 'Failed to fetch registry item';
    res.status(500).json({
      success: false,
      error: {
        message,
        code: 'REGISTRY_ITEM_FETCH_ERROR',
      },
    });
  }
});

export default router;
