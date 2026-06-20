import path from 'node:path';

export function isSafeProjectRelativePath(value: string): boolean {
  if (path.isAbsolute(value)) {
    return false;
  }

  const normalized = path.normalize(value);
  return normalized !== '..' && !normalized.startsWith(`..${path.sep}`);
}

export class WorkspacePathError extends Error {
  readonly code = 'WORKSPACE_PATH_ERROR';
}

/**
 * Resolves a user-supplied project-relative path to an absolute path that is
 * guaranteed to stay inside `rootDir`. Acts as a single sanitizer barrier for
 * every file-touching code path: it normalizes the input, rejects traversal and
 * absolute escapes, optionally enforces an allowed extension, and asserts the
 * resolved path is contained within the workspace root before returning it.
 *
 * Keep this module dependency-free so it never participates in an import cycle;
 * callers pass the workspace root explicitly.
 */
export function resolveWithinWorkspace(
  rootDir: string,
  relativePath: string,
  opts?: { extensions?: string[] }
): string {
  if (typeof relativePath !== 'string') {
    throw new WorkspacePathError('A project-relative path string is required.');
  }

  const base = path.resolve(rootDir);
  const trimmed = relativePath.trim();
  const relative = path.isAbsolute(trimmed) ? path.relative(base, trimmed) : trimmed;
  const normalized = relative.replace(/\\/g, '/').replace(/^\.\//, '');

  if (
    !normalized ||
    normalized.includes('\0') ||
    path.isAbsolute(normalized) ||
    !isSafeProjectRelativePath(normalized)
  ) {
    throw new WorkspacePathError('Path must be a safe project-relative path.');
  }

  if (opts?.extensions && !opts.extensions.includes(path.extname(normalized))) {
    throw new WorkspacePathError(
      `Path must have one of these extensions: ${opts.extensions.join(', ')}.`
    );
  }

  const resolved = path.resolve(base, normalized);
  const relativeToBase = path.relative(base, resolved);
  if (
    relativeToBase === '..' ||
    relativeToBase.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToBase)
  ) {
    throw new WorkspacePathError('Path must resolve within the current workspace.');
  }

  return resolved;
}

/** Returns the normalized, forward-slashed workspace-relative form of an absolute path. */
export function toWorkspaceRelative(rootDir: string, absolutePath: string): string {
  return path.relative(path.resolve(rootDir), absolutePath).replace(/\\/g, '/');
}
