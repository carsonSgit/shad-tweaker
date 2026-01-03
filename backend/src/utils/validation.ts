import type { EditRequest, ApplyRequest, BatchActionRequest, TemplateRule } from '../types/index.js';

export function validateEditRequest(body: unknown): body is EditRequest {
  if (typeof body !== 'object' || body === null) return false;

  const req = body as Record<string, unknown>;

  if (!Array.isArray(req.componentPaths)) return false;
  if (!req.componentPaths.every((p) => typeof p === 'string')) return false;
  if (typeof req.find !== 'string') return false;
  if (typeof req.replace !== 'string') return false;
  if (typeof req.isRegex !== 'boolean') return false;

  return true;
}

export function validateApplyRequest(body: unknown): body is ApplyRequest {
  if (!validateEditRequest(body)) return false;

  const req = body as unknown as Record<string, unknown>;
  if (req.createBackup !== undefined && typeof req.createBackup !== 'boolean') {
    return false;
  }

  return true;
}

export function validateBatchActionRequest(body: unknown): body is BatchActionRequest {
  if (typeof body !== 'object' || body === null) return false;

  const req = body as Record<string, unknown>;

  if (typeof req.action !== 'string') return false;
  if (!Array.isArray(req.componentPaths)) return false;
  if (!req.componentPaths.every((p) => typeof p === 'string')) return false;

  const validActions = [
    'remove-cursor-pointer',
    'add-focus-rings',
    'update-border-radius',
    'remove-class',
    'replace-class',
  ];

  if (!validActions.includes(req.action)) return false;

  return true;
}

export function validateTemplateRules(rules: unknown): rules is TemplateRule[] {
  if (!Array.isArray(rules)) return false;

  return rules.every((rule) => {
    if (typeof rule !== 'object' || rule === null) return false;
    const r = rule as Record<string, unknown>;
    return (
      typeof r.find === 'string' &&
      typeof r.replace === 'string' &&
      typeof r.isRegex === 'boolean'
    );
  });
}

export function validateRegex(pattern: string): { valid: boolean; error?: string } {
  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : 'Invalid regex pattern'
    };
  }
}
