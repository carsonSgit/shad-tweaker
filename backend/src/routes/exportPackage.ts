import { type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ExportValidationError, exportComponents } from '../services/exporter.js';
import type { ComponentExportTarget } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { readPositiveInteger } from '../utils/numbers.js';

const router = Router();

/** Guards export writes (potentially many files) against abusive volumes. */
export function createExportMutationLimiter(
  max = readPositiveInteger(process.env.EXPORT_MUTATION_RATE_LIMIT_PER_MINUTE, 30)
) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        message: 'Too many export requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    },
  });
}

const mutationLimiter = createExportMutationLimiter();

router.post('/', mutationLimiter, async (req: Request, res: Response) => {
  try {
    if (!Array.isArray(req.body?.componentPaths)) {
      throw new ExportValidationError('componentPaths must be an array.');
    }
    if (typeof req.body?.target !== 'string') {
      throw new ExportValidationError('target is required.');
    }
    const result = await exportComponents({
      componentPaths: req.body.componentPaths,
      target: req.body.target as ComponentExportTarget,
      outputDir: typeof req.body.outputDir === 'string' ? req.body.outputDir : undefined,
      packageName: typeof req.body.packageName === 'string' ? req.body.packageName : undefined,
    });
    res.json({ success: true, result });
  } catch (error) {
    const validation = error instanceof ExportValidationError;
    if (!validation) logger.error('Failed to export components', error);
    res.status(validation ? 400 : 500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to export components',
        code: validation ? error.code : 'EXPORT_ERROR',
      },
    });
  }
});

export default router;
