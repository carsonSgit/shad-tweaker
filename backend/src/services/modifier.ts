import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import type { Preview } from '../types/index.js';
import { createPreview } from './differ.js';
import { createBackup } from './backup.js';
import { logger } from '../utils/logger.js';

export interface ModifyResult {
  success: boolean;
  modified: string[];
  changes: number;
  backupId?: string;
  errors?: Array<{ path: string; error: string }>;
}

export async function previewChanges(
  componentPaths: string[],
  find: string,
  replace: string,
  isRegex: boolean
): Promise<{ previews: Preview[]; totalChanges: number }> {
  const previews: Preview[] = [];
  let totalChanges = 0;

  const searchPattern = isRegex ? new RegExp(find, 'g') : null;

  for (const filePath of componentPaths) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      let newContent: string;
      let matchCount: number;

      if (isRegex && searchPattern) {
        const matches = content.match(searchPattern);
        matchCount = matches ? matches.length : 0;
        newContent = content.replace(searchPattern, replace);
      } else {
        const escapedFind = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedFind, 'g');
        const matches = content.match(regex);
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
  shouldBackup: boolean = true
): Promise<ModifyResult> {
  const modified: string[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  let totalChanges = 0;
  let backupId: string | undefined;

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
        errors: [{ path: 'backup', error: 'Failed to create backup before modifications' }],
      };
    }
  }

  const searchPattern = isRegex ? new RegExp(find, 'g') : null;

  for (const filePath of componentPaths) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      let newContent: string;
      let matchCount: number;

      if (isRegex && searchPattern) {
        const matches = content.match(searchPattern);
        matchCount = matches ? matches.length : 0;
        newContent = content.replace(new RegExp(find, 'g'), replace);
      } else {
        const escapedFind = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedFind, 'g');
        const matches = content.match(regex);
        matchCount = matches ? matches.length : 0;
        newContent = content.split(find).join(replace);
      }

      if (matchCount > 0) {
        const tempPath = path.join(os.tmpdir(), `shadcn-tweaker-${Date.now()}-${path.basename(filePath)}`);
        await fs.writeFile(tempPath, newContent, 'utf-8');
        await fs.move(tempPath, filePath, { overwrite: true });

        modified.push(filePath);
        totalChanges += matchCount;
        logger.info(`Modified ${filePath}: ${matchCount} changes`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ path: filePath, error: errorMessage });
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
    replace: 'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isRegex: false,
  }),
  'update-border-radius': () => ({
    name: 'Update border radius',
    find: 'rounded-md',
    replace: 'rounded-lg',
    isRegex: false,
  }),
  'remove-class': (options) => ({
    name: `Remove class: ${options?.className || ''}`,
    find: `\\s*${options?.className || ''}`,
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

export function getBatchAction(actionName: string, options?: Record<string, string>): BatchAction | null {
  const actionFn = BATCH_ACTIONS[actionName];
  if (!actionFn) return null;
  return actionFn(options);
}

export async function applyBatchAction(
  actionName: string,
  componentPaths: string[],
  options?: Record<string, string>
): Promise<ModifyResult> {
  const action = getBatchAction(actionName, options);

  if (!action) {
    return {
      success: false,
      modified: [],
      changes: 0,
      errors: [{ path: 'action', error: `Unknown batch action: ${actionName}` }],
    };
  }

  return applyChanges(
    componentPaths,
    action.find,
    action.replace,
    action.isRegex,
    true
  );
}
