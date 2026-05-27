import fs from 'fs-extra';
import type {
  PixelInspectorPreviewRequest,
  PixelInspectorAnalysis,
  PixelInspectorClassCandidate,
  PixelInspectorControlGroup,
  PixelInspectorDraft,
  Preview,
} from '../types/index.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';
import { parseComponentSource } from './parser.js';
import { getWorkingDirectory } from './workspace.js';
import path from 'node:path';
import { createPreview } from './differ.js';

const CONTROL_PATTERNS: Array<[PixelInspectorControlGroup, RegExp]> = [
  ['radius', /^(?:[a-z0-9-]+:)*rounded(?:-|$)/],
  ['padding', /^(?:[a-z0-9-]+:)*p[trblxyse]?-/],
  ['gap', /^(?:[a-z0-9-]+:)*gap(?:-[xy])?-/],
  ['height', /^(?:[a-z0-9-]+:)*(?:h|min-h|max-h)-/],
  ['width', /^(?:[a-z0-9-]+:)*(?:w|min-w|max-w)-/],
  ['borderColor', /^(?:[a-z0-9-]+:)*(?:border|divide|outline)-(?!0$|2$|4$|8$|\[?\d)/],
  ['borderWidth', /^(?:[a-z0-9-]+:)*(?:border|border-[trblxy]|divide-[xy])(?:-|$)/],
  ['background', /^(?:[a-z0-9-]+:)*bg-/],
  ['fontSize', /^(?:[a-z0-9-]+:)*text-(?:xs|sm|base|lg|xl|[2-9]xl|\[)/],
  ['foreground', /^(?:[a-z0-9-]+:)*(?:text|placeholder|decoration|caret)-/],
  ['shadow', /^(?:[a-z0-9-]+:)*shadow(?:-|$)/],
  ['ring', /^(?:[a-z0-9-]+:)*(?:ring|ring-offset|focus-visible:ring)(?:-|$)/],
  ['fontWeight', /^(?:[a-z0-9-]+:)*font-/],
  ['letterSpacing', /^(?:[a-z0-9-]+:)*tracking-/],
  ['duration', /^(?:[a-z0-9-]+:)*(?:duration|delay)-/],
  ['easing', /^(?:[a-z0-9-]+:)*ease-/],
  ['transform', /^(?:[a-z0-9-]+:)*(?:transform|scale|rotate|translate|skew|origin)-/],
];

export class PixelInspectorValidationError extends Error {
  readonly code = 'PIXEL_INSPECTOR_VALIDATION_ERROR';
}

function normalizeComponentPath(componentPath: string): string {
  const normalized = componentPath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    !isSafeProjectRelativePath(normalized) ||
    !['.tsx', '.jsx'].includes(path.extname(normalized))
  ) {
    throw new PixelInspectorValidationError(
      'componentPath must be a safe project-relative TSX or JSX file.'
    );
  }
  return normalized;
}

function classifyInspectorClass(className: string): PixelInspectorControlGroup | null {
  for (const [group, pattern] of CONTROL_PATTERNS) {
    if (pattern.test(className)) return group;
  }
  return null;
}

function uniqueClasses(classes: string[]): string[] {
  return [...new Set(classes.filter(Boolean))];
}

export async function analyzePixelInspector(componentPath: string): Promise<PixelInspectorAnalysis> {
  const normalized = normalizeComponentPath(componentPath);
  const absolutePath = path.resolve(getWorkingDirectory(), normalized);
  const content = await fs.readFile(absolutePath, 'utf-8');
  const parsed = parseComponentSource(normalized, content);
  const candidates: PixelInspectorClassCandidate[] = [];
  const unsupported: PixelInspectorAnalysis['unsupported'] = [];

  function collect(className: string, source: PixelInspectorClassCandidate['source'], line?: number) {
    const group = classifyInspectorClass(className);
    if (group) {
      candidates.push({ className, group, source, line });
    }
  }

  for (const attribute of parsed.classNameAttributes) {
    if (attribute.kind === 'unsupported') {
      unsupported.push({ raw: attribute.raw, line: attribute.line, reason: 'dynamic className' });
    }
    for (const className of attribute.classes) collect(className, 'className', attribute.line);
  }
  for (const expression of parsed.cnExpressions) {
    for (const literal of expression.stringLiterals) {
      for (const className of literal.split(/\s+/).filter(Boolean)) {
        collect(className, 'cn', expression.line);
      }
    }
  }
  for (const definition of parsed.variantDefinitions) {
    const variantClasses = [
      ...definition.baseClasses,
      ...Object.values(definition.variants).flatMap((values) => Object.values(values).flat()),
      ...definition.compoundVariants.flatMap((variant) => variant.classes),
    ];
    for (const className of variantClasses) collect(className, 'variant', definition.line);
  }

  return {
    componentPath: normalized,
    candidates: dedupeCandidates(candidates),
    rawClasses: uniqueClasses(candidates.map((candidate) => candidate.className)),
    unsupported,
  };
}

function dedupeCandidates(
  candidates: PixelInspectorClassCandidate[]
): PixelInspectorClassCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.source}:${candidate.line ?? ''}:${candidate.className}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildPixelInspectorPatch(draft: PixelInspectorDraft): {
  changes: Array<{ from: string; to: string }>;
  apply: (content: string) => { content: string; changes: number };
} {
  const changes = draft.targetClasses
    .map((from, index) => ({ from, to: draft.replacementClasses[index] }))
    .filter((change): change is { from: string; to: string } =>
      Boolean(change.from && change.to && change.from !== change.to)
    );

  return {
    changes,
    apply(content: string) {
      let nextContent = content;
      let totalChanges = 0;
      for (const change of changes) {
        const pattern = new RegExp(`(?<![\\w:/.-])${escapeRegExp(change.from)}(?![\\w:/.-])`, 'g');
        const matches = nextContent.match(pattern);
        if (!matches) continue;
        totalChanges += matches.length;
        nextContent = nextContent.replace(pattern, change.to);
      }
      return { content: nextContent, changes: totalChanges };
    },
  };
}

export async function previewPixelInspectorPatch(
  input: PixelInspectorPreviewRequest
): Promise<{ previews: Preview[]; totalChanges: number }> {
  const normalized = normalizeComponentPath(input.draft.componentPath);
  const absolutePath = path.resolve(getWorkingDirectory(), normalized);
  const content = await fs.readFile(absolutePath, 'utf-8');
  const patch = buildPixelInspectorPatch({ ...input.draft, componentPath: normalized });
  const patched = patch.apply(content);
  if (patched.changes === 0) {
    return { previews: [], totalChanges: 0 };
  }
  return {
    previews: [createPreview(absolutePath, content, patched.content)],
    totalChanges: patched.changes,
  };
}
