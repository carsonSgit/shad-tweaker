import { type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import backendPackage from '../../package.json' with { type: 'json' };
import { listBackups } from '../services/backup.js';
import { listComponentLibrary } from '../services/componentLibrary.js';
import { getRegistrySourceHealth, listRegistryItemsBySource } from '../services/registry.js';
import {
  createFrequencyReport,
  createInconsistencyReport,
  listTokenSets,
} from '../services/tokens.js';
import { listVariantComponents } from '../services/variants.js';
import {
  getWorkingDirectory,
  listRegistrySources,
  loadWorkspaceManifest,
} from '../services/workspace.js';
import type { WorkspaceManifest } from '../types/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

const summaryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      message: 'Too many studio summary requests. Please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  },
});

async function readSafely<T>(label: string, loader: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    logger.warn(`Failed to load studio summary ${label}`, error);
    return fallback;
  }
}

function createFallbackManifest(): WorkspaceManifest {
  const now = new Date().toISOString();

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    config: {
      componentDirectory: './components/ui',
      backupRetentionDays: 30,
      maxBackups: 20,
      autoBackup: true,
      validateAfterEdit: true,
      port: 3001,
    },
    components: [],
    sources: [],
    packages: [],
    tokenSets: [],
    componentTokenOverrides: {},
    presets: [],
    backups: [],
  };
}

router.get('/summary', summaryLimiter, async (_req: Request, res: Response) => {
  const cwd = getWorkingDirectory();
  const [
    manifest,
    inventory,
    sources,
    health,
    registryItems,
    tokenSets,
    frequency,
    inconsistencies,
    variantComponents,
    backups,
  ] = await Promise.all([
    readSafely('workspace manifest', () => loadWorkspaceManifest(cwd), createFallbackManifest()),
    readSafely('components', () => listComponentLibrary(cwd), []),
    readSafely('registry sources', () => listRegistrySources(cwd), []),
    readSafely('registry health', () => getRegistrySourceHealth(cwd), []),
    readSafely('registry items', () => listRegistryItemsBySource(undefined, cwd), {
      items: [],
      warnings: [],
    }),
    readSafely('token sets', () => listTokenSets(), []),
    readSafely('token frequency', () => createFrequencyReport(), {
      entries: [],
      totalOccurrences: 0,
    }),
    readSafely('token inconsistencies', () => createInconsistencyReport(), { entries: [] }),
    readSafely('variants', () => listVariantComponents(cwd), []),
    readSafely('backups', () => listBackups(), []),
  ]);

  res.setHeader('Cache-Control', 'private, max-age=5');
  res.json({
    success: true,
    workspace: {
      cwd,
      manifest,
    },
    components: {
      count: inventory.length,
      inventory,
    },
    registries: {
      sources,
      health,
      items: registryItems.items,
      warnings: registryItems.warnings,
    },
    tokens: {
      tokenSets,
      frequency,
      inconsistencies,
    },
    variants: {
      components: variantComponents,
    },
    backups: {
      backups,
    },
    health: {
      status: 'ok',
      version: backendPackage.version,
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;
