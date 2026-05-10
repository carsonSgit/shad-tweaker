import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import type {
  ComponentTokenOverride,
  DesignTokenMap,
  DesignTokenSet,
  TokenCandidate,
  TokenCategory,
  TokenFrequencyEntry,
  TokenFrequencyReport,
  TokenInconsistencyEntry,
  TokenInconsistencyReport,
  TokenPatchApplyResult,
  TokenPatchChange,
  TokenPatchPreviewResult,
} from '../types/index.js';
import { createEmptyTokenMap, isPathSafe } from '../utils/validation.js';
import { createBackup } from './backup.js';
import { createPreview } from './differ.js';
import { parseComponentSource } from './parser.js';
import {
  getWorkingDirectory,
  loadWorkspaceManifest,
  mutateWorkspaceManifest,
} from './workspace.js';

const CATEGORY_PREFIXES: Array<[TokenCategory, RegExp]> = [
  ['radius', /^(rounded|rounded-[trbl][lr]?)(-|$)/],
  ['spacing', /^(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y)-/],
  ['typography', /^(text|font|leading|tracking|line-clamp)-/],
  ['border', /^(border|border-[trblxy]|divide-x|divide-y)(-|$)/],
  ['shadow', /^shadow($|-)/],
  ['opacity', /^opacity-/],
  ['zIndex', /^z-/],
  ['motion', /^(animate|transition|transform|scale|rotate|translate|origin)-/],
  ['easing', /^ease-/],
  ['duration', /^(duration|delay)-/],
  ['breakpoints', /^(container|max-w-screen|min-w-screen)-/],
  ['density', /^(size|h|w|min-h|min-w|max-h|max-w)-/],
  [
    'colors',
    /^(bg|text|from|via|to|fill|stroke|accent|caret|decoration|placeholder|ring|outline)-/,
  ],
];

const INCONSISTENCY_FAMILIES: Array<{ family: string; category: TokenCategory; pattern: RegExp }> =
  [
    { family: 'radius', category: 'radius', pattern: /^rounded(?:-[trbl][lr]?)?-/ },
    {
      family: 'spacing',
      category: 'spacing',
      pattern: /^(p|px|py|pt|pr|pb|pl|gap|gap-x|gap-y|space-x|space-y)-/,
    },
    { family: 'focus-ring', category: 'colors', pattern: /^(focus-visible:)?ring-/ },
    { family: 'shadow', category: 'shadow', pattern: /^shadow-/ },
    { family: 'border', category: 'border', pattern: /^border-/ },
    { family: 'color', category: 'colors', pattern: /^(bg|text|ring|border)-/ },
    { family: 'motion', category: 'motion', pattern: /^(animate|transition|duration|ease)-/ },
  ];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function createTokenSetId(name: string): string {
  return `token_set_${slugify(name) || crypto.randomUUID().slice(0, 8)}`;
}

function normalizeTokenSet(tokenSet: DesignTokenSet): DesignTokenSet {
  return { ...tokenSet, tokens: { ...createEmptyTokenMap(), ...tokenSet.tokens } };
}

export function classifyTokenClass(className: string): TokenCategory | null {
  const normalized = className.split(':').at(-1) || className;
  for (const [category, pattern] of CATEGORY_PREFIXES) {
    if (pattern.test(normalized)) {
      return category;
    }
  }
  return null;
}

function getProjectRoot(): string {
  return path.resolve(getWorkingDirectory());
}

async function resolveSafeExistingComponentPath(componentPath: string): Promise<string | null> {
  const projectRoot = getProjectRoot();
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedPath = path.resolve(projectRoot, componentPath);

  // First enforce lexical containment, then realpath containment below to catch symlinks.
  if (!isPathSafe(resolvedPath, resolvedProjectRoot)) {
    return null;
  }

  try {
    const realProjectRoot = await fs.realpath(resolvedProjectRoot);
    const realComponentPath = await fs.realpath(resolvedPath);
    const rootPrefix = realProjectRoot.endsWith(path.sep)
      ? realProjectRoot
      : `${realProjectRoot}${path.sep}`;

    if (realComponentPath !== realProjectRoot && !realComponentPath.startsWith(rootPrefix)) {
      return null;
    }

    return realComponentPath;
  } catch {
    return null;
  }
}

function collectClassesFromContent(componentPath: string, content: string): TokenCandidate[] {
  const parsed = parseComponentSource(componentPath, content);
  const candidates: TokenCandidate[] = [];
  const seenCandidateKeys = new Set<string>();

  function pushCandidate(candidate: TokenCandidate): void {
    const key = `${candidate.componentPath}:${candidate.line ?? 'unknown'}:${candidate.className}`;
    if (seenCandidateKeys.has(key)) {
      return;
    }
    candidates.push(candidate);
    seenCandidateKeys.add(key);
  }

  for (const attribute of parsed.classNameAttributes) {
    for (const className of attribute.classes) {
      const category = classifyTokenClass(className);
      if (category) {
        pushCandidate({
          category,
          value: className,
          className,
          componentPath,
          source: 'className',
          line: attribute.line,
        });
      }
    }
  }

  for (const expression of parsed.cnExpressions) {
    for (const literal of expression.stringLiterals) {
      for (const className of literal.split(/\s+/).filter(Boolean)) {
        const category = classifyTokenClass(className);
        if (category) {
          pushCandidate({
            category,
            value: className,
            className,
            componentPath,
            source: 'cn',
            line: expression.line,
          });
        }
      }
    }
  }

  for (const variant of parsed.variantDefinitions) {
    for (const className of variant.baseClasses) {
      const category = classifyTokenClass(className);
      if (category) {
        pushCandidate({
          category,
          value: className,
          className,
          componentPath,
          source: 'variant',
          line: variant.line,
        });
      }
    }
  }

  const seenClasses = new Set(candidates.map((candidate) => candidate.className));
  const classMatches = content.match(/className\s*=\s*["'`]([^"'`]+)["'`]/g) || [];
  for (const match of classMatches) {
    const value = match.replace(/^className\s*=\s*["'`]/, '').replace(/["'`]$/, '');
    for (const className of value.split(/\s+/).filter(Boolean)) {
      const category = classifyTokenClass(className);
      if (category && !seenClasses.has(className)) {
        pushCandidate({
          category,
          value: className,
          className,
          componentPath,
          source: 'fallback',
        });
        seenClasses.add(className);
      }
    }
  }

  return candidates;
}

async function readCandidates(componentPaths?: string[]): Promise<TokenCandidate[]> {
  const manifest = await loadWorkspaceManifest();
  const paths = componentPaths ?? manifest.components.map((component) => component.path);
  const candidates: TokenCandidate[] = [];

  for (const componentPath of paths) {
    const safePath = await resolveSafeExistingComponentPath(componentPath);
    if (!safePath) {
      continue;
    }
    const content = await fs.readFile(safePath, 'utf-8');
    candidates.push(...collectClassesFromContent(safePath, content));
  }

  return candidates;
}

export async function listTokenSets(): Promise<DesignTokenSet[]> {
  const manifest = await loadWorkspaceManifest();
  return manifest.tokenSets.map(normalizeTokenSet).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTokenSet(id: string): Promise<DesignTokenSet | null> {
  const manifest = await loadWorkspaceManifest();
  return manifest.tokenSets.find((tokenSet) => tokenSet.id === id) ?? null;
}

export async function createTokenSet(input: {
  id?: string;
  name: string;
  description?: string;
  tokens?: DesignTokenMap;
}): Promise<DesignTokenSet> {
  return mutateWorkspaceManifest(async (manifest) => {
    const now = new Date().toISOString();
    const id = input.id || createTokenSetId(input.name);
    if (manifest.tokenSets.some((tokenSet) => tokenSet.id === id)) {
      throw new Error(`Token set already exists: ${id}`);
    }
    if (manifest.tokenSets.some((tokenSet) => tokenSet.name === input.name)) {
      throw new Error(`Token set name already exists: ${input.name}`);
    }
    const tokenSet: DesignTokenSet = {
      id,
      name: input.name,
      description: input.description,
      tokens: input.tokens ?? createEmptyTokenMap(),
      createdAt: now,
      updatedAt: now,
    };
    return {
      manifest: {
        ...manifest,
        tokenSets: [...manifest.tokenSets, tokenSet].sort((a, b) => a.name.localeCompare(b.name)),
      },
      result: tokenSet,
    };
  });
}

export async function updateTokenSet(
  id: string,
  input: { name: string; description?: string; tokens: DesignTokenMap }
): Promise<DesignTokenSet | null> {
  return mutateWorkspaceManifest(async (manifest) => {
    const existing = manifest.tokenSets.find((tokenSet) => tokenSet.id === id);
    if (!existing) {
      return { manifest, result: null };
    }
    if (manifest.tokenSets.some((tokenSet) => tokenSet.id !== id && tokenSet.name === input.name)) {
      throw new Error(`Token set name already exists: ${input.name}`);
    }

    const updated: DesignTokenSet = {
      id,
      name: input.name,
      description: input.description,
      tokens: input.tokens,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    return {
      manifest: {
        ...manifest,
        tokenSets: manifest.tokenSets
          .map((tokenSet) => (tokenSet.id === id ? updated : tokenSet))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
      result: updated,
    };
  });
}

export async function deleteTokenSet(id: string): Promise<boolean> {
  return mutateWorkspaceManifest(async (manifest) => {
    const tokenSets = manifest.tokenSets.filter((tokenSet) => tokenSet.id !== id);
    if (tokenSets.length === manifest.tokenSets.length) {
      return { manifest, result: false };
    }

    const overrides = Object.fromEntries(
      Object.entries(manifest.componentTokenOverrides)
        .map(([componentPath, componentOverrides]) => [
          componentPath,
          componentOverrides.filter((override) => override.tokenSetId !== id),
        ])
        .filter(([, componentOverrides]) => componentOverrides.length > 0)
    );

    return {
      manifest: {
        ...manifest,
        tokenSets,
        componentTokenOverrides: overrides,
      },
      result: true,
    };
  });
}

export async function extractTokenCandidates(componentPaths?: string[]): Promise<TokenCandidate[]> {
  return readCandidates(componentPaths);
}

export async function createFrequencyReport(
  componentPaths?: string[]
): Promise<TokenFrequencyReport> {
  const candidates = await readCandidates(componentPaths);
  const entriesByKey = new Map<string, TokenFrequencyEntry>();

  for (const candidate of candidates) {
    const key = `${candidate.category}:${candidate.value}`;
    const entry =
      entriesByKey.get(key) ??
      ({
        category: candidate.category,
        value: candidate.value,
        occurrences: 0,
        componentPaths: [],
        classes: [],
      } satisfies TokenFrequencyEntry);
    entry.occurrences += 1;
    if (!entry.componentPaths.includes(candidate.componentPath)) {
      entry.componentPaths.push(candidate.componentPath);
    }
    if (!entry.classes.includes(candidate.className)) {
      entry.classes.push(candidate.className);
    }
    entriesByKey.set(key, entry);
  }

  const entries = [...entriesByKey.values()].sort(
    (a, b) =>
      b.occurrences - a.occurrences ||
      a.category.localeCompare(b.category) ||
      a.value.localeCompare(b.value)
  );
  return {
    entries,
    totalOccurrences: candidates.length,
  };
}

export async function createInconsistencyReport(
  componentPaths?: string[]
): Promise<TokenInconsistencyReport> {
  const candidates = await readCandidates(componentPaths);
  const grouped = new Map<
    string,
    Map<string, { occurrences: number; componentPaths: Set<string> }>
  >();

  for (const candidate of candidates) {
    const utility = candidate.className.split(':').at(-1) || candidate.className;
    const family = INCONSISTENCY_FAMILIES.find(
      (entry) => entry.category === candidate.category && entry.pattern.test(utility)
    );
    if (!family) {
      continue;
    }
    const groupKey = `${family.category}:${family.family}`;
    const values = grouped.get(groupKey) ?? new Map();
    const value = values.get(candidate.value) ?? {
      occurrences: 0,
      componentPaths: new Set<string>(),
    };
    value.occurrences += 1;
    value.componentPaths.add(candidate.componentPath);
    values.set(candidate.value, value);
    grouped.set(groupKey, values);
  }

  const entries: TokenInconsistencyEntry[] = [];
  for (const [key, values] of grouped) {
    if (values.size < 2) {
      continue;
    }
    const [category, family] = key.split(':') as [TokenCategory, string];
    const normalizedValues = [...values.entries()]
      .map(([value, detail]) => ({
        value,
        occurrences: detail.occurrences,
        componentPaths: [...detail.componentPaths].sort(),
      }))
      .sort((a, b) => b.occurrences - a.occurrences || a.value.localeCompare(b.value));
    entries.push({
      category,
      family,
      values: normalizedValues,
      recommendedValue: normalizedValues[0].value,
    });
  }

  return { entries: entries.sort((a, b) => a.family.localeCompare(b.family)) };
}

function applyPatchChanges(
  content: string,
  changes: TokenPatchChange[]
): { content: string; changes: number } {
  let nextContent = content;
  let totalChanges = 0;

  for (const change of changes) {
    const escaped = change.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![\\w:/.-])${escaped}(?![\\w:/.-])`, 'g');
    const matches = nextContent.match(pattern);
    if (!matches) {
      continue;
    }
    totalChanges += matches.length;
    nextContent = nextContent.replace(pattern, change.to);
  }

  return { content: nextContent, changes: totalChanges };
}

export async function previewTokenPatch(
  componentPaths: string[],
  changes: TokenPatchChange[]
): Promise<TokenPatchPreviewResult> {
  const previews = [];
  let totalChanges = 0;

  for (const componentPath of componentPaths) {
    const safePath = await resolveSafeExistingComponentPath(componentPath);
    if (!safePath) {
      continue;
    }
    const content = await fs.readFile(safePath, 'utf-8');
    const patched = applyPatchChanges(content, changes);
    if (patched.changes > 0) {
      previews.push(createPreview(safePath, content, patched.content));
      totalChanges += patched.changes;
    }
  }

  return { previews, totalChanges };
}

async function tempPathFor(filePath: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadcn-tweaker-token-'));
  return path.join(tempDir, `${crypto.randomUUID()}-${path.basename(filePath)}`);
}

export async function applyTokenPatch(options: {
  tokenSetId: string;
  componentPaths: string[];
  changes: TokenPatchChange[];
  createBackup?: boolean;
  recordOverrides?: boolean;
}): Promise<TokenPatchApplyResult> {
  const modified: string[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  let totalChanges = 0;
  let backupId: string | undefined;
  const safePaths = (
    await Promise.all(
      options.componentPaths.map((componentPath) => resolveSafeExistingComponentPath(componentPath))
    )
  ).filter((componentPath): componentPath is string => typeof componentPath === 'string');

  if (options.createBackup ?? true) {
    const backup = await createBackup(safePaths);
    backupId = backup.id;
  }

  for (const componentPath of safePaths) {
    try {
      const content = await fs.readFile(componentPath, 'utf-8');
      const patched = applyPatchChanges(content, options.changes);
      if (patched.changes === 0) {
        continue;
      }
      const tmp = await tempPathFor(componentPath);
      await fs.writeFile(tmp, patched.content, 'utf-8');
      await fs.move(tmp, componentPath, { overwrite: true });
      modified.push(componentPath);
      totalChanges += patched.changes;
    } catch (error) {
      errors.push({
        path: componentPath,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  if ((options.recordOverrides ?? false) && errors.length === 0 && modified.length > 0) {
    await recordComponentOverrides(
      modified.map((componentPath) => ({
        componentPath,
        tokenSetId: options.tokenSetId,
        overrides: changesToOverrides(options.changes),
      }))
    );
  }

  return {
    success: errors.length === 0,
    modified,
    changes: totalChanges,
    backupId,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function changesToOverrides(changes: TokenPatchChange[]): ComponentTokenOverride['overrides'] {
  const overrides: ComponentTokenOverride['overrides'] = {};
  for (const change of changes) {
    const tokenName = change.tokenName ?? change.to;
    overrides[change.category] = {
      ...(overrides[change.category] ?? {}),
      [tokenName]: change.to,
    };
  }
  return overrides;
}

export async function getComponentOverrides(
  componentPath: string
): Promise<ComponentTokenOverride[]> {
  const manifest = await loadWorkspaceManifest();
  const safePath = await resolveSafeExistingComponentPath(componentPath);
  if (!safePath) {
    return [];
  }
  return (
    Object.entries(manifest.componentTokenOverrides).find(
      ([storedPath]) => storedPath === safePath
    )?.[1] ?? []
  );
}

export async function putComponentOverrides(
  componentPath: string,
  overrides: ComponentTokenOverride[]
): Promise<ComponentTokenOverride[]> {
  const safePath = await resolveSafeExistingComponentPath(componentPath);
  if (!safePath) {
    return [];
  }
  await recordComponentOverrides(
    overrides.map((override) => ({ ...override, componentPath: safePath }))
  );
  return getComponentOverrides(safePath);
}

async function recordComponentOverrides(overrides: ComponentTokenOverride[]): Promise<void> {
  await mutateWorkspaceManifest(async (manifest) => {
    const componentTokenOverrides = new Map<string, ComponentTokenOverride[]>(
      Object.entries(manifest.componentTokenOverrides)
    );
    for (const override of overrides) {
      const safePath = await resolveSafeExistingComponentPath(override.componentPath);
      if (!safePath) {
        continue;
      }
      const existing = componentTokenOverrides.get(safePath) ?? [];
      componentTokenOverrides.set(safePath, [
        ...existing.filter((candidate) => candidate.tokenSetId !== override.tokenSetId),
        { ...override, componentPath: safePath },
      ]);
    }

    const overrideEntries = [...componentTokenOverrides.entries()];
    const overridesByPath = Object.fromEntries(overrideEntries);

    return {
      manifest: {
        ...manifest,
        componentTokenOverrides: overridesByPath,
      },
      result: undefined,
    };
  });
}
