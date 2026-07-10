import fs from 'fs-extra';
import type {
  MotionApplyResult,
  MotionOutput,
  MotionPhase,
  MotionPreset,
  MotionSettings,
  MotionSlot,
  Preview,
} from '../types/index.js';
import { resolveWithinWorkspace, toWorkspaceRelative, WorkspacePathError } from '../utils/paths.js';
import { createBackup } from './backup.js';
import { createPreview } from './differ.js';
import { parseComponentSource } from './parser.js';
import {
  getWorkingDirectory,
  loadWorkspaceManifest,
  mutateWorkspaceManifest,
} from './workspace.js';

export class MotionValidationError extends Error {
  readonly code = 'MOTION_VALIDATION_ERROR';
}

export const MOTION_EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export const MOTION_TRANSFORM_ORIGINS = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;
export const MOTION_REDUCED_MOTION_BEHAVIORS = ['disable', 'fade-only', 'full'] as const;

export const MAX_MOTION_DURATION_MS = 10000;
export const MAX_MOTION_TRANSLATE_PX = 400;
export const MAX_MOTION_SCALE = 4;

export const DEFAULT_MOTION_SETTINGS: MotionSettings = {
  durationMs: 200,
  delayMs: 0,
  easing: 'ease-out',
  transformOrigin: 'center',
  enter: { opacity: 0, scale: 0.95, translateX: 0, translateY: 8 },
  exit: { opacity: 0, scale: 0.95, translateX: 0, translateY: 8 },
  reducedMotion: 'fade-only',
};

function readNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new MotionValidationError(`${field} must be a number between ${min} and ${max}.`);
  }
  return value;
}

function readChoice<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new MotionValidationError(`${field} must be one of: ${choices.join(', ')}.`);
  }
  return value as T;
}

function readPhase(value: unknown, field: string): MotionPhase {
  if (!value || typeof value !== 'object') {
    throw new MotionValidationError(`${field} is required.`);
  }
  const record = value as Record<string, unknown>;
  return {
    opacity: readNumber(record.opacity, `${field}.opacity`, 0, 1),
    scale: readNumber(record.scale, `${field}.scale`, 0, MAX_MOTION_SCALE),
    translateX: readNumber(
      record.translateX,
      `${field}.translateX`,
      -MAX_MOTION_TRANSLATE_PX,
      MAX_MOTION_TRANSLATE_PX
    ),
    translateY: readNumber(
      record.translateY,
      `${field}.translateY`,
      -MAX_MOTION_TRANSLATE_PX,
      MAX_MOTION_TRANSLATE_PX
    ),
  };
}

/** Bounds-checks untrusted motion settings and returns a normalized copy. */
export function validateMotionSettings(value: unknown): MotionSettings {
  if (!value || typeof value !== 'object') {
    throw new MotionValidationError('settings is required.');
  }
  const record = value as Record<string, unknown>;
  return {
    durationMs: readNumber(record.durationMs, 'settings.durationMs', 0, MAX_MOTION_DURATION_MS),
    delayMs: readNumber(record.delayMs, 'settings.delayMs', 0, MAX_MOTION_DURATION_MS),
    easing: readChoice(record.easing, 'settings.easing', MOTION_EASINGS),
    transformOrigin: readChoice(
      record.transformOrigin,
      'settings.transformOrigin',
      MOTION_TRANSFORM_ORIGINS
    ),
    enter: readPhase(record.enter, 'settings.enter'),
    exit: readPhase(record.exit, 'settings.exit'),
    reducedMotion: readChoice(
      record.reducedMotion,
      'settings.reducedMotion',
      MOTION_REDUCED_MOTION_BEHAVIORS
    ),
  };
}

function phaseIsIdentity(phase: MotionPhase): boolean {
  return (
    phase.opacity === 1 && phase.scale === 1 && phase.translateX === 0 && phase.translateY === 0
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function tailwindPhaseClasses(phase: MotionPhase, direction: 'in' | 'out'): string[] {
  const classes: string[] = [];
  if (phase.opacity !== 1) {
    classes.push(`fade-${direction}-${round(phase.opacity * 100)}`);
  }
  if (phase.scale !== 1) {
    classes.push(`${direction === 'in' ? 'zoom-in' : 'zoom-out'}-${round(phase.scale * 100)}`);
  }
  if (phase.translateX !== 0) {
    const edge = phase.translateX > 0 ? 'right' : 'left';
    const px = Math.abs(round(phase.translateX));
    classes.push(
      direction === 'in' ? `slide-in-from-${edge}-[${px}px]` : `slide-out-to-${edge}-[${px}px]`
    );
  }
  if (phase.translateY !== 0) {
    const edge = phase.translateY > 0 ? 'bottom' : 'top';
    const px = Math.abs(round(phase.translateY));
    classes.push(
      direction === 'in' ? `slide-in-from-${edge}-[${px}px]` : `slide-out-to-${edge}-[${px}px]`
    );
  }
  return classes;
}

/**
 * Builds the two supported output formats for a motion configuration:
 * Tailwind utilities (tailwindcss-animate idiom used across shadcn/ui) and a
 * standalone CSS block driven by variables, including the reduced-motion rule.
 */
export function buildMotionOutput(settings: MotionSettings): MotionOutput {
  const easingClass =
    settings.easing === 'ease'
      ? 'ease-[ease]'
      : settings.easing === 'linear'
        ? 'ease-linear'
        : settings.easing; // 'ease-in' | 'ease-out' | 'ease-in-out' are already Tailwind classes

  const tailwind: string[] = [
    `duration-[${settings.durationMs}ms]`,
    ...(settings.delayMs > 0 ? [`delay-[${settings.delayMs}ms]`] : []),
    easingClass,
    `origin-${settings.transformOrigin}`,
  ];
  if (!phaseIsIdentity(settings.enter)) {
    tailwind.push('animate-in', ...tailwindPhaseClasses(settings.enter, 'in'));
  }
  if (!phaseIsIdentity(settings.exit)) {
    tailwind.push('animate-out', ...tailwindPhaseClasses(settings.exit, 'out'));
  }
  if (settings.reducedMotion === 'disable') {
    tailwind.push('motion-reduce:animate-none', 'motion-reduce:transition-none');
  } else if (settings.reducedMotion === 'fade-only') {
    tailwind.push('motion-reduce:transform-none');
  }

  const phaseTransform = (phase: MotionPhase) =>
    `translate(${round(phase.translateX)}px, ${round(phase.translateY)}px) scale(${round(phase.scale)})`;

  const reducedMotionCss =
    settings.reducedMotion === 'full'
      ? ''
      : `
@media (prefers-reduced-motion: reduce) {
${
  settings.reducedMotion === 'disable'
    ? `  .motion-preset[data-motion] {
    animation: none;
  }`
    : `  @keyframes motion-enter {
    from { opacity: ${round(settings.enter.opacity)}; transform: none; }
    to { opacity: 1; transform: none; }
  }
  @keyframes motion-exit {
    from { opacity: 1; transform: none; }
    to { opacity: ${round(settings.exit.opacity)}; transform: none; }
  }`
}
}
`;

  const css = `.motion-preset {
  --motion-duration: ${settings.durationMs}ms;
  --motion-delay: ${settings.delayMs}ms;
  --motion-ease: ${settings.easing};
  transform-origin: ${settings.transformOrigin.replace('-', ' ')};
}

.motion-preset[data-motion='enter'] {
  animation: motion-enter var(--motion-duration) var(--motion-ease) var(--motion-delay) both;
}

.motion-preset[data-motion='exit'] {
  animation: motion-exit var(--motion-duration) var(--motion-ease) var(--motion-delay) both;
}

@keyframes motion-enter {
  from { opacity: ${round(settings.enter.opacity)}; transform: ${phaseTransform(settings.enter)}; }
  to { opacity: 1; transform: none; }
}

@keyframes motion-exit {
  from { opacity: 1; transform: none; }
  to { opacity: ${round(settings.exit.opacity)}; transform: ${phaseTransform(settings.exit)}; }
}
${reducedMotionCss}`;

  return { tailwindClasses: tailwind.join(' '), css };
}

function resolveComponentPath(componentPath: string): { relative: string; absolute: string } {
  const root = getWorkingDirectory();
  try {
    const absolute = resolveWithinWorkspace(root, componentPath, {
      extensions: ['.tsx', '.jsx'],
    });
    return { relative: toWorkspaceRelative(root, absolute), absolute };
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      throw new MotionValidationError(
        'componentPath must be a safe project-relative TSX or JSX file.'
      );
    }
    throw error;
  }
}

async function readComponentFile(absolutePath: string, componentPath: string): Promise<string> {
  try {
    return await fs.readFile(absolutePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new MotionValidationError(`Component file not found: ${componentPath}`);
    }
    throw error;
  }
}

/** Lists className locations ("slots") in a component that motion can target. */
export async function listMotionSlots(componentPath: string): Promise<MotionSlot[]> {
  const { relative: normalized, absolute } = resolveComponentPath(componentPath);
  const content = await readComponentFile(absolute, normalized);
  const parsed = parseComponentSource(normalized, content);
  return parsed.classNameAttributes.map((attribute) => ({
    line: attribute.line,
    tagName: attribute.tagName,
    classes: attribute.classes,
    patchable: attribute.kind === 'string',
  }));
}

/**
 * Inserts motion classes into the string-literal className on the given line.
 * Returns the patched content, or null when the line has no static className.
 */
function patchClassNameLine(content: string, line: number, motionClasses: string[]): string | null {
  const lines = content.split('\n');
  if (line < 1 || line > lines.length) return null;
  const target = lines[line - 1];
  const match = target.match(/className\s*=\s*(["'])([^"']*)\1/);
  if (!match || match.index === undefined) return null;

  const quote = match[1];
  const existing = match[2].split(/\s+/).filter(Boolean);
  const additions = motionClasses.filter((cls) => !existing.includes(cls));
  if (additions.length === 0) return content;

  const nextValue = [...existing, ...additions].join(' ');
  lines[line - 1] =
    target.slice(0, match.index) +
    `className=${quote}${nextValue}${quote}` +
    target.slice(match.index + match[0].length);
  return lines.join('\n');
}

export async function previewMotionSlotPatch(input: {
  componentPath: string;
  line: number;
  settings: MotionSettings;
}): Promise<{ previews: Preview[]; totalChanges: number; tailwindClasses: string }> {
  const { relative: normalized, absolute } = resolveComponentPath(input.componentPath);
  const content = await readComponentFile(absolute, normalized);
  const output = buildMotionOutput(input.settings);
  const motionClasses = output.tailwindClasses.split(' ');
  const patched = patchClassNameLine(content, input.line, motionClasses);
  if (patched === null) {
    throw new MotionValidationError(
      `Line ${input.line} of ${normalized} has no static string className to patch.`
    );
  }
  if (patched === content) {
    return { previews: [], totalChanges: 0, tailwindClasses: output.tailwindClasses };
  }
  return {
    previews: [createPreview(absolute, content, patched)],
    totalChanges: 1,
    tailwindClasses: output.tailwindClasses,
  };
}

export async function applyMotionSlotPatch(input: {
  componentPath: string;
  line: number;
  settings: MotionSettings;
  createBackup?: boolean;
}): Promise<MotionApplyResult> {
  const { relative: normalized, absolute } = resolveComponentPath(input.componentPath);
  const content = await readComponentFile(absolute, normalized);
  const output = buildMotionOutput(input.settings);
  const patched = patchClassNameLine(content, input.line, output.tailwindClasses.split(' '));
  if (patched === null) {
    throw new MotionValidationError(
      `Line ${input.line} of ${normalized} has no static string className to patch.`
    );
  }
  if (patched === content) {
    return { success: true, modified: [], changes: 0 };
  }

  let backupId: string | undefined;
  if (input.createBackup ?? true) {
    const backup = await createBackup([absolute]);
    backupId = backup.id;
  }
  await fs.writeFile(absolute, patched, 'utf-8');
  return { success: true, modified: [absolute], changes: 1, backupId };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export async function listMotionPresets(): Promise<MotionPreset[]> {
  const manifest = await loadWorkspaceManifest();
  return manifest.motionPresets ?? [];
}

export async function createMotionPreset(input: {
  name: string;
  description?: string;
  settings: MotionSettings;
}): Promise<MotionPreset> {
  const name = input.name.trim();
  if (!name) {
    throw new MotionValidationError('Preset name is required.');
  }
  const settings = validateMotionSettings(input.settings);
  const baseId = `motion_${slugify(name) || Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();

  return mutateWorkspaceManifest(async (manifest) => {
    const existing = manifest.motionPresets ?? [];
    const taken = new Set(existing.map((preset) => preset.id));
    let id = baseId;
    for (let suffix = 2; taken.has(id); suffix += 1) {
      id = `${baseId}-${suffix}`;
    }
    const preset: MotionPreset = {
      id,
      name,
      description: input.description?.trim() || undefined,
      created: now,
      settings,
    };
    return {
      manifest: { ...manifest, motionPresets: [...existing, preset] },
      result: preset,
    };
  });
}

export async function deleteMotionPreset(id: string): Promise<boolean> {
  return mutateWorkspaceManifest(async (manifest) => {
    const presets = (manifest.motionPresets ?? []).filter((preset) => preset.id !== id);
    return {
      manifest: { ...manifest, motionPresets: presets },
      result: presets.length !== (manifest.motionPresets ?? []).length,
    };
  });
}
