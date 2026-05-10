import { type Request, type Response, Router } from 'express';
import {
  applyTokenPatch,
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
  TokenSetConflictError,
  updateTokenSet,
} from '../services/tokens.js';
import { getWorkingDirectory } from '../services/workspace.js';
import type { ComponentTokenOverride, DesignTokenMap } from '../types/index.js';
import { logger } from '../utils/logger.js';
import {
  createEmptyTokenMap,
  isSafeTokenName,
  isSafeTokenSetId,
  isTokenCategory,
  validateTokenComponentPath,
  validateTokenComponentPaths,
  validateTokenPatchChanges,
} from '../utils/validation.js';

const router = Router();

function sendValidation(res: Response, message: string): void {
  res.status(400).json({
    success: false,
    error: { message, code: 'VALIDATION_ERROR' },
  });
}

function sendServerError(res: Response, message: string, code: string): void {
  res.status(500).json({
    success: false,
    error: { message, code },
  });
}

function isTokenSetConflict(error: unknown): boolean {
  return error instanceof TokenSetConflictError;
}

async function sendComponentOverridesForPath(
  res: Response,
  componentPathValue: unknown,
  overridesValue?: unknown
): Promise<void> {
  const validation = validateTokenComponentPath(componentPathValue, getWorkingDirectory());
  if (!validation.valid || !validation.value) {
    sendValidation(res, validation.error || 'Invalid component path');
    return;
  }

  if (overridesValue === undefined) {
    res.json({ success: true, overrides: await getComponentOverrides(validation.value) });
    return;
  }

  const overrides = validateComponentTokenOverrides(overridesValue);
  if (!overrides) {
    sendValidation(res, 'Invalid overrides payload');
    return;
  }

  await sendComponentOverrides(res, validation.value, overrides);
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

type ComponentTokenOverrideInput = Omit<ComponentTokenOverride, 'componentPath'>;

function validateComponentTokenOverrides(value: unknown): ComponentTokenOverrideInput[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const overrides: ComponentTokenOverrideInput[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }

    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.tokenSetId !== 'string' || !isSafeTokenSetId(candidate.tokenSetId)) {
      return null;
    }
    if (
      typeof candidate.overrides !== 'object' ||
      candidate.overrides === null ||
      Array.isArray(candidate.overrides)
    ) {
      return null;
    }

    const normalized: ComponentTokenOverride['overrides'] = {};
    for (const [category, tokens] of Object.entries(
      candidate.overrides as Record<string, unknown>
    )) {
      if (!isTokenCategory(category) || typeof tokens !== 'object' || tokens === null) {
        return null;
      }
      const normalizedTokens: Record<string, string> = {};
      for (const [tokenName, tokenValue] of Object.entries(tokens as Record<string, unknown>)) {
        if (
          !isSafeTokenName(tokenName) ||
          typeof tokenValue !== 'string' ||
          tokenValue.length > 256
        ) {
          return null;
        }
        normalizedTokens[tokenName] = tokenValue;
      }
      normalized[category] = normalizedTokens;
    }

    overrides.push({
      tokenSetId: candidate.tokenSetId,
      overrides: normalized,
    });
  }

  return overrides;
}

async function sendComponentOverrides(
  res: Response,
  componentPath: string,
  overrides: ComponentTokenOverrideInput[]
): Promise<void> {
  const tokenSetIds = new Set((await listTokenSets()).map((tokenSet) => tokenSet.id));
  for (const override of overrides) {
    if (!tokenSetIds.has(override.tokenSetId)) {
      sendValidation(res, `Unknown token set: ${override.tokenSetId}`);
      return;
    }
  }
  res.json({
    success: true,
    overrides: await putComponentOverrides(
      componentPath,
      overrides.map((override) => ({ ...override, componentPath }))
    ),
  });
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
    const conflict = isTokenSetConflict(error);
    res.status(conflict ? 409 : 500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to create token set',
        code: conflict ? 'TOKEN_SET_CONFLICT' : 'TOKEN_SET_CREATE_ERROR',
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
    const conflict = isTokenSetConflict(error);
    res.status(conflict ? 409 : 500).json({
      success: false,
      error: {
        message: error instanceof Error ? error.message : 'Failed to update token set',
        code: conflict ? 'TOKEN_SET_CONFLICT' : 'TOKEN_SET_UPDATE_ERROR',
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
  try {
    const validation = validateTokenComponentPaths(req.body?.componentPaths, getWorkingDirectory());
    if (!validation.valid) {
      sendValidation(res, validation.error || 'Invalid component paths');
      return;
    }
    res.json({ success: true, candidates: await extractTokenCandidates(validation.value) });
  } catch (error) {
    logger.error('Failed to extract token candidates', error);
    sendServerError(res, 'Failed to extract token candidates', 'TOKEN_EXTRACT_ERROR');
  }
});

router.get('/reports/frequency', async (req: Request, res: Response) => {
  try {
    const componentPaths =
      typeof req.query.componentPath === 'string' ? [req.query.componentPath] : undefined;
    const validation = validateTokenComponentPaths(componentPaths, getWorkingDirectory());
    if (!validation.valid) {
      sendValidation(res, validation.error || 'Invalid component paths');
      return;
    }
    res.json({ success: true, report: await createFrequencyReport(validation.value) });
  } catch (error) {
    logger.error('Failed to create token frequency report', error);
    sendServerError(res, 'Failed to create token frequency report', 'TOKEN_FREQUENCY_REPORT_ERROR');
  }
});

router.get('/reports/inconsistencies', async (req: Request, res: Response) => {
  try {
    const componentPaths =
      typeof req.query.componentPath === 'string' ? [req.query.componentPath] : undefined;
    const validation = validateTokenComponentPaths(componentPaths, getWorkingDirectory());
    if (!validation.valid) {
      sendValidation(res, validation.error || 'Invalid component paths');
      return;
    }
    res.json({ success: true, report: await createInconsistencyReport(validation.value) });
  } catch (error) {
    logger.error('Failed to create token inconsistency report', error);
    sendServerError(
      res,
      'Failed to create token inconsistency report',
      'TOKEN_INCONSISTENCY_REPORT_ERROR'
    );
  }
});

router.post('/patch/preview', async (req: Request, res: Response) => {
  try {
    const paths = validateTokenComponentPaths(req.body?.componentPaths, getWorkingDirectory());
    const changes = validateTokenPatchChanges(req.body?.changes);
    if (!paths.valid || !paths.value || !changes.valid || !changes.value) {
      sendValidation(res, paths.error || changes.error || 'Invalid patch payload');
      return;
    }
    const result = await previewTokenPatch(paths.value, changes.value);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Failed to preview token patch', error);
    sendServerError(res, 'Failed to preview token patch', 'TOKEN_PATCH_PREVIEW_ERROR');
  }
});

router.post('/patch/apply', async (req: Request, res: Response) => {
  try {
    const paths = validateTokenComponentPaths(req.body?.componentPaths, getWorkingDirectory());
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
    if (!(await getTokenSet(req.body.tokenSetId))) {
      sendValidation(res, `Unknown token set: ${req.body.tokenSetId}`);
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
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error('Failed to apply token patch', error);
    sendServerError(res, 'Failed to apply token patch', 'TOKEN_PATCH_APPLY_ERROR');
  }
});

router.get('/components/overrides', async (req: Request, res: Response) => {
  try {
    await sendComponentOverridesForPath(res, req.query.componentPath);
  } catch (error) {
    logger.error('Failed to get component token overrides', error);
    sendServerError(res, 'Failed to get component token overrides', 'TOKEN_OVERRIDES_GET_ERROR');
  }
});

router.put('/components/overrides', async (req: Request, res: Response) => {
  try {
    await sendComponentOverridesForPath(res, req.body?.componentPath, req.body?.overrides);
  } catch (error) {
    logger.error('Failed to update component token overrides', error);
    sendServerError(
      res,
      'Failed to update component token overrides',
      'TOKEN_OVERRIDES_UPDATE_ERROR'
    );
  }
});

export default router;
