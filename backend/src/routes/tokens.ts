import path from 'node:path';
import { type Request, type Response, Router } from 'express';
import {
  applyTokenPatch,
  createEmptyTokenMap,
  createFrequencyReport,
  createInconsistencyReport,
  createTokenSet,
  deleteTokenSet,
  extractTokenCandidates,
  getComponentOverrides,
  getTokenSet,
  listTokenSets,
  previewTokenPatch,
  putComponentOverrides,
  updateTokenSet,
} from '../services/tokens.js';
import type { ComponentTokenOverride, DesignTokenMap } from '../types/index.js';
import { logger } from '../utils/logger.js';
import {
  isSafeTokenName,
  isSafeTokenSetId,
  isTokenCategory,
  validateTokenComponentPath,
  validateTokenComponentPaths,
  validateTokenPatchChanges,
} from '../utils/validation.js';

const router = Router();
const PROJECT_DIR = path.resolve(process.cwd(), '..');

function sendValidation(res: Response, message: string): void {
  res.status(400).json({
    success: false,
    error: { message, code: 'VALIDATION_ERROR' },
  });
}

function validateTokenMap(value: unknown): DesignTokenMap | null {
  const map = { ...createEmptyTokenMap() };
  if (value === undefined) {
    return map;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  for (const [category, tokens] of Object.entries(value as Record<string, unknown>)) {
    if (!isTokenCategory(category) || typeof tokens !== 'object' || tokens === null) {
      return null;
    }
    for (const [name, token] of Object.entries(tokens as Record<string, unknown>)) {
      if (!isSafeTokenName(name) || typeof token !== 'object' || token === null) {
        return null;
      }
      const candidate = token as Record<string, unknown>;
      if (
        typeof candidate.value !== 'string' ||
        (candidate.name !== undefined && typeof candidate.name !== 'string')
      ) {
        return null;
      }
      map[category][name] = {
        name: typeof candidate.name === 'string' ? candidate.name : name,
        category,
        value: candidate.value,
        description: typeof candidate.description === 'string' ? candidate.description : undefined,
        aliases: Array.isArray(candidate.aliases)
          ? candidate.aliases.filter((alias): alias is string => typeof alias === 'string')
          : undefined,
        createdAt:
          typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
        updatedAt:
          typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
      };
    }
  }

  return map;
}

router.get('/sets', async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, tokenSets: await listTokenSets() });
  } catch (error) {
    logger.error('Failed to list token sets', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to list token sets', code: 'TOKEN_SET_LIST_ERROR' },
    });
  }
});

router.post('/sets', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    if (body.id !== undefined && (typeof body.id !== 'string' || !isSafeTokenSetId(body.id))) {
      sendValidation(res, 'Invalid token set ID');
      return;
    }
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      sendValidation(res, 'Token set name is required');
      return;
    }
    const tokens = validateTokenMap(body.tokens);
    if (!tokens) {
      sendValidation(res, 'Invalid token map');
      return;
    }

    const tokenSet = await createTokenSet({
      id: typeof body.id === 'string' ? body.id : undefined,
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : undefined,
      tokens,
    });
    res.status(201).json({ success: true, tokenSet });
  } catch (error) {
    logger.error('Failed to create token set', error);
    res.status(409).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to create token set',
        code: 'TOKEN_SET_CONFLICT',
      },
    });
  }
});

router.get('/sets/:id', async (req: Request, res: Response) => {
  try {
    if (!isSafeTokenSetId(req.params.id)) {
      sendValidation(res, 'Invalid token set ID');
      return;
    }
    const tokenSet = await getTokenSet(req.params.id);
    if (!tokenSet) {
      res.status(404).json({
        success: false,
        error: { message: 'Token set not found', code: 'TOKEN_SET_NOT_FOUND' },
      });
      return;
    }
    res.json({ success: true, tokenSet });
  } catch (error) {
    logger.error(`Failed to get token set ${req.params.id}`, error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get token set', code: 'TOKEN_SET_GET_ERROR' },
    });
  }
});

router.put('/sets/:id', async (req: Request, res: Response) => {
  try {
    if (!isSafeTokenSetId(req.params.id)) {
      sendValidation(res, 'Invalid token set ID');
      return;
    }
    const body = req.body as Record<string, unknown>;
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      sendValidation(res, 'Token set name is required');
      return;
    }
    const tokens = validateTokenMap(body.tokens);
    if (!tokens) {
      sendValidation(res, 'Invalid token map');
      return;
    }
    const tokenSet = await updateTokenSet(req.params.id, {
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : undefined,
      tokens,
    });
    if (!tokenSet) {
      res.status(404).json({
        success: false,
        error: { message: 'Token set not found', code: 'TOKEN_SET_NOT_FOUND' },
      });
      return;
    }
    res.json({ success: true, tokenSet });
  } catch (error) {
    logger.error(`Failed to update token set ${req.params.id}`, error);
    res.status(409).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to update token set',
        code: 'TOKEN_SET_CONFLICT',
      },
    });
  }
});

router.delete('/sets/:id', async (req: Request, res: Response) => {
  try {
    if (!isSafeTokenSetId(req.params.id)) {
      sendValidation(res, 'Invalid token set ID');
      return;
    }
    const deleted = await deleteTokenSet(req.params.id);
    if (!deleted) {
      res.status(404).json({
        success: false,
        error: { message: 'Token set not found', code: 'TOKEN_SET_NOT_FOUND' },
      });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    logger.error(`Failed to delete token set ${req.params.id}`, error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete token set', code: 'TOKEN_SET_DELETE_ERROR' },
    });
  }
});

router.post('/extract', async (req: Request, res: Response) => {
  const validation = validateTokenComponentPaths(req.body?.componentPaths, PROJECT_DIR);
  if (!validation.valid) {
    sendValidation(res, validation.error || 'Invalid component paths');
    return;
  }
  res.json({ success: true, candidates: await extractTokenCandidates(validation.value) });
});

router.get('/reports/frequency', async (req: Request, res: Response) => {
  const componentPaths =
    typeof req.query.componentPath === 'string' ? [req.query.componentPath] : undefined;
  const validation = validateTokenComponentPaths(componentPaths, PROJECT_DIR);
  if (!validation.valid) {
    sendValidation(res, validation.error || 'Invalid component paths');
    return;
  }
  res.json({ success: true, report: await createFrequencyReport(validation.value) });
});

router.get('/reports/inconsistencies', async (req: Request, res: Response) => {
  const componentPaths =
    typeof req.query.componentPath === 'string' ? [req.query.componentPath] : undefined;
  const validation = validateTokenComponentPaths(componentPaths, PROJECT_DIR);
  if (!validation.valid) {
    sendValidation(res, validation.error || 'Invalid component paths');
    return;
  }
  res.json({ success: true, report: await createInconsistencyReport(validation.value) });
});

router.post('/patch/preview', async (req: Request, res: Response) => {
  const paths = validateTokenComponentPaths(req.body?.componentPaths, PROJECT_DIR);
  const changes = validateTokenPatchChanges(req.body?.changes);
  if (!paths.valid || !paths.value || !changes.valid || !changes.value) {
    sendValidation(res, paths.error || changes.error || 'Invalid patch payload');
    return;
  }
  const result = await previewTokenPatch(paths.value, changes.value);
  res.json({ success: true, ...result });
});

router.post('/patch/apply', async (req: Request, res: Response) => {
  const paths = validateTokenComponentPaths(req.body?.componentPaths, PROJECT_DIR);
  const changes = validateTokenPatchChanges(req.body?.changes);
  if (
    typeof req.body?.tokenSetId !== 'string' ||
    !isSafeTokenSetId(req.body.tokenSetId) ||
    !paths.valid ||
    !paths.value ||
    !changes.valid ||
    !changes.value
  ) {
    sendValidation(res, paths.error || changes.error || 'Invalid patch payload');
    return;
  }
  const result = await applyTokenPatch({
    tokenSetId: req.body.tokenSetId,
    componentPaths: paths.value,
    changes: changes.value,
    createBackup: typeof req.body.createBackup === 'boolean' ? req.body.createBackup : true,
    recordOverrides:
      typeof req.body.recordOverrides === 'boolean' ? req.body.recordOverrides : false,
  });
  res.status(result.success ? 200 : 500).json(result);
});

router.get('/components/:componentPath/overrides', async (req: Request, res: Response) => {
  const validation = validateTokenComponentPath(req.params.componentPath, PROJECT_DIR);
  if (!validation.valid || !validation.value) {
    sendValidation(res, validation.error || 'Invalid component path');
    return;
  }
  res.json({ success: true, overrides: await getComponentOverrides(validation.value) });
});

router.put('/components/:componentPath/overrides', async (req: Request, res: Response) => {
  const validation = validateTokenComponentPath(req.params.componentPath, PROJECT_DIR);
  if (!validation.valid || !validation.value || !Array.isArray(req.body?.overrides)) {
    sendValidation(res, validation.error || 'Invalid overrides payload');
    return;
  }
  const overrides = req.body.overrides as ComponentTokenOverride[];
  res.json({
    success: true,
    overrides: await putComponentOverrides(validation.value, overrides),
  });
});

export default router;
