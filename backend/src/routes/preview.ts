import { type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  ComponentPreviewNotFoundError,
  ComponentPreviewValidationError,
  createComponentPreviewManifest,
  createPreviewComponentImportModule,
  createPreviewFrameHtml,
  createPreviewRuntimeModule,
  normalizePreviewRequest,
} from '../services/preview.js';
import { getWorkingDirectory } from '../services/workspace.js';
import { logger } from '../utils/logger.js';
import { readPositiveInteger } from '../utils/numbers.js';

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

export function createPreviewApiLimiter(
  max = readPositiveInteger(process.env.PREVIEW_API_RATE_LIMIT_PER_MINUTE, 300)
) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        message: 'Too many preview API requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    },
  });
}

export function createPreviewBrowserLimiter(
  max = readPositiveInteger(process.env.PREVIEW_BROWSER_RATE_LIMIT_PER_MINUTE, 1000)
) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        message: 'Too many preview browser requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    },
  });
}

export function createPreviewApiRouter(): Router {
  const router = Router();

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

  return router;
}

export function createPreviewBrowserRouter(): Router {
  const router = Router();

  router.get('/frame', async (req: Request, res: Response) => {
    try {
      const request = normalizePreviewRequest(req.query);
      res.status(200).type('html').send(createPreviewFrameHtml(request));
    } catch (error) {
      logger.error('Failed to create component preview frame', error);
      const response = previewErrorResponse(error, 'Failed to create component preview frame');
      res.status(response.status).json({
        success: false,
        error: {
          message: response.message,
          code: response.code,
        },
      });
    }
  });

  router.get('/runtime', async (req: Request, res: Response) => {
    try {
      const request = normalizePreviewRequest(req.query);
      const runtimeModule = await createPreviewRuntimeModule(getWorkingDirectory(), request);
      res.status(200).type('application/javascript').send(runtimeModule);
    } catch (error) {
      logger.error('Failed to create component preview runtime', error);
      const response = previewErrorResponse(error, 'Failed to create component preview runtime');
      res.status(response.status).json({
        success: false,
        error: {
          message: response.message,
          code: response.code,
        },
      });
    }
  });

  router.get('/component/:componentPath', async (req: Request, res: Response) => {
    try {
      const request = normalizePreviewRequest({ componentPath: req.params.componentPath });
      const componentModule = createPreviewComponentImportModule(request.componentPath);
      res.status(200).type('application/javascript').send(componentModule);
    } catch (error) {
      logger.error('Failed to create component preview import module', error);
      const response = previewErrorResponse(
        error,
        'Failed to create component preview import module'
      );
      res.status(response.status).json({
        success: false,
        error: {
          message: response.message,
          code: response.code,
        },
      });
    }
  });

  return router;
}

const router = Router();
router.use(createPreviewApiRouter());
router.use(createPreviewBrowserRouter());

export default router;
