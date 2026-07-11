import path from 'node:path';
import { type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs-extra';
import {
  generateRegistry,
  getPublishInstructions,
  getRegistryOutputDir,
  RegistryPublishValidationError,
  validateRegistry,
} from '../services/registryPublisher.js';
import { logger } from '../utils/logger.js';
import { readPositiveInteger } from '../utils/numbers.js';
import { isPathSafe } from '../utils/validation.js';

const router = Router();

const ITEM_FILE_PATTERN = /^[a-z][a-z0-9-]{0,63}\.json$/;

/** Guards regeneration (a full library scan + write) against abusive volumes. */
export function createRegistryPublishMutationLimiter(
  max = readPositiveInteger(process.env.REGISTRY_PUBLISH_MUTATION_RATE_LIMIT_PER_MINUTE, 30)
) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        message: 'Too many registry publish requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    },
  });
}

const mutationLimiter = createRegistryPublishMutationLimiter();

/** Guards the public registry file endpoints, which read from disk per request. */
export function createRegistryFilesLimiter(
  max = readPositiveInteger(process.env.REGISTRY_FILES_RATE_LIMIT_PER_MINUTE, 300)
) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        message: 'Too many registry file requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    },
  });
}

function sendError(res: Response, error: unknown, fallback: string): void {
  const validation = error instanceof RegistryPublishValidationError;
  res.status(validation ? 400 : 500).json({
    success: false,
    error: {
      message: error instanceof Error ? error.message : fallback,
      code: validation ? error.code : 'REGISTRY_PUBLISH_ERROR',
    },
  });
}

router.post('/generate', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const result = await generateRegistry({
      name: typeof req.body?.name === 'string' ? req.body.name : undefined,
      homepage: typeof req.body?.homepage === 'string' ? req.body.homepage : undefined,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to generate registry', error);
    sendError(res, error, 'Failed to generate registry');
  }
});

router.get('/validate', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, validation: await validateRegistry() });
  } catch (error) {
    logger.error('Failed to validate registry', error);
    sendError(res, error, 'Failed to validate registry');
  }
});

router.get('/instructions', (_req: Request, res: Response) => {
  res.json({ success: true, instructions: getPublishInstructions() });
});

export default router;

/**
 * Serves the generated registry files at the public /r base so the shadcn CLI
 * can install directly from the running studio:
 *   GET /r/registry.json
 *   GET /r/<name>.json
 * Paths are resolved per request so the served registry always tracks the
 * active workspace.
 */
export function createRegistryFilesRouter(): Router {
  const filesRouter = Router();
  const filesLimiter = createRegistryFilesLimiter();

  filesRouter.get('/registry.json', filesLimiter, async (_req: Request, res: Response) => {
    const registryPath = path.join(getRegistryOutputDir(), 'registry.json');
    if (!(await fs.pathExists(registryPath))) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Registry not generated yet. POST /api/registry-publish/generate first.',
          code: 'REGISTRY_NOT_GENERATED',
        },
      });
      return;
    }
    res.sendFile(registryPath);
  });

  filesRouter.get('/:file', filesLimiter, async (req: Request, res: Response) => {
    const fileName = path.basename(req.params.file);
    if (fileName !== req.params.file || !ITEM_FILE_PATTERN.test(fileName)) {
      res.status(400).json({
        success: false,
        error: { message: 'Invalid registry item name.', code: 'REGISTRY_INVALID_ITEM' },
      });
      return;
    }
    const itemsDir = path.join(getRegistryOutputDir(), 'r');
    const itemPath = path.join(itemsDir, fileName);
    if (!isPathSafe(itemPath, itemsDir)) {
      res.status(400).json({
        success: false,
        error: { message: 'Invalid registry item name.', code: 'REGISTRY_INVALID_ITEM' },
      });
      return;
    }
    if (!(await fs.pathExists(itemPath))) {
      res.status(404).json({
        success: false,
        error: { message: 'Registry item not found.', code: 'REGISTRY_ITEM_NOT_FOUND' },
      });
      return;
    }
    res.sendFile(itemPath);
  });

  return filesRouter;
}
