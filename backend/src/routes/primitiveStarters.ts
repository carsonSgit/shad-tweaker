import { type Request, type Response, Router } from 'express';
import {
  applyPrimitiveStarter,
  generatePrimitiveStarter,
  listPrimitiveStarterTemplates,
} from '../services/primitiveStarters.js';
import { getWorkingDirectory } from '../services/workspace.js';
import type { PrimitiveStarterProvider, PrimitiveStarterRequest } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { isSafeRegistryIdentifier } from '../utils/validation.js';

const router = Router();
const PROVIDERS = ['blank', 'radix', 'base-ui'] as const satisfies PrimitiveStarterProvider[];

function validatePreviewRequest(body: unknown): body is PrimitiveStarterRequest {
  if (typeof body !== 'object' || body === null) return false;
  const req = body as Record<string, unknown>;

  if (
    typeof req.provider !== 'string' ||
    !PROVIDERS.includes(req.provider as PrimitiveStarterProvider)
  ) {
    return false;
  }
  if (req.templateId !== undefined) {
    return typeof req.templateId === 'string' && isSafeRegistryIdentifier(req.templateId);
  }
  if (req.componentName !== undefined && typeof req.componentName !== 'string') return false;
  if (req.targetPath !== undefined && typeof req.targetPath !== 'string') return false;
  if (req.includeCva !== undefined && typeof req.includeCva !== 'boolean') return false;
  if (req.overwrite !== undefined && typeof req.overwrite !== 'boolean') return false;

  return true;
}

router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    templates: listPrimitiveStarterTemplates(),
  });
});

router.post('/preview', async (req: Request, res: Response) => {
  try {
    if (!validatePreviewRequest(req.body)) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid primitive starter preview request.',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const result = await generatePrimitiveStarter(req.body, getWorkingDirectory());
    res.json({ success: true, result });
  } catch (error) {
    logger.error('Failed to preview primitive starter', error);
    const message = error instanceof Error ? error.message : 'Failed to preview primitive starter';
    res.status(400).json({
      success: false,
      error: {
        message,
        code: 'PRIMITIVE_STARTER_PREVIEW_ERROR',
      },
    });
  }
});

router.post('/apply', async (req: Request, res: Response) => {
  try {
    if (!validatePreviewRequest(req.body)) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Invalid primitive starter apply request.',
          code: 'VALIDATION_ERROR',
        },
      });
      return;
    }

    const result = await applyPrimitiveStarter(req.body, getWorkingDirectory());
    res.json({ success: true, result });
  } catch (error) {
    logger.error('Failed to apply primitive starter', error);
    const message = error instanceof Error ? error.message : 'Failed to apply primitive starter';
    res.status(400).json({
      success: false,
      error: {
        message,
        code: 'PRIMITIVE_STARTER_APPLY_ERROR',
      },
    });
  }
});

export default router;
