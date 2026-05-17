import path from 'node:path';
import fs from 'fs-extra';
import type {
  ComponentPreviewManifest,
  ComponentPreviewRequest,
  PreviewDensity,
  PreviewState,
  PreviewTheme,
  PreviewViewport,
} from '../types/index.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';
import { getComponentLibraryDetail } from './componentLibrary.js';
import { getVariantComponentDetail } from './variants.js';

export class ComponentPreviewValidationError extends Error {
  readonly code = 'COMPONENT_PREVIEW_VALIDATION_ERROR';
}

export class ComponentPreviewNotFoundError extends Error {
  readonly code = 'COMPONENT_PREVIEW_NOT_FOUND';
}

export const PREVIEW_STATES: PreviewState[] = [
  'default',
  'hover',
  'focus',
  'disabled',
  'loading',
  'open',
  'selected',
];

export const PREVIEW_VIEWPORTS: Record<PreviewViewport, { width: number; height: number }> = {
  desktop: { width: 1200, height: 720 },
  tablet: { width: 768, height: 720 },
  mobile: { width: 390, height: 720 },
};

export const PREVIEW_THEMES: PreviewTheme[] = ['light', 'dark', 'system'];
export const PREVIEW_DENSITIES: PreviewDensity[] = ['comfortable', 'default', 'compact'];

export function normalizePreviewRequest(input: unknown): ComponentPreviewRequest {
  if (!input || typeof input !== 'object') {
    throw new ComponentPreviewValidationError('Preview request body is required.');
  }

  const record = input as Partial<ComponentPreviewRequest>;
  if (typeof record.componentPath !== 'string' || record.componentPath.trim().length === 0) {
    throw new ComponentPreviewValidationError('componentPath must be a non-empty string.');
  }

  const componentPath = record.componentPath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    componentPath.includes('\0') ||
    path.isAbsolute(componentPath) ||
    !isSafeProjectRelativePath(componentPath) ||
    !['.tsx', '.jsx'].includes(path.extname(componentPath))
  ) {
    throw new ComponentPreviewValidationError(
      'componentPath must be a safe project-relative TSX or JSX file.'
    );
  }

  return {
    componentPath,
    exportName: typeof record.exportName === 'string' ? record.exportName.trim() : undefined,
    viewport: readAllowed(record.viewport, Object.keys(PREVIEW_VIEWPORTS) as PreviewViewport[]),
    theme: readAllowed(record.theme, PREVIEW_THEMES),
    density: readAllowed(record.density, PREVIEW_DENSITIES),
    state: readAllowed(record.state, PREVIEW_STATES),
    variants:
      record.variants && typeof record.variants === 'object' && !Array.isArray(record.variants)
        ? Object.fromEntries(
            Object.entries(record.variants).filter(
              (entry): entry is [string, string] =>
                typeof entry[0] === 'string' && typeof entry[1] === 'string'
            )
          )
        : undefined,
  };
}

function readAllowed<T extends string>(value: unknown, allowed: T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ComponentPreviewValidationError(`Unsupported preview option: ${String(value)}.`);
  }
  return value as T;
}

export async function createComponentPreviewManifest(
  cwd: string,
  input: unknown
): Promise<ComponentPreviewManifest> {
  const request = normalizePreviewRequest(input);
  const absolutePath = path.resolve(cwd, request.componentPath);
  if (!(await fs.pathExists(absolutePath))) {
    throw new ComponentPreviewNotFoundError(`Component not found: ${request.componentPath}`);
  }

  const detail = await getComponentLibraryDetail(cwd, request.componentPath);
  const variants = await readVariantDefinitions(cwd, request.componentPath);
  const defaultExport = chooseDefaultExport(detail.exports, request.exportName);

  return {
    component: {
      name: detail.name,
      path: detail.path,
      exports: detail.exports,
      defaultExport,
    },
    variants,
    states: PREVIEW_STATES,
    viewports: PREVIEW_VIEWPORTS,
    themes: PREVIEW_THEMES,
    densities: PREVIEW_DENSITIES,
    frameUrl: createPreviewFrameUrl({
      ...request,
      exportName: defaultExport,
    }),
    diagnostics: [],
  };
}

function chooseDefaultExport(exports: string[], requested?: string): string {
  if (requested) {
    if (!exports.includes(requested)) {
      throw new ComponentPreviewValidationError(`Component export not found: ${requested}`);
    }
    return requested;
  }
  return exports[0] ?? 'default';
}

async function readVariantDefinitions(cwd: string, componentPath: string) {
  return (await getVariantComponentDetail(cwd, componentPath)).definitions;
}

export function createPreviewFrameUrl(request: ComponentPreviewRequest): string {
  const params = new URLSearchParams();
  params.set('componentPath', request.componentPath);
  if (request.exportName) params.set('exportName', request.exportName);
  params.set('viewport', request.viewport ?? 'desktop');
  params.set('theme', request.theme ?? 'light');
  params.set('density', request.density ?? 'default');
  params.set('state', request.state ?? 'default');
  for (const [key, value] of Object.entries(request.variants ?? {})) {
    params.append(`variant.${key}`, value);
  }
  return `/studio/preview/frame?${params.toString()}`;
}

export function createPreviewFrameHtml(request: ComponentPreviewRequest): string {
  const normalized = normalizePreviewRequest(request);
  const params = new URLSearchParams();
  params.set('componentPath', normalized.componentPath);
  if (normalized.exportName) params.set('exportName', normalized.exportName);
  params.set('viewport', normalized.viewport ?? 'desktop');
  params.set('theme', normalized.theme ?? 'light');
  params.set('density', normalized.density ?? 'default');
  params.set('state', normalized.state ?? 'default');
  for (const [key, value] of Object.entries(normalized.variants ?? {})) {
    params.append(`variant.${key}`, value);
  }

  const theme = escapeAttribute(normalized.theme ?? 'light');
  const density = escapeAttribute(normalized.density ?? 'default');
  return `<!doctype html>
<html lang="en" data-theme="${theme}" data-density="${density}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Component preview</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #ffffff;
        color: #202124;
      }
      :root[data-theme="dark"] {
        color-scheme: dark;
        background: #18191c;
        color: #f7f7f4;
      }
      body {
        margin: 0;
        min-height: 100vh;
      }
      #preview-root {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: var(--preview-padding, 32px);
      }
      :root[data-density="compact"] #preview-root { --preview-padding: 16px; }
      :root[data-density="comfortable"] #preview-root { --preview-padding: 48px; }
      .preview-error {
        border: 1px solid #c7372f;
        border-radius: 8px;
        color: #8f1f18;
        max-width: 680px;
        padding: 16px;
      }
      .preview-error pre {
        overflow: auto;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div id="preview-root"></div>
    <script type="module" src="/studio/preview/runtime?${params.toString()}"></script>
  </body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
