import { type Request, type Response, Router } from 'express';
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
import { logger } from '../utils/logger.js';
import { validateCustomPath } from '../utils/validation.js';

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
    res.json({
      component: await getComponentLibraryDetail(getWorkingDirectory(), req.params.identifier),
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

function readName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const name = (body as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

router.post('/library/:identifier/rename', async (req: Request, res: Response) => {
  try {
    const name = readName(req.body);
    if (!name) throw new ComponentLibraryValidationError('Name is required.');
    res.json({
      result: await renameComponentLibraryItem(getWorkingDirectory(), req.params.identifier, name),
    });
  } catch (error) {
    logger.error(`Failed to rename component: ${req.params.identifier}`, error);
    const response = componentLibraryErrorResponse(error, 'Failed to rename component');
    res.status(response.status).json({ success: false, error: response });
  }
});

router.post('/library/:identifier/fork', async (req: Request, res: Response) => {
  try {
    const name = readName(req.body);
    if (!name) throw new ComponentLibraryValidationError('Name is required.');
    res.json({
      result: await forkComponentLibraryItem(getWorkingDirectory(), req.params.identifier, name),
    });
  } catch (error) {
    logger.error(`Failed to fork component: ${req.params.identifier}`, error);
    const response = componentLibraryErrorResponse(error, 'Failed to fork component');
    res.status(response.status).json({ success: false, error: response });
  }
});

router.post('/library/:identifier/detach', async (req: Request, res: Response) => {
  try {
    res.json({
      result: await detachComponentLibraryItem(getWorkingDirectory(), req.params.identifier),
    });
  } catch (error) {
    logger.error(`Failed to detach component: ${req.params.identifier}`, error);
    const response = componentLibraryErrorResponse(error, 'Failed to detach component');
    res.status(response.status).json({ success: false, error: response });
  }
});

router.post('/library/:identifier/reset', async (req: Request, res: Response) => {
  try {
    res.json({
      result: await resetComponentLibraryItem(getWorkingDirectory(), req.params.identifier),
    });
  } catch (error) {
    logger.error(`Failed to reset component: ${req.params.identifier}`, error);
    const response = componentLibraryErrorResponse(error, 'Failed to reset component');
    res.status(response.status).json({ success: false, error: response });
  }
});

router.get('/library/:identifier/compare', async (req: Request, res: Response) => {
  try {
    res.json({
      compare: await compareComponentLibraryItem(getWorkingDirectory(), req.params.identifier),
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

export default router;
