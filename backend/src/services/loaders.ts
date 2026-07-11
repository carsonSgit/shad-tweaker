import { BRAILLE_LOADER_PRESETS } from '../data/brailleLoaders.js';
import type {
  BrailleLoaderCustomization,
  BrailleLoaderGenerated,
  BrailleLoaderPreset,
  BrailleLoaderReducedMotionMode,
} from '../types/index.js';

export class LoaderValidationError extends Error {
  readonly code = 'LOADER_VALIDATION_ERROR';
}

export const MIN_LOADER_INTERVAL_MS = 30;
export const MAX_LOADER_INTERVAL_MS = 2000;
export const MIN_LOADER_SIZE_REM = 0.5;
export const MAX_LOADER_SIZE_REM = 8;
export const MAX_LOADER_LABEL_LENGTH = 120;
export const MAX_LOADER_COLOR_LENGTH = 64;

const COMPONENT_NAME_PATTERN = /^[A-Z][A-Za-z0-9]{0,47}$/;
// Restricts colors to plain CSS color syntax (hex, rgb()/hsl()/oklch(), named
// colors, var(--token) references) so a color can never break out of the
// string literal it is embedded in inside generated code.
const COLOR_PATTERN = /^[a-zA-Z0-9#(),.%\s/_-]+$/;

export function listBrailleLoaderPresets(): BrailleLoaderPreset[] {
  return BRAILLE_LOADER_PRESETS;
}

export function getBrailleLoaderPreset(id: string): BrailleLoaderPreset {
  const preset = BRAILLE_LOADER_PRESETS.find((entry) => entry.id === id);
  if (!preset) {
    throw new LoaderValidationError(`Unknown braille loader preset: ${id}`);
  }
  return preset;
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
}

function resolveComponentName(preset: BrailleLoaderPreset, requested?: string): string {
  if (requested === undefined) {
    return `${toPascalCase(preset.name)}Loader`;
  }
  if (!COMPONENT_NAME_PATTERN.test(requested)) {
    throw new LoaderValidationError(
      'componentName must be a PascalCase identifier of at most 48 characters.'
    );
  }
  return requested;
}

function resolveInterval(preset: BrailleLoaderPreset, requested?: number): number {
  if (requested === undefined) return preset.intervalMs;
  if (
    typeof requested !== 'number' ||
    !Number.isFinite(requested) ||
    requested < MIN_LOADER_INTERVAL_MS ||
    requested > MAX_LOADER_INTERVAL_MS
  ) {
    throw new LoaderValidationError(
      `intervalMs must be a number between ${MIN_LOADER_INTERVAL_MS} and ${MAX_LOADER_INTERVAL_MS}.`
    );
  }
  return Math.round(requested);
}

function resolveLabel(preset: BrailleLoaderPreset, requested?: string): string {
  if (requested === undefined) return preset.defaultLabel;
  const label = requested.trim();
  if (!label || label.length > MAX_LOADER_LABEL_LENGTH) {
    throw new LoaderValidationError(
      `label must be a non-empty string of at most ${MAX_LOADER_LABEL_LENGTH} characters.`
    );
  }
  return label;
}

function resolveSize(requested?: number): number | undefined {
  if (requested === undefined) return undefined;
  if (
    typeof requested !== 'number' ||
    !Number.isFinite(requested) ||
    requested < MIN_LOADER_SIZE_REM ||
    requested > MAX_LOADER_SIZE_REM
  ) {
    throw new LoaderValidationError(
      `sizeRem must be a number between ${MIN_LOADER_SIZE_REM} and ${MAX_LOADER_SIZE_REM}.`
    );
  }
  return requested;
}

function resolveColor(requested?: string): string | undefined {
  if (requested === undefined) return undefined;
  const color = requested.trim();
  if (!color) return undefined;
  if (color.length > MAX_LOADER_COLOR_LENGTH || !COLOR_PATTERN.test(color)) {
    throw new LoaderValidationError('color must be a plain CSS color or var(--token) reference.');
  }
  return color;
}

function resolveReducedMotionMode(requested?: string): BrailleLoaderReducedMotionMode {
  if (requested === undefined) return 'static-frame';
  if (requested !== 'static-frame' && requested !== 'label-only') {
    throw new LoaderValidationError("reducedMotionMode must be 'static-frame' or 'label-only'.");
  }
  return requested;
}

/**
 * Generates a self-contained, accessible React loader component from a curated
 * preset plus user customization. The output has no dependencies beyond React,
 * announces its label via role="status", and honors prefers-reduced-motion.
 */
export function generateBrailleLoader(input: BrailleLoaderCustomization): BrailleLoaderGenerated {
  const preset = getBrailleLoaderPreset(input.presetId);
  const componentName = resolveComponentName(preset, input.componentName);
  const intervalMs = resolveInterval(preset, input.intervalMs);
  const label = resolveLabel(preset, input.label);
  const sizeRem = resolveSize(input.sizeRem);
  const color = resolveColor(input.color);
  const reducedMotionMode = resolveReducedMotionMode(input.reducedMotionMode);

  const styleEntries = ["display: 'inline-flex'", "alignItems: 'center'", "gap: '0.5em'"];
  if (sizeRem !== undefined) styleEntries.push(`fontSize: '${sizeRem}rem'`);
  if (color !== undefined) styleEntries.push(`color: ${JSON.stringify(color)}`);

  const reducedMotionGlyph =
    reducedMotionMode === 'static-frame'
      ? `<span aria-hidden="true">${preset.reducedMotionFrame}</span>`
      : null;

  const code = `import { type CSSProperties, useEffect, useState } from 'react';

const FRAMES = ${JSON.stringify(preset.frames)};
const INTERVAL_MS = ${intervalMs};

const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function ${componentName}({ label = ${JSON.stringify(label)} }: { label?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => {
      setFrame((current) => (current + 1) % FRAMES.length);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reducedMotion]);

  return (
    <span role="status" aria-live="polite" style={{ ${styleEntries.join(', ')} }}>
      ${
        reducedMotionGlyph
          ? `{reducedMotion ? (
        ${reducedMotionGlyph}
      ) : (
        <span aria-hidden="true">{FRAMES[frame]}</span>
      )}
      <span style={VISUALLY_HIDDEN}>{label}</span>`
          : `{reducedMotion ? (
        <span>{label}</span>
      ) : (
        <>
          <span aria-hidden="true">{FRAMES[frame]}</span>
          <span style={VISUALLY_HIDDEN}>{label}</span>
        </>
      )}`
      }
    </span>
  );
}
`;

  return {
    presetId: preset.id,
    componentName,
    fileName: `${componentName}.tsx`,
    code,
    intervalMs,
    label,
    reducedMotionMode,
  };
}
