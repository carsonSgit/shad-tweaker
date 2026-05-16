import { type NextFunction, type Request, type Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  ComponentLibraryConflictError,
  ComponentLibraryNotFoundError,
  ComponentLibraryValidationError,
  compareComponentLibraryItem,
  detachComponentLibraryItem,
  findComponentLibraryDuplicates,
  forkComponentLibraryItem,
  getComponentLibraryDetail,
  listComponentLibrary,
  renameComponentLibraryItem,
  resetComponentLibraryItem,
} from '../services/componentLibrary.js';
import {
  getCachedComponents,
  getComponentByName,
  getComponentsWithContent,
  getWorkingDirectory,
  scanComponents,
} from '../services/scanner.js';
import { createInvalidComponentIdentifierError } from '../utils/componentIdentifier.js';
import { logger } from '../utils/logger.js';
import { readPositiveInteger } from '../utils/numbers.js';
import {
  hasUnsafeComponentIdentifierUrl,
  readComponentIdentifier,
  validateCustomPath,
} from '../utils/validation.js';

const router = Router();

function componentLibraryErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ComponentLibraryNotFoundError) {
    return { status: 404, message: error.message, code: error.code };
  }
  if (error instanceof ComponentLibraryValidationError) {
    return { status: 400, message: error.message, code: error.code };
  }
  if (error instanceof ComponentLibraryConflictError) {
    return { status: 409, message: error.message, code: error.code };
  }
  const message = error instanceof Error ? error.message : fallback;
  return { status: 500, message, code: 'COMPONENT_LIBRARY_ERROR' };
}

function sendComponentLibraryError(
  res: Response,
  response: ReturnType<typeof componentLibraryErrorResponse>
): void {
  res.status(response.status).json({
    success: false,
    error: {
      message: response.message,
      code: response.code,
    },
  });
}

function invalidComponentIdentifierResponse(): ReturnType<typeof componentLibraryErrorResponse> {
  return componentLibraryErrorResponse(
    createInvalidComponentIdentifierError(),
    'Invalid component identifier'
  );
}

export function createComponentLibraryMutationLimiter(
  max = readPositiveInteger(process.env.COMPONENT_LIBRARY_MUTATION_RATE_LIMIT_PER_MINUTE, 60)
) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        message: 'Too many component library requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
      },
    },
  });
}

const componentLibraryMutationLimiter = createComponentLibraryMutationLimiter();

router.use('/library', (req, res, next) => {
  if (hasUnsafeComponentIdentifierUrl(req.originalUrl)) {
    sendComponentLibraryError(res, invalidComponentIdentifierResponse());
    return;
  }

  next();
});

router.get('/library/inventory', async (_req: Request, res: Response) => {
  try {
    res.json({ components: await listComponentLibrary(getWorkingDirectory()) });
  } catch (error) {
    logger.error('Failed to list component library inventory', error);
    const response = componentLibraryErrorResponse(error, 'Failed to list component library');
    res.status(response.status).json({
      success: false,
      error: {
        message: response.message,
        code: response.code,
      },
    });
  }
});

router.get('/library/duplicates', async (_req: Request, res: Response) => {
  try {
    res.json({ duplicates: await findComponentLibraryDuplicates(getWorkingDirectory()) });
  } catch (error) {
    logger.error('Failed to detect component library duplicates', error);
    const response = componentLibraryErrorResponse(error, 'Failed to detect duplicates');
    res.status(response.status).json({
      success: false,
      error: {
        message: response.message,
        code: response.code,
      },
    });
  }
});

router.get('/library/detail/:identifier', async (req: Request, res: Response) => {
  try {
    const identifier = readComponentIdentifier(req.params.identifier);
    if (!identifier) {
      sendComponentLibraryError(res, invalidComponentIdentifierResponse());
      return;
    }

    res.json({
      component: await getComponentLibraryDetail(getWorkingDirectory(), identifier),
    });
  } catch (error) {
    logger.error(`Failed to get component library detail: ${req.params.identifier}`, error);
    const response = componentLibraryErrorResponse(error, 'Failed to get component detail');
    res.status(response.status).json({
      success: false,
      error: {
        message: response.message,
        code: response.code,
      },
    });
  }
});

router.get('/library/detail/*', async (_req: Request, res: Response) => {
  sendComponentLibraryError(res, invalidComponentIdentifierResponse());
});

router.get('/library', async (_req: Request, res: Response) => {
  sendComponentLibraryError(res, invalidComponentIdentifierResponse());
});

function readName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const name = (body as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

router.post(
  '/library/:identifier/rename',
  componentLibraryMutationLimiter,
  async (req: Request, res: Response) => {
    try {
      const identifier = readComponentIdentifier(req.params.identifier);
      if (!identifier) {
        sendComponentLibraryError(res, invalidComponentIdentifierResponse());
        return;
      }

      const name = readName(req.body);
      if (!name) throw new ComponentLibraryValidationError('Name is required.');
      res.json({
        result: await renameComponentLibraryItem(getWorkingDirectory(), identifier, name),
      });
    } catch (error) {
      logger.error(`Failed to rename component: ${req.params.identifier}`, error);
      const response = componentLibraryErrorResponse(error, 'Failed to rename component');
      res.status(response.status).json({ success: false, error: response });
    }
  }
);

router.post(
  '/library/:identifier/fork',
  componentLibraryMutationLimiter,
  async (req: Request, res: Response) => {
    try {
      const identifier = readComponentIdentifier(req.params.identifier);
      if (!identifier) {
        sendComponentLibraryError(res, invalidComponentIdentifierResponse());
        return;
      }

      const name = readName(req.body);
      if (!name) throw new ComponentLibraryValidationError('Name is required.');
      res.json({
        result: await forkComponentLibraryItem(getWorkingDirectory(), identifier, name),
      });
    } catch (error) {
      logger.error(`Failed to fork component: ${req.params.identifier}`, error);
      const response = componentLibraryErrorResponse(error, 'Failed to fork component');
      res.status(response.status).json({ success: false, error: response });
    }
  }
);

router.post(
  '/library/:identifier/detach',
  componentLibraryMutationLimiter,
  async (req: Request, res: Response) => {
    try {
      const identifier = readComponentIdentifier(req.params.identifier);
      if (!identifier) {
        sendComponentLibraryError(res, invalidComponentIdentifierResponse());
        return;
      }

      res.json({
        result: await detachComponentLibraryItem(getWorkingDirectory(), identifier),
      });
    } catch (error) {
      logger.error(`Failed to detach component: ${req.params.identifier}`, error);
      const response = componentLibraryErrorResponse(error, 'Failed to detach component');
      res.status(response.status).json({ success: false, error: response });
    }
  }
);

router.post(
  '/library/:identifier/reset',
  componentLibraryMutationLimiter,
  async (req: Request, res: Response) => {
    try {
      const identifier = readComponentIdentifier(req.params.identifier);
      if (!identifier) {
        sendComponentLibraryError(res, invalidComponentIdentifierResponse());
        return;
      }

      res.json({
        result: await resetComponentLibraryItem(getWorkingDirectory(), identifier),
      });
    } catch (error) {
      logger.error(`Failed to reset component: ${req.params.identifier}`, error);
      const response = componentLibraryErrorResponse(error, 'Failed to reset component');
      res.status(response.status).json({ success: false, error: response });
    }
  }
);

router.get('/library/:identifier/compare', async (req: Request, res: Response) => {
  try {
    const identifier = readComponentIdentifier(req.params.identifier);
    if (!identifier) {
      sendComponentLibraryError(res, invalidComponentIdentifierResponse());
      return;
    }

    res.json({
      compare: await compareComponentLibraryItem(getWorkingDirectory(), identifier),
    });
  } catch (error) {
    logger.error(`Failed to compare component: ${req.params.identifier}`, error);
    const response = componentLibraryErrorResponse(error, 'Failed to compare component');
    res.status(response.status).json({ success: false, error: response });
  }
});

router.get('/scan', async (req: Request, res: Response) => {
  try {
    const customPath = req.query.path as string | undefined;
    const basePath = getWorkingDirectory();

    // Validate custom path to prevent path traversal attacks
    if (customPath) {
      const pathValidation = validateCustomPath(customPath);
      if (!pathValidation.valid) {
        res.status(400).json({
          success: false,
          error: {
            message: pathValidation.error || 'Invalid path',
            code: 'PATH_TRAVERSAL_ERROR',
          },
        });
        return;
      }
    }

    const result = await scanComponents(basePath, customPath);

    if (!result.success) {
      res.status(404).json({
        success: false,
        error: {
          message: 'No shadcn components directory found',
          code: 'COMPONENTS_NOT_FOUND',
        },
      });
      return;
    }

    res.json(result);
  } catch (error) {
    logger.error('Failed to scan components', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to scan components',
        code: 'SCAN_ERROR',
      },
    });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const cached = getCachedComponents();

    if (cached.length === 0) {
      res.json({
        components: [],
        message: 'No components cached. Call GET /api/components/scan first.',
      });
      return;
    }

    const components = await getComponentsWithContent();

    res.json({ components });
  } catch (error) {
    logger.error('Failed to get components', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get components',
        code: 'GET_COMPONENTS_ERROR',
      },
    });
  }
});

router.get('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const component = await getComponentByName(name);

    if (!component) {
      res.status(404).json({
        success: false,
        error: {
          message: `Component not found: ${name}`,
          code: 'COMPONENT_NOT_FOUND',
        },
      });
      return;
    }

    res.json(component);
  } catch (error) {
    logger.error(`Failed to get component: ${req.params.name}`, error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to get component',
        code: 'GET_COMPONENT_ERROR',
      },
    });
  }
});

router.use((error: Error, _req: Request, res: Response, next: NextFunction): void => {
  if (error instanceof URIError) {
    sendComponentLibraryError(res, invalidComponentIdentifierResponse());
    return;
  }

  next(error);
});

export default router;
