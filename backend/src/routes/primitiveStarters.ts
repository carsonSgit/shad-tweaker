import { type Request, type Response, Router } from 'express';
import {
  applyPrimitiveStarter,
  generatePrimitiveStarter,
  listPrimitiveStarterTemplates,
  PrimitiveStarterConflictError,
  PrimitiveStarterTemplateNotFoundError,
  PrimitiveStarterValidationError,
} from '../services/primitiveStarters.js';
import { getWorkingDirectory } from '../services/workspace.js';
import type { PrimitiveStarterProvider, PrimitiveStarterRequest } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { isSafeRegistryIdentifier } from '../utils/validation.js';

const router = Router();
const PROVIDERS = ['blank', 'radix', 'base-ui'] as const satisfies PrimitiveStarterProvider[];

function validateStarterRequest(body: unknown): body is PrimitiveStarterRequest {
  if (typeof body !== 'object' || body === null) return false;
  const bodyRecord = body as Record<string, unknown>;

  if (
    typeof bodyRecord.provider !== 'string' ||
    !PROVIDERS.includes(bodyRecord.provider as PrimitiveStarterProvider)
  ) {
    return false;
  }
  if (bodyRecord.templateId !== undefined) {
    if (
      typeof bodyRecord.templateId !== 'string' ||
      !isSafeRegistryIdentifier(bodyRecord.templateId)
    ) {
      return false;
    }
  }
  if (bodyRecord.componentName !== undefined && typeof bodyRecord.componentName !== 'string') {
    return false;
  }
  if (bodyRecord.targetPath !== undefined && typeof bodyRecord.targetPath !== 'string') {
    return false;
  }
  if (bodyRecord.includeCva !== undefined && typeof bodyRecord.includeCva !== 'boolean') {
    return false;
  }
  if (bodyRecord.overwrite !== undefined && typeof bodyRecord.overwrite !== 'boolean') {
    return false;
  }

  return true;
}

function starterErrorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (error instanceof PrimitiveStarterTemplateNotFoundError) {
    return { status: 404, message, code: error.code };
  }
  if (error instanceof PrimitiveStarterValidationError) {
    return { status: 400, message, code: error.code };
  }
  if (error instanceof PrimitiveStarterConflictError) {
    return { status: 409, message, code: error.code };
  }
  return { status: 500, message, code: 'PRIMITIVE_STARTER_ERROR' };
}

router.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    templates: listPrimitiveStarterTemplates(),
  });
});

router.post('/preview', async (req: Request, res: Response) => {
  try {
    if (!validateStarterRequest(req.body)) {
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
    const response = starterErrorResponse(error, 'Failed to preview primitive starter');
    res.status(response.status).json({
      success: false,
      error: {
        message: response.message,
        code: response.code,
      },
    });
  }
});

router.post('/apply', async (req: Request, res: Response) => {
  try {
    if (!validateStarterRequest(req.body)) {
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
    const response = starterErrorResponse(error, 'Failed to apply primitive starter');
    res.status(response.status).json({
      success: false,
      error: {
        message: response.message,
        code: response.code,
      },
    });
  }
});

export default router;
