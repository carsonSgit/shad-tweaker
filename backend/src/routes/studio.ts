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
  DEFAULT_WORKSPACE_CONFIG,
  getWorkingDirectory,
  listRegistrySources,
  loadWorkspaceManifest,
} from '../services/workspace.js';
import type { WorkspaceManifest } from '../types/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createStudioSummaryLimiter(
  max = readPositiveInteger(process.env.STUDIO_SUMMARY_RATE_LIMIT_PER_MINUTE, 600)
) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
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
}

const summaryLimiter = createStudioSummaryLimiter();

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
    config: { ...DEFAULT_WORKSPACE_CONFIG },
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
      backups: backups.map((backup) => ({
        id: backup.id,
        timestamp: backup.timestamp,
        components: backup.components.length,
        size: backup.size,
      })),
    },
    health: {
      status: 'ok',
      version: backendPackage.version,
      timestamp: new Date().toISOString(),
    },
  });
});

export default router;
