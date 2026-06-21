import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  isSafeProjectRelativePath,
  resolveWithinWorkspace,
  toWorkspaceRelative,
  WorkspacePathError,
} from '../src/utils/paths.js';

const root = path.resolve('/workspace/project');

describe('resolveWithinWorkspace', () => {
  it('resolves a safe project-relative path to an absolute path inside the root', () => {
    const resolved = resolveWithinWorkspace(root, 'components/ui/button.tsx');
    assert.equal(resolved, path.join(root, 'components/ui/button.tsx'));
  });

  it('normalizes backslashes and leading ./ before resolving', () => {
    const resolved = resolveWithinWorkspace(root, './components\\ui\\card.tsx');
    assert.equal(resolved, path.join(root, 'components/ui/card.tsx'));
  });

  it('converts an absolute path inside the workspace back to a contained path', () => {
    const absolute = path.join(root, 'components/ui/badge.tsx');
    assert.equal(resolveWithinWorkspace(root, absolute), absolute);
  });

  it('rejects parent-directory traversal', () => {
    assert.throws(() => resolveWithinWorkspace(root, '../secret.tsx'), WorkspacePathError);
    assert.throws(
      () => resolveWithinWorkspace(root, 'components/../../secret.tsx'),
      WorkspacePathError
    );
  });

  it('rejects an absolute path outside the workspace', () => {
    assert.throws(
      () => resolveWithinWorkspace(root, path.resolve('/etc/passwd')),
      WorkspacePathError
    );
  });

  it('rejects empty and null-byte paths', () => {
    assert.throws(() => resolveWithinWorkspace(root, '   '), WorkspacePathError);
    assert.throws(() => resolveWithinWorkspace(root, 'components/ui\0.tsx'), WorkspacePathError);
  });

  it('enforces an allowed extension list when provided', () => {
    assert.doesNotThrow(() =>
      resolveWithinWorkspace(root, 'components/ui/button.tsx', { extensions: ['.tsx', '.jsx'] })
    );
    assert.throws(
      () =>
        resolveWithinWorkspace(root, 'components/ui/button.ts', { extensions: ['.tsx', '.jsx'] }),
      WorkspacePathError
    );
  });

  it('round-trips with toWorkspaceRelative', () => {
    const absolute = resolveWithinWorkspace(root, 'components/ui/button.tsx');
    assert.equal(toWorkspaceRelative(root, absolute), 'components/ui/button.tsx');
  });
});

describe('isSafeProjectRelativePath', () => {
  it('accepts contained relative paths and rejects traversal/absolute paths', () => {
    assert.equal(isSafeProjectRelativePath('components/ui/button.tsx'), true);
    assert.equal(isSafeProjectRelativePath('..'), false);
    assert.equal(isSafeProjectRelativePath(`..${path.sep}escape.tsx`), false);
    assert.equal(isSafeProjectRelativePath(path.resolve('/etc/passwd')), false);
  });
});
