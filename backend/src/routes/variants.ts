import { type Request, type Response, Router } from 'express';
import {
  ComponentLibraryNotFoundError,
  ComponentLibraryValidationError,
} from '../services/componentLibrary.js';
import {
  getVariantComponentDetail,
  listVariantComponents,
  previewVariantGeneration,
  VariantBuilderUnsupportedError,
  VariantBuilderValidationError,
} from '../services/variants.js';
import { getWorkingDirectory } from '../services/workspace.js';
import type { VariantPreviewOperation } from '../types/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

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
      code: error instanceof VariantBuilderValidationError ? error.code : error.code,
    };
  }
  if (error instanceof VariantBuilderUnsupportedError) {
    return { status: 422, message: error.message, code: error.code };
  }
  const message = error instanceof Error ? error.message : fallback;
  return { status: 500, message, code: 'VARIANT_BUILDER_ERROR' };
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
    res.json({
      success: true,
      component: await getVariantComponentDetail(getWorkingDirectory(), req.params.identifier),
    });
  } catch (error) {
    logger.error(`Failed to get variant component detail: ${req.params.identifier}`, error);
    sendError(res, variantErrorResponse(error, 'Failed to get variant component detail'));
  }
});

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const body = req.body as PreviewRequestBody;
    if (typeof body.componentPath !== 'string' || typeof body.targetDefinition !== 'string') {
      throw new VariantBuilderValidationError(
        'componentPath and targetDefinition must be strings.'
      );
    }
    const operation = readPreviewOperation(body.operation);
    res.json({
      success: true,
      preview: await previewVariantGeneration(getWorkingDirectory(), {
        componentPath: body.componentPath,
        targetDefinition: body.targetDefinition,
        operation,
      }),
    });
  } catch (error) {
    logger.error('Failed to preview variant generation', error);
    sendError(res, variantErrorResponse(error, 'Failed to preview variant generation'));
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
        typeof operation.defaultValue === 'string' ? operation.defaultValue.trim() : undefined,
    };
  }
  if (operation.type === 'add-value') {
    return {
      type: 'add-value',
      axisName: readString(operation.axisName, 'axisName'),
      value: readValue(operation.value),
    };
  }
  if (operation.type === 'set-default') {
    return {
      type: 'set-default',
      axisName: readString(operation.axisName, 'axisName'),
      valueName: readString(operation.valueName, 'valueName'),
    };
  }
  throw new VariantBuilderValidationError('Unsupported preview operation type.');
}

function readAxis(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    throw new VariantBuilderValidationError('axis is required.');
  }
  const axis = value as Record<string, unknown>;
  const values = Array.isArray(axis.values) ? axis.values.map(readValue) : [];
  return {
    name: readString(axis.name, 'axis.name'),
    values,
    defaultValue: typeof axis.defaultValue === 'string' ? axis.defaultValue.trim() : undefined,
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
    name: readString(record.name, 'value.name'),
    classes: record.classes.map((item) => item.trim()).filter(Boolean),
  };
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new VariantBuilderValidationError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export default router;
