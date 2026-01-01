import * as Diff from 'diff';
import type { Preview } from '../types/index.js';

export interface DiffResult {
  diff: string;
  changes: number;
  lineNumbers: number[];
  added: number;
  removed: number;
}

export function generateDiff(oldContent: string, newContent: string): DiffResult {
  const changes = Diff.diffLines(oldContent, newContent);

  const diffLines: string[] = [];
  const lineNumbers: number[] = [];
  let currentLine = 1;
  let added = 0;
  let removed = 0;
  let changeCount = 0;

  for (const part of changes) {
    const lines = part.value.split('\n');
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }

    if (part.added) {
      for (const line of lines) {
        diffLines.push(`+ ${line}`);
        lineNumbers.push(currentLine);
        currentLine++;
        added++;
      }
      changeCount++;
    } else if (part.removed) {
      for (const line of lines) {
        diffLines.push(`- ${line}`);
        lineNumbers.push(currentLine);
        removed++;
      }
      changeCount++;
    } else {
      for (const line of lines) {
        diffLines.push(`  ${line}`);
        currentLine++;
      }
    }
  }

  return {
    diff: diffLines.join('\n'),
    changes: changeCount,
    lineNumbers: [...new Set(lineNumbers)],
    added,
    removed,
  };
}

export function generateUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string
): string {
  const patch = Diff.createPatch(filePath, oldContent, newContent, 'original', 'modified');
  return patch;
}

export function createPreview(
  path: string,
  oldContent: string,
  newContent: string
): Preview {
  const diffResult = generateDiff(oldContent, newContent);

  return {
    path,
    before: oldContent,
    after: newContent,
    diff: diffResult.diff,
    changes: diffResult.changes,
    lineNumbers: diffResult.lineNumbers,
  };
}

export function countChanges(oldContent: string, newContent: string): number {
  if (oldContent === newContent) return 0;

  const changes = Diff.diffLines(oldContent, newContent);
  return changes.filter((c) => c.added || c.removed).length;
}
