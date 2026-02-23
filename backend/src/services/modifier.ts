import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import type { Preview } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { escapeRegExpLiteral } from '../utils/validation.js';
import { createBackup } from './backup.js';
import { createPreview } from './differ.js';

export interface ModifyResult {
  success: boolean;
  modified: string[];
  changes: number;
  backupId?: string;
  errors?: Array<{ path: string; error: string; code?: string }>;
}

type SearchPlan =
  | { mode: 'literal'; needle: string }
  | { mode: 'remove-class-token'; className: string };

function countLiteralOccurrences(content: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let start = 0;
  while (start <= content.length - needle.length) {
    const index = content.indexOf(needle, start);
    if (index === -1) {
      break;
    }
    count += 1;
    start = index + needle.length;
  }

  return count;
}

function isWhitespace(value: string): boolean {
  return value === ' ' || value === '\t' || value === '\n' || value === '\r' || value === '\f' || value === '\v';
}

function removeClassToken(content: string, className: string): { nextContent: string; matchCount: number } {
  if (!className) {
    return { nextContent: content, matchCount: 0 };
  }

  let cursor = 0;
  let matchCount = 0;
  let output = '';

  while (cursor < content.length) {
    const index = content.indexOf(className, cursor);
    if (index === -1) {
      output += content.slice(cursor);
      break;
    }

    const tokenStart = index;
    const tokenEnd = index + className.length;
    const prevChar = tokenStart > 0 ? content[tokenStart - 1] : '';
    const nextChar = tokenEnd < content.length ? content[tokenEnd] : '';
    const hasBoundaryBefore = tokenStart === 0 || isWhitespace(prevChar);
    const hasBoundaryAfter =
      tokenEnd === content.length ||
      isWhitespace(nextChar) ||
      nextChar === '"' ||
      nextChar === '\'' ||
      nextChar === '`' ||
      nextChar === '}';

    if (!hasBoundaryBefore || !hasBoundaryAfter) {
      output += content.slice(cursor, tokenEnd);
      cursor = tokenEnd;
      continue;
    }

    let trimStart = tokenStart;
    while (trimStart > cursor && isWhitespace(content[trimStart - 1])) {
      trimStart -= 1;
    }

    output += content.slice(cursor, trimStart);
    cursor = tokenEnd;
    matchCount += 1;
  }

  return { nextContent: output, matchCount };
}

function executeSearchPlan(
  content: string,
  searchPlan: SearchPlan,
  replace: string
): { nextContent: string; matchCount: number } {
  if (searchPlan.mode === 'literal') {
    const matchCount = countLiteralOccurrences(content, searchPlan.needle);
    if (matchCount === 0) {
      return { nextContent: content, matchCount: 0 };
    }

    return {
      nextContent: content.split(searchPlan.needle).join(replace),
      matchCount,
    };
  }

  return removeClassToken(content, searchPlan.className);
}

function parseRemoveClassRegex(find: string): string | null {
  if (!find.startsWith('\\s*')) {
    return null;
  }

  const tokenPattern = find.slice(3);
  if (tokenPattern.length === 0) {
    return null;
  }

  let className = '';
  const regexMeta = new Set(['.', '+', '*', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);
  for (let i = 0; i < tokenPattern.length; i++) {
    const char = tokenPattern[i];
    if (char === '\\') {
      i += 1;
      if (i >= tokenPattern.length) {
        return null;
      }
      className += tokenPattern[i];
      continue;
    }

    if (regexMeta.has(char)) {
      return null;
    }

    className += char;
  }

  if (className.trim().length === 0 || className.includes(' ')) {
    return null;
  }

  return className;
}

function compileSearchPlan(
  find: string,
  isRegex: boolean,
  replace: string
): { searchPlan: SearchPlan | null; error?: string } {
  if (find.length === 0) {
    return { searchPlan: null, error: 'find pattern must not be empty' };
  }

  if (!isRegex) {
    return { searchPlan: { mode: 'literal', needle: find } };
  }

  const className = parseRemoveClassRegex(find);
  if (className) {
    if (replace !== '') {
      return {
        searchPlan: null,
        error: 'Class-removal regex patterns only support empty replace values',
      };
    }

    return { searchPlan: { mode: 'remove-class-token', className } };
  }

  return { searchPlan: null, error: 'Unsupported regex pattern' };
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadcn-tweaker-'));
  const tempPath = path.join(tempDir, 'pending-write.tmp');

  try {
    await fs.writeFile(tempPath, content, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
    await fs.move(tempPath, filePath, { overwrite: true });
  } finally {
    await fs.remove(tempDir);
  }
}

export async function previewChanges(
  componentPaths: string[],
  find: string,
  replace: string,
  isRegex: boolean
): Promise<{ previews: Preview[]; totalChanges: number }> {
  const previews: Preview[] = [];
  let totalChanges = 0;
  const { searchPlan, error } = compileSearchPlan(find, isRegex, replace);

  if (error || !searchPlan) {
    return { previews, totalChanges };
  }

  for (const filePath of componentPaths) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const { nextContent, matchCount } = executeSearchPlan(content, searchPlan, replace);

      if (matchCount > 0) {
        previews.push(createPreview(filePath, content, nextContent));
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
  const { searchPlan, error: planError } = compileSearchPlan(find, isRegex, replace);

  if (planError || !searchPlan) {
    return {
      success: false,
      modified,
      changes: totalChanges,
      errors: [
        {
          path: 'pattern',
          error: planError || 'Invalid pattern',
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
      const { nextContent, matchCount } = executeSearchPlan(content, searchPlan, replace);

      if (matchCount > 0 && nextContent !== content) {
        await writeFileAtomically(filePath, nextContent);
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

function createRemoveCursorPointerAction(): BatchAction {
  return {
    name: 'Remove cursor-pointer',
    find: '\\s*cursor-pointer',
    replace: '',
    isRegex: true,
  };
}

function createAddFocusRingsAction(): BatchAction {
  return {
    name: 'Add focus rings',
    find: 'focus:outline-none',
    replace:
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isRegex: false,
  };
}

function createUpdateBorderRadiusAction(): BatchAction {
  return {
    name: 'Update border radius',
    find: 'rounded-md',
    replace: 'rounded-lg',
    isRegex: false,
  };
}

function createReplaceClassAction(options?: Record<string, string>): BatchAction {
  return {
    name: `Replace ${options?.from || ''} with ${options?.to || ''}`,
    find: options?.from || '',
    replace: options?.to || '',
    isRegex: false,
  };
}

export function getBatchAction(
  actionName: string,
  options?: Record<string, string>
): BatchActionResult {
  switch (actionName) {
    case 'remove-cursor-pointer':
      return { action: createRemoveCursorPointerAction() };
    case 'add-focus-rings':
      return { action: createAddFocusRingsAction() };
    case 'update-border-radius':
      return { action: createUpdateBorderRadiusAction() };
    case 'replace-class':
      return { action: createReplaceClassAction(options) };
    case 'remove-class': {
      const className = options?.className?.trim();
      if (!className) {
        return {
          action: null,
          error: 'remove-class requires options.className',
          code: 'BATCH_ACTION_INVALID_OPTIONS',
        };
      }

      const safeClass = escapeRegExpLiteral(className);
      return {
        action: {
          name: `Remove class: ${className}`,
          find: `\\s*${safeClass}`,
          replace: '',
          isRegex: true,
        },
      };
    }
    default:
      return {
        action: null,
        error: `Unknown batch action: ${actionName}`,
        code: 'UNKNOWN_BATCH_ACTION',
      };
  }
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
