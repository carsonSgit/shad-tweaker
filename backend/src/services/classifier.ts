import path from 'node:path';
import type { ComponentKind, ConfidenceBand } from '../types/index.js';

export interface ClassificationResult {
  score: number;
  band: ConfidenceBand;
  kind: ComponentKind;
  rationale: string[];
}

const SHADCN_NAMES = new Set([
  'accordion',
  'alert-dialog',
  'alert',
  'avatar',
  'badge',
  'button',
  'calendar',
  'card',
  'checkbox',
  'dialog',
  'dropdown-menu',
  'form',
  'input',
  'label',
  'popover',
  'radio-group',
  'select',
  'separator',
  'sheet',
  'skeleton',
  'slider',
  'switch',
  'table',
  'tabs',
  'textarea',
  'toast',
  'tooltip',
]);

export function scoreComponent(
  filePath: string,
  content: string,
  exportsFound: string[],
  importsFound: string[]
): ClassificationResult {
  const rationale: string[] = [];
  let score = 0;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const fileName = path.basename(filePath, path.extname(filePath)).toLowerCase();

  if (
    normalized.includes('/components/ui/') ||
    normalized.endsWith('/components/ui') ||
    normalized.includes('/src/ui/')
  ) {
    score += 40;
    rationale.push('located under common shadcn directory');
  }

  if (
    exportsFound.length > 0 &&
    /(function\s+[A-Z]\w+|const\s+[A-Z]\w+\s*=|export\s+default)/.test(content)
  ) {
    score += 20;
    rationale.push('react export pattern detected');
  }

  if (/(className\s*=|className\s*:|\bcn\(|\bclsx\(|\bcva\()/.test(content)) {
    score += 20;
    rationale.push('class utility usage patterns detected');
  }

  if (SHADCN_NAMES.has(fileName) || /(?:^|[-_])(trigger|content|item|root)$/.test(fileName)) {
    score += 10;
    rationale.push('known shadcn naming convention');
  }

  if (/(variant|variants|size|sizes)/.test(content)) {
    score += 10;
    rationale.push('variant/size pattern detected');
  }

  if (score > 100) {
    score = 100;
  }

  const band: ConfidenceBand = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';
  let kind: ComponentKind = 'unknown';

  if (normalized.includes('/components/ui/')) {
    kind = 'primitive';
  } else if (importsFound.some((entry) => entry.includes('/components/ui') || entry.startsWith('.'))) {
    kind = 'wrapper';
  } else if (score >= 50) {
    kind = 'composition';
  }

  return {
    score,
    band,
    kind,
    rationale,
  };
}

