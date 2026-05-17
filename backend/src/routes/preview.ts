import { type Request, type Response, Router } from 'express';
import {
  ComponentPreviewNotFoundError,
  ComponentPreviewValidationError,
  createComponentPreviewManifest,
} from '../services/preview.js';
import { getWorkingDirectory } from '../services/workspace.js';
import { logger } from '../utils/logger.js';

const router = Router();

function previewErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ComponentPreviewValidationError) {
    return { status: 400, message: error.message, code: error.code };
  }
  if (error instanceof ComponentPreviewNotFoundError) {
    return { status: 404, message: error.message, code: error.code };
  }
  const message = error instanceof Error ? error.message : fallback;
  return { status: 500, message, code: 'COMPONENT_PREVIEW_ERROR' };
}

router.post('/manifest', async (req: Request, res: Response) => {
  try {
    res.json({
      manifest: await createComponentPreviewManifest(getWorkingDirectory(), req.body),
    });
  } catch (error) {
    logger.error('Failed to create component preview manifest', error);
    const response = previewErrorResponse(error, 'Failed to create component preview manifest');
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
