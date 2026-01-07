import path from 'node:path';
import type {
  ApplyRequest,
  BatchActionRequest,
  EditRequest,
  TemplateRule,
} from '../types/index.js';

// ============================================
// Path Traversal Protection
// ============================================

/**
 * Validates that a path is safe and doesn't contain path traversal sequences.
 * Returns true if the path is safe, false otherwise.
 */
export function isPathSafe(targetPath: string, allowedBaseDir: string): boolean {
  try {
    // Normalize both paths to handle different separators
    const normalizedTarget = path.normalize(targetPath);
    const normalizedBase = path.normalize(allowedBaseDir);

    // Resolve to absolute paths
    let resolvedTarget = path.resolve(normalizedTarget);
    let resolvedBase = path.resolve(normalizedBase);

    // On Windows, paths are case-insensitive, so we need to compare in lowercase
    if (process.platform === 'win32') {
      resolvedTarget = resolvedTarget.toLowerCase();
      resolvedBase = resolvedBase.toLowerCase();
    }

    // Check if the target is within the allowed base directory
    // Add path separator to prevent matching partial directory names
    // e.g., /foo/bar should not match /foo/barbaz
    return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase;
  } catch {
    return false;
  }
}

/**
 * Validates that a custom path for scanning doesn't contain traversal sequences.
 * Rejects absolute paths and paths with ".." sequences.
 */
export function validateCustomPath(customPath: string): { valid: boolean; error?: string } {
  // Reject absolute paths
  if (path.isAbsolute(customPath)) {
    return { valid: false, error: 'Absolute paths are not allowed' };
  }

  // Reject paths with traversal sequences
  const normalized = path.normalize(customPath);
  if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) {
    return { valid: false, error: 'Path traversal sequences are not allowed' };
  }

  return { valid: true };
}

/**
 * Validates an array of component paths ensuring they are within the project directory.
 */
export function validateComponentPaths(
  componentPaths: string[],
  projectDir: string
): { valid: boolean; invalidPaths?: string[]; error?: string } {
  const invalidPaths: string[] = [];

  for (const componentPath of componentPaths) {
    if (!isPathSafe(componentPath, projectDir)) {
      invalidPaths.push(componentPath);
    }
  }

  if (invalidPaths.length > 0) {
    return {
      valid: false,
      invalidPaths,
      error: `Path traversal detected in component paths: ${invalidPaths.join(', ')}`,
    };
  }

  return { valid: true };
}

// ============================================
// Backup ID Validation
// ============================================

/**
 * Validates backup ID format to prevent path traversal.
 * Valid format: backup_YYYY-MM-DD_HH-MM-SS
 */
export function validateBackupId(backupId: string): { valid: boolean; error?: string } {
  // Must match the expected pattern
  const backupIdPattern = /^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

  if (!backupIdPattern.test(backupId)) {
    return { valid: false, error: 'Invalid backup ID format' };
  }

  // Extra check: ensure no path separators or traversal
  if (backupId.includes('/') || backupId.includes('\\') || backupId.includes('..')) {
    return { valid: false, error: 'Invalid characters in backup ID' };
  }

  return { valid: true };
}

// ============================================
// Template ID Validation
// ============================================

/**
 * Validates template ID format to prevent path traversal.
 * Valid format: template_[8 hex characters]
 */
export function validateTemplateId(templateId: string): { valid: boolean; error?: string } {
  // Must match the expected pattern
  const templateIdPattern = /^template_[a-f0-9]{8}$/;

  if (!templateIdPattern.test(templateId)) {
    return { valid: false, error: 'Invalid template ID format' };
  }

  // Extra check: ensure no path separators or traversal
  if (templateId.includes('/') || templateId.includes('\\') || templateId.includes('..')) {
    return { valid: false, error: 'Invalid characters in template ID' };
  }

  return { valid: true };
}

// ============================================
// Request Body Validation
// ============================================

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
      typeof r.find === 'string' && typeof r.replace === 'string' && typeof r.isRegex === 'boolean'
    );
  });
}

// ============================================
// Regex Validation (with ReDoS Protection)
// ============================================

/**
 * Checks if a regex pattern is potentially vulnerable to ReDoS attacks.
 * Detects common patterns that can cause catastrophic backtracking.
 */
function isRegexDangerous(pattern: string): boolean {
  // Limit pattern length to prevent excessive processing
  if (pattern.length > 500) {
    return true;
  }

  // Detect patterns that commonly cause ReDoS:
  // 1. Nested quantifiers: (a+)+ or (a*)* or (a+)*
  // 2. Alternation with overlap: (a|a)+ or (.*a|.*b)
  // 3. Multiple unbounded quantifiers in sequence: .*.*
  const dangerousPatterns = [
    /\([^)]*[+*][^)]*\)[+*]/, // Nested quantifiers like (a+)+
    /\([^)]*[+*][^)]*\)\{/, // Nested quantifiers like (a+){n,}
    /(\.\*){2,}/, // Multiple .* in sequence
    /(\.\+){2,}/, // Multiple .+ in sequence
    /\([^)]+\|[^)]+\)[+*]/, // Alternation with quantifier
  ];

  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      return true;
    }
  }

  // Count quantifiers - too many can be problematic
  const quantifierCount = (pattern.match(/[+*?]|\{\d+,?\d*\}/g) || []).length;
  if (quantifierCount > 10) {
    return true;
  }

  return false;
}

/**
 * Enforces a conservative "safe" subset of regex features.
 *
 * Disallows:
 * - backreferences (e.g. \1, \2, ...)
 * - lookarounds (e.g. (?=...), (?!...), (?<=...), (?<!...))
 * - named capture groups (e.g. (?<name>...))
 * - alternation (|) outside of character classes
 * - inline flags (e.g. (?i))
 * - nested quantifiers and overly large repetition ranges
 */
function isRegexSafe(pattern: string): boolean {
  // Basic sanity: no control characters or newlines
  if (/[^\x20-\x7E]/.test(pattern)) {
    return false;
  }

  // Disallow backreferences like \1, \2, ... which can be complex to analyze
  if (/\\[1-9]/.test(pattern)) {
    return false;
  }

  // Disallow lookarounds and other (?...) constructs, including named groups
  if (/\(\?/.test(pattern)) {
    return false;
  }

  // Disallow alternation outside character classes
  // This is a conservative check: any '|' is rejected.
  if (/\|/.test(pattern)) {
    return false;
  }

  // Disallow unbounded "any character" repetition like .* or .+
  if (/(\.\*|\.\+)/.test(pattern)) {
    return false;
  }

  // Disallow nested quantifiers such as (a+)+, (a*)*, (a+){m,n}
  if (/\([^)]*[+*][^)]*\)[+*]/.test(pattern)) {
    return false;
  }
  if (/\([^)]*[+*][^)]*\)\{/.test(pattern)) {
    return false;
  }

  // Limit repetition ranges to small bounds to avoid catastrophic backtracking
  const rangeRegex = /\{(\d+)(,(\d+))?\}/g;
  let rangeMatch: RegExpExecArray | null;
  while ((rangeMatch = rangeRegex.exec(pattern)) !== null) {
    const min = parseInt(rangeMatch[1], 10);
    const max = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : min;
    // Reject very large or inverted ranges
    if (isNaN(min) || isNaN(max) || min > max || max > 100) {
      return false;
    }
  }

  return true;
}

export function validateRegex(pattern: string): { valid: boolean; error?: string } {
  // Check for potentially dangerous patterns (ReDoS prevention)
  if (isRegexDangerous(pattern)) {
    return {
      valid: false,
      error: 'Pattern may cause performance issues (ReDoS). Please simplify the pattern.',
    };
  }

  // Enforce a conservative safe-regex subset before compiling the pattern.
  if (!isRegexSafe(pattern)) {
    return {
      valid: false,
      error:
        'Pattern uses unsupported or unsafe regex features. ' +
        'Please use simple expressions without backreferences, lookarounds, or complex quantifiers.',
    };
  }

  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : 'Invalid regex pattern',
    };
  }
}
