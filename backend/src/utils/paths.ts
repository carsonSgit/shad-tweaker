import path from 'node:path';

export function isSafeProjectRelativePath(value: string): boolean {
  if (path.isAbsolute(value)) {
    return false;
  }

  const normalized = path.normalize(value);
  return normalized !== '..' && !normalized.startsWith(`..${path.sep}`);
}
