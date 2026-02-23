import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import type { Preview } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { escapeRegExpLiteral, validateRegex } from '../utils/validation.js';
import { createBackup } from './backup.js';
import { createPreview } from './differ.js';

/**
 * Generates a unique temporary file name using crypto.randomUUID
 * to prevent race conditions when multiple requests modify files concurrently.
 */
function generateTempFileName(originalPath: string): string {
  const uuid = crypto.randomUUID();
  const baseName = path.basename(originalPath);
  return path.join(os.tmpdir(), `shadcn-tweaker-${uuid}-${baseName}`);
}

export interface ModifyResult {
  success: boolean;
  modified: string[];
  changes: number;
  backupId?: string;
  errors?: Array<{ path: string; error: string; code?: string }>;
}

function compileSearchPattern(
  find: string,
  isRegex: boolean
): { pattern: RegExp | null; error?: string } {
  if (find.length === 0) {
    return { pattern: null, error: 'find pattern must not be empty' };
  }

  if (isRegex) {
    const validation = validateRegex(find);
    if (!validation.valid) {
      return { pattern: null, error: validation.error || 'Invalid regex pattern' };
    }

    return { pattern: new RegExp(find, 'g') };
  }

  return { pattern: new RegExp(escapeRegExpLiteral(find), 'g') };
}

export async function previewChanges(
  componentPaths: string[],
  find: string,
  replace: string,
  isRegex: boolean
): Promise<{ previews: Preview[]; totalChanges: number }> {
  const previews: Preview[] = [];
  let totalChanges = 0;
  const { pattern: searchPattern, error } = compileSearchPattern(find, isRegex);

  if (error || !searchPattern) {
    return { previews, totalChanges };
  }

  for (const filePath of componentPaths) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      let newContent: string;
      let matchCount: number;

      if (isRegex) {
        const matches = content.match(searchPattern);
        matchCount = matches ? matches.length : 0;
        newContent = content.replace(searchPattern, replace);
      } else {
        const matches = content.match(searchPattern);
        matchCount = matches ? matches.length : 0;
        newContent = content.split(find).join(replace);
      }

      if (matchCount > 0) {
        previews.push(createPreview(filePath, content, newContent));
        totalChanges += matchCount;
      }
    } catch (error) {
      logger.error(`Failed to preview changes for ${filePath}`, error);
    }
  }

  return { previews, totalChanges };
}

export async function applyChanges(
  componentPaths: string[],
  find: string,
  replace: string,
  isRegex: boolean,
  shouldBackup = true
): Promise<ModifyResult> {
  const modified: string[] = [];
  const errors: Array<{ path: string; error: string; code?: string }> = [];
  let totalChanges = 0;
  let backupId: string | undefined;
  const { pattern: searchPattern, error: patternError } = compileSearchPattern(find, isRegex);

  if (patternError || !searchPattern) {
    return {
      success: false,
      modified,
      changes: totalChanges,
      errors: [
        {
          path: 'pattern',
          error: patternError || 'Invalid pattern',
          code: 'INVALID_REGEX',
        },
      ],
    };
  }

  if (shouldBackup) {
    try {
      const backup = await createBackup(componentPaths);
      backupId = backup.id;
    } catch (error) {
      logger.error('Failed to create backup', error);
      return {
        success: false,
        modified: [],
        changes: 0,
        errors: [
          {
            path: 'backup',
            error: 'Failed to create backup before modifications',
            code: 'BACKUP_CREATE_ERROR',
          },
        ],
      };
    }
  }

  for (const filePath of componentPaths) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      let newContent: string;
      let matchCount: number;

      if (isRegex) {
        const matches = content.match(searchPattern);
        matchCount = matches ? matches.length : 0;
        newContent = content.replace(searchPattern, replace);
      } else {
        const matches = content.match(searchPattern);
        matchCount = matches ? matches.length : 0;
        newContent = content.split(find).join(replace);
      }

      if (matchCount > 0) {
        // Use UUID-based temp file name to prevent race conditions
        const tempPath = generateTempFileName(filePath);
        await fs.writeFile(tempPath, newContent, 'utf-8');
        await fs.move(tempPath, filePath, { overwrite: true });

        modified.push(filePath);
        totalChanges += matchCount;
        logger.info(`Modified ${filePath}: ${matchCount} changes`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ path: filePath, error: errorMessage, code: 'FILE_MODIFY_ERROR' });
      logger.error(`Failed to modify ${filePath}`, error);
    }
  }

  return {
    success: errors.length === 0,
    modified,
    changes: totalChanges,
    backupId,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export interface BatchAction {
  name: string;
  find: string;
  replace: string;
  isRegex: boolean;
}

interface BatchActionResult {
  action: BatchAction | null;
  error?: string;
  code?: string;
}

const BATCH_ACTIONS: Record<string, (options?: Record<string, string>) => BatchAction> = {
  'remove-cursor-pointer': () => ({
    name: 'Remove cursor-pointer',
    find: '\\s*cursor-pointer',
    replace: '',
    isRegex: true,
  }),
  'add-focus-rings': () => ({
    name: 'Add focus rings',
    find: 'focus:outline-none',
    replace:
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isRegex: false,
  }),
  'update-border-radius': () => ({
    name: 'Update border radius',
    find: 'rounded-md',
    replace: 'rounded-lg',
    isRegex: false,
  }),
  'remove-class': () => ({
    name: 'Remove class',
    find: '',
    replace: '',
    isRegex: true,
  }),
  'replace-class': (options) => ({
    name: `Replace ${options?.from || ''} with ${options?.to || ''}`,
    find: options?.from || '',
    replace: options?.to || '',
    isRegex: false,
  }),
};

export function getBatchAction(
  actionName: string,
  options?: Record<string, string>
): BatchActionResult {
  const actionFn = BATCH_ACTIONS[actionName];
  if (!actionFn) {
    return {
      action: null,
      error: `Unknown batch action: ${actionName}`,
      code: 'UNKNOWN_BATCH_ACTION',
    };
  }

  if (actionName === 'remove-class') {
    const className = options?.className?.trim();
    if (!className) {
      return {
        action: null,
        error: 'remove-class requires options.className',
        code: 'BATCH_ACTION_INVALID_OPTIONS',
      };
    }

    const safeClass = escapeRegExpLiteral(className);
    const pattern = `\\s*${safeClass}`;
    const validation = validateRegex(pattern);
    if (!validation.valid) {
      return {
        action: null,
        error: validation.error || 'Invalid className pattern',
        code: 'INVALID_REGEX',
      };
    }

    return {
      action: {
        name: `Remove class: ${className}`,
        find: pattern,
        replace: '',
        isRegex: true,
      },
    };
  }

  return { action: actionFn(options) };
}

export async function applyBatchAction(
  actionName: string,
  componentPaths: string[],
  options?: Record<string, string>
): Promise<ModifyResult> {
  const actionResult = getBatchAction(actionName, options);

  if (!actionResult.action) {
    return {
      success: false,
      modified: [],
      changes: 0,
      errors: [
        {
          path: 'action',
          error: actionResult.error || `Unknown batch action: ${actionName}`,
          code: actionResult.code || 'UNKNOWN_BATCH_ACTION',
        },
      ],
    };
  }

  const action = actionResult.action;
  return applyChanges(componentPaths, action.find, action.replace, action.isRegex, true);
}
