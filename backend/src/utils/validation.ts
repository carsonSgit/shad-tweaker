import path from 'node:path';
import type {
  ApplyRequest,
  BatchActionRequest,
  DesignTokenMap,
  EditRequest,
  TemplateRule,
  TokenCategory,
  TokenPatchChange,
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
// Registry Validation
// ============================================

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isSafeRegistryIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);
}

// ============================================
// Token Validation
// ============================================

export const TOKEN_CATEGORIES: TokenCategory[] = [
  'colors',
  'radius',
  'spacing',
  'typography',
  'border',
  'shadow',
  'opacity',
  'zIndex',
  'motion',
  'easing',
  'duration',
  'breakpoints',
  'density',
];

export function isTokenCategory(value: unknown): value is TokenCategory {
  return typeof value === 'string' && (TOKEN_CATEGORIES as string[]).includes(value);
}

export function createEmptyTokenMap(): DesignTokenMap {
  return Object.fromEntries(TOKEN_CATEGORIES.map((category) => [category, {}])) as DesignTokenMap;
}

export function isSafeTokenSetId(value: string): boolean {
  return value.length > 0 && value.length <= 96 && /^token_set_[a-z0-9][a-z0-9_-]*$/.test(value);
}

export function isSafeTokenName(value: string): boolean {
  return value.length > 0 && value.length <= 96 && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value);
}

const SAFE_TOKEN_COMPONENT_PATH_PATTERN =
  /^(?:[A-Za-z0-9._-]+[\\/])*[A-Za-z0-9._-]+\.(?:[jt]sx?|vue|svelte|html|css|scss|less)$/;

export function sanitizeTokenComponentPath(componentPath: string): string | null {
  if (
    componentPath.length === 0 ||
    componentPath.length > 512 ||
    componentPath.includes('\0') ||
    path.isAbsolute(componentPath) ||
    !SAFE_TOKEN_COMPONENT_PATH_PATTERN.test(componentPath)
  ) {
    return null;
  }

  const normalized = path.normalize(componentPath).replace(/\\/g, '/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return null;
  }

  return normalized;
}

export function validateTokenComponentPath(
  componentPath: unknown,
  projectDir: string
): { valid: boolean; value?: string; error?: string } {
  if (typeof componentPath !== 'string' || componentPath.trim().length === 0) {
    return { valid: false, error: 'Component path must be a non-empty string' };
  }

  const sanitizedPath = sanitizeTokenComponentPath(componentPath);
  if (!sanitizedPath) {
    return { valid: false, error: 'Component path must be a safe project-relative file path' };
  }

  const resolvedProjectDir = path.resolve(projectDir);
  const resolvedPath = path.resolve(resolvedProjectDir, sanitizedPath);
  if (!isPathSafe(resolvedPath, resolvedProjectDir)) {
    return { valid: false, error: 'Component path must stay within the project directory' };
  }

  return { valid: true, value: sanitizedPath };
}

export function validateTokenComponentPaths(
  componentPaths: unknown,
  projectDir: string,
  maxItems = 100
): { valid: boolean; value?: string[]; error?: string } {
  if (componentPaths === undefined) {
    return { valid: true, value: undefined };
  }
  if (!Array.isArray(componentPaths)) {
    return { valid: false, error: 'componentPaths must be an array' };
  }
  if (componentPaths.length > maxItems) {
    return { valid: false, error: `componentPaths cannot exceed ${maxItems} items` };
  }
  if (!componentPaths.every((componentPath) => typeof componentPath === 'string')) {
    return { valid: false, error: 'componentPaths must contain only strings' };
  }

  const normalizedPaths: string[] = [];
  for (const componentPath of componentPaths) {
    const sanitizedPath = sanitizeTokenComponentPath(componentPath);
    if (!sanitizedPath) {
      return {
        valid: false,
        error: 'componentPaths must contain safe project-relative file paths',
      };
    }

    const resolvedProjectDir = path.resolve(projectDir);
    const resolvedPath = path.resolve(resolvedProjectDir, sanitizedPath);
    if (!isPathSafe(resolvedPath, resolvedProjectDir)) {
      return { valid: false, error: 'componentPaths must stay within the project directory' };
    }
    normalizedPaths.push(sanitizedPath);
  }

  return {
    valid: true,
    value: normalizedPaths,
  };
}

export function validateTokenPatchChanges(
  changes: unknown,
  maxItems = 200
): { valid: boolean; value?: TokenPatchChange[]; error?: string } {
  if (!Array.isArray(changes)) {
    return { valid: false, error: 'changes must be an array' };
  }
  if (changes.length > maxItems) {
    return { valid: false, error: `changes cannot exceed ${maxItems} items` };
  }

  const normalized: TokenPatchChange[] = [];
  for (const change of changes) {
    if (typeof change !== 'object' || change === null) {
      return { valid: false, error: 'Each change must be an object' };
    }
    const candidate = change as Record<string, unknown>;
    if (!isTokenCategory(candidate.category)) {
      return { valid: false, error: 'Each change requires a valid category' };
    }
    const from = typeof candidate.from === 'string' ? candidate.from.trim() : '';
    const to = typeof candidate.to === 'string' ? candidate.to.trim() : '';
    if (typeof candidate.from !== 'string' || from.length === 0 || from.length > 256) {
      return { valid: false, error: 'Each change requires a non-empty from value' };
    }
    if (typeof candidate.to !== 'string' || to.length === 0 || to.length > 256) {
      return { valid: false, error: 'Each change requires a non-empty to value' };
    }
    if (candidate.tokenName !== undefined) {
      if (typeof candidate.tokenName !== 'string' || !isSafeTokenName(candidate.tokenName)) {
        return { valid: false, error: 'tokenName must be a safe token name when provided' };
      }
    }

    normalized.push({
      category: candidate.category,
      from,
      to,
      tokenName: typeof candidate.tokenName === 'string' ? candidate.tokenName : undefined,
    });
  }

  return { valid: true, value: normalized };
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
  let rangeMatch: RegExpExecArray | null = rangeRegex.exec(pattern);
  while (rangeMatch !== null) {
    const min = parseInt(rangeMatch[1], 10);
    const max = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : min;
    // Reject very large or inverted ranges
    if (Number.isNaN(min) || Number.isNaN(max) || min > max || max > 100) {
      return false;
    }
    rangeMatch = rangeRegex.exec(pattern);
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
