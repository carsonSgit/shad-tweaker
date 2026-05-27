import path from 'node:path';
import fs from 'fs-extra';
import type {
  PixelInspectorAnalysis,
  PixelInspectorApplyRequest,
  PixelInspectorApplyResult,
  PixelInspectorClassCandidate,
  PixelInspectorControlGroup,
  PixelInspectorDraft,
  PixelInspectorPreviewRequest,
  Preset,
  Preview,
} from '../types/index.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';
import { createBackup } from './backup.js';
import { createPreview } from './differ.js';
import { parseComponentSource } from './parser.js';
import { applyTokenPatch, classifyTokenClass } from './tokens.js';
import {
  getWorkingDirectory,
  loadWorkspaceManifest,
  mutateWorkspaceManifest,
} from './workspace.js';

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
  const trimmed = componentPath.trim();
  const cwd = path.resolve(getWorkingDirectory());
  const relativePath = path.isAbsolute(trimmed) ? path.relative(cwd, trimmed) : trimmed;
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
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

export async function analyzePixelInspector(
  componentPath: string
): Promise<PixelInspectorAnalysis> {
  const normalized = normalizeComponentPath(componentPath);
  const absolutePath = path.resolve(getWorkingDirectory(), normalized);
  const content = await fs.readFile(absolutePath, 'utf-8');
  const parsed = parseComponentSource(normalized, content);
  const candidates: PixelInspectorClassCandidate[] = [];
  const unsupported: PixelInspectorAnalysis['unsupported'] = [];

  function collect(
    className: string,
    source: PixelInspectorClassCandidate['source'],
    line?: number
  ) {
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

export async function applyPixelInspectorPatch(
  input: PixelInspectorApplyRequest
): Promise<PixelInspectorApplyResult> {
  const normalized = normalizeComponentPath(input.draft.componentPath);
  if (input.draft.saveMode === 'token-patch') {
    if (!input.draft.tokenSetId) {
      throw new PixelInspectorValidationError('tokenSetId is required for token patches.');
    }
    const changes = buildPixelInspectorPatch(input.draft).changes.map((change) => ({
      category: classifyTokenClass(change.to) ?? classifyTokenClass(change.from) ?? 'colors',
      from: change.from,
      to: change.to,
      tokenName: input.draft.tokenName,
    }));
    return applyTokenPatch({
      tokenSetId: input.draft.tokenSetId,
      componentPaths: [normalized],
      changes,
      createBackup: input.createBackup,
      recordOverrides: input.recordOverrides,
    });
  }

  const absolutePath = path.resolve(getWorkingDirectory(), normalized);
  const content = await fs.readFile(absolutePath, 'utf-8');
  const patch = buildPixelInspectorPatch({ ...input.draft, componentPath: normalized });
  const patched = patch.apply(content);
  let backupId: string | undefined;

  if (patched.changes > 0 && (input.createBackup ?? true)) {
    const backup = await createBackup([absolutePath]);
    backupId = backup.id;
  }

  if (patched.changes > 0) {
    await fs.writeFile(absolutePath, patched.content, 'utf-8');
  }

  return {
    success: true,
    modified: patched.changes > 0 ? [absolutePath] : [],
    changes: patched.changes,
    backupId,
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export async function listPixelInspectorPresets(): Promise<Preset[]> {
  const manifest = await loadWorkspaceManifest();
  return manifest.presets ?? [];
}

export async function createPixelInspectorPreset(input: {
  name: string;
  description?: string;
  draft: PixelInspectorDraft;
}): Promise<Preset> {
  const name = input.name.trim();
  if (!name) {
    throw new PixelInspectorValidationError('Preset name is required.');
  }
  const patch = buildPixelInspectorPatch(input.draft);
  const now = new Date().toISOString();
  const preset: Preset = {
    id: `preset_${slugify(name) || cryptoRandomSuffix()}`,
    name,
    description: input.description?.trim() || undefined,
    created: now,
    tokenOverrides: [],
    classTransforms: patch.changes.map((change) => ({
      find: change.from,
      replace: change.to,
      isRegex: false,
    })),
    astTransforms: [],
    motionOverrides: [],
    variantRecipes: [],
  };

  return mutateWorkspaceManifest(async (manifest) => ({
    manifest: {
      ...manifest,
      presets: [
        ...(manifest.presets ?? []).filter((candidate) => candidate.id !== preset.id),
        preset,
      ],
    },
    result: preset,
  }));
}

export async function deletePixelInspectorPreset(id: string): Promise<boolean> {
  return mutateWorkspaceManifest(async (manifest) => {
    const presets = (manifest.presets ?? []).filter((preset) => preset.id !== id);
    return {
      manifest: { ...manifest, presets },
      result: presets.length !== (manifest.presets ?? []).length,
    };
  });
}

function cryptoRandomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}
