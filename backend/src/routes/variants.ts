import { type NextFunction, type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  ComponentLibraryNotFoundError,
  ComponentLibraryValidationError,
} from '../services/componentLibrary.js';
import {
  applyVariantGeneration,
  getVariantComponentDetail,
  listVariantComponents,
  previewVariantGeneration,
  VariantBuilderUnsupportedError,
  VariantBuilderValidationError,
} from '../services/variants.js';
import { getWorkingDirectory } from '../services/workspace.js';
import type { VariantPreviewOperation } from '../types/index.js';
import { createInvalidComponentIdentifierError } from '../utils/componentIdentifier.js';
import { logger } from '../utils/logger.js';
import { readPositiveInteger } from '../utils/numbers.js';
import { hasUnsafeComponentIdentifierUrl, readComponentIdentifier } from '../utils/validation.js';

const router = Router();
const MAX_PREVIEW_PATH_LENGTH = 1024;
const MAX_PREVIEW_IDENTIFIER_LENGTH = 260;

/**
 * Guards variant generation's write endpoint (file rewrite + backup creation)
 * against abusive request volumes. Read/preview endpoints stay unthrottled.
 */
export function createVariantMutationLimiter(
  max = readPositiveInteger(process.env.VARIANT_MUTATION_RATE_LIMIT_PER_MINUTE, 60)
) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        message: 'Too many variant write requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    },
  });
}

const mutationLimiter = createVariantMutationLimiter();

interface PreviewRequestBody {
  componentPath?: unknown;
  targetDefinition?: unknown;
  operation?: unknown;
}

function variantErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ComponentLibraryNotFoundError) {
    return { status: 404, message: error.message, code: error.code };
  }
  if (
    error instanceof ComponentLibraryValidationError ||
    error instanceof VariantBuilderValidationError
  ) {
    return {
      status: 400,
      message: error.message,
      code: error.code,
    };
  }
  if (error instanceof VariantBuilderUnsupportedError) {
    return { status: 422, message: error.message, code: error.code };
  }
  return { status: 500, message: fallback, code: 'VARIANT_BUILDER_ERROR' };
}

function sendError(res: Response, response: ReturnType<typeof variantErrorResponse>): void {
  res.status(response.status).json({
    success: false,
    error: {
      message: response.message,
      code: response.code,
    },
  });
}

function invalidComponentIdentifierResponse(): ReturnType<typeof variantErrorResponse> {
  return variantErrorResponse(
    createInvalidComponentIdentifierError(),
    'Failed to get variant component detail'
  );
}

router.use((req, res, next) => {
  if (hasUnsafeComponentIdentifierUrl(req.originalUrl)) {
    sendError(res, invalidComponentIdentifierResponse());
    return;
  }

  next();
});

router.get('/', async (_req: Request, res: Response) => {
  sendError(res, invalidComponentIdentifierResponse());
});

router.get('/components', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, components: await listVariantComponents(getWorkingDirectory()) });
  } catch (error) {
    logger.error('Failed to list variant components', error);
    sendError(res, variantErrorResponse(error, 'Failed to list variant components'));
  }
});

router.get('/components/:identifier', async (req: Request, res: Response) => {
  try {
    const identifier = readComponentIdentifier(req.params.identifier);
    if (!identifier) {
      sendError(res, invalidComponentIdentifierResponse());
      return;
    }

    res.json({
      success: true,
      component: await getVariantComponentDetail(getWorkingDirectory(), identifier),
    });
  } catch (error) {
    logger.error(`Failed to get variant component detail: ${req.params.identifier}`, error);
    sendError(res, variantErrorResponse(error, 'Failed to get variant component detail'));
  }
});

router.get('/components/*', async (_req: Request, res: Response) => {
  sendError(res, invalidComponentIdentifierResponse());
});

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const body = req.body as PreviewRequestBody;
    const componentPath = readString(body.componentPath, 'componentPath', MAX_PREVIEW_PATH_LENGTH);
    const targetDefinition = readString(
      body.targetDefinition,
      'targetDefinition',
      MAX_PREVIEW_IDENTIFIER_LENGTH
    );
    const operation = readPreviewOperation(body.operation);
    res.json({
      success: true,
      preview: await previewVariantGeneration(getWorkingDirectory(), {
        componentPath,
        targetDefinition,
        operation,
      }),
    });
  } catch (error) {
    logger.error('Failed to preview variant generation', error);
    sendError(res, variantErrorResponse(error, 'Failed to preview variant generation'));
  }
});

router.post('/apply', mutationLimiter, async (req: Request, res: Response) => {
  try {
    const body = req.body as PreviewRequestBody;
    const componentPath = readString(body.componentPath, 'componentPath', MAX_PREVIEW_PATH_LENGTH);
    const targetDefinition = readString(
      body.targetDefinition,
      'targetDefinition',
      MAX_PREVIEW_IDENTIFIER_LENGTH
    );
    const operation = readPreviewOperation(body.operation);
    res.json({
      success: true,
      result: await applyVariantGeneration(getWorkingDirectory(), {
        componentPath,
        targetDefinition,
        operation,
      }),
    });
  } catch (error) {
    logger.error('Failed to apply variant generation', error);
    sendError(res, variantErrorResponse(error, 'Failed to apply variant generation'));
  }
});

function readPreviewOperation(value: unknown): VariantPreviewOperation {
  if (typeof value !== 'object' || value === null) {
    throw new VariantBuilderValidationError('operation is required.');
  }
  const operation = value as Record<string, unknown>;
  if (operation.type === 'add-axis') {
    return {
      type: 'add-axis',
      axis: readAxis(operation.axis),
      defaultValue:
        typeof operation.defaultValue === 'string'
          ? readString(operation.defaultValue, 'defaultValue', MAX_PREVIEW_IDENTIFIER_LENGTH)
          : undefined,
    };
  }
  if (operation.type === 'add-value') {
    return {
      type: 'add-value',
      axisName: readString(operation.axisName, 'axisName', MAX_PREVIEW_IDENTIFIER_LENGTH),
      value: readValue(operation.value),
    };
  }
  if (operation.type === 'set-default') {
    return {
      type: 'set-default',
      axisName: readString(operation.axisName, 'axisName', MAX_PREVIEW_IDENTIFIER_LENGTH),
      valueName: readString(operation.valueName, 'valueName', MAX_PREVIEW_IDENTIFIER_LENGTH),
    };
  }
  throw new VariantBuilderValidationError('Unsupported preview operation type.');
}

function readAxis(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    throw new VariantBuilderValidationError('axis is required.');
  }
  const axis = value as Record<string, unknown>;
  if (!Array.isArray(axis.values)) {
    throw new VariantBuilderValidationError('axis.values is required.');
  }
  const values = axis.values.map(readValue);
  return {
    name: readString(axis.name, 'axis.name', MAX_PREVIEW_IDENTIFIER_LENGTH),
    values,
    defaultValue:
      typeof axis.defaultValue === 'string'
        ? readString(axis.defaultValue, 'axis.defaultValue', MAX_PREVIEW_IDENTIFIER_LENGTH)
        : undefined,
  };
}

function readValue(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    throw new VariantBuilderValidationError('variant value is required.');
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.classes) || record.classes.some((item) => typeof item !== 'string')) {
    throw new VariantBuilderValidationError('variant value classes must be strings.');
  }
  return {
    name: readString(record.name, 'value.name', MAX_PREVIEW_IDENTIFIER_LENGTH),
    classes: record.classes.map((item) => item.trim()).filter(Boolean),
  };
}

function readString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VariantBuilderValidationError(`${field} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new VariantBuilderValidationError(`${field} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

router.use((error: Error, _req: Request, res: Response, next: NextFunction): void => {
  if (error instanceof URIError) {
    sendError(res, invalidComponentIdentifierResponse());
    return;
  }

  next(error);
});

export default router;
