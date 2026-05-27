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

const SAFE_COMPONENT_IMPORT_PATH = /^[A-Za-z0-9._/-]+$/;
const SAFE_COMPONENT_EXPORT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PREVIEW_VARIANT_TOKEN = /^[A-Za-z0-9_-]+$/;
const SAFE_LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/;
const RESERVED_VARIANT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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
    !SAFE_COMPONENT_IMPORT_PATH.test(componentPath) ||
    !['.tsx', '.jsx'].includes(path.extname(componentPath))
  ) {
    throw new ComponentPreviewValidationError(
      'componentPath must be a safe project-relative TSX or JSX file.'
    );
  }

  return {
    componentPath,
    exportName: readExportName(record.exportName),
    viewport: readAllowed(
      record.viewport,
      Object.keys(PREVIEW_VIEWPORTS) as PreviewViewport[],
      'viewport'
    ),
    theme: readAllowed(record.theme, PREVIEW_THEMES, 'theme'),
    density: readAllowed(record.density, PREVIEW_DENSITIES, 'density'),
    state: readAllowed(record.state, PREVIEW_STATES, 'state'),
    parentOrigin: readPreviewOrigin(record.parentOrigin),
    variants:
      record.variants && typeof record.variants === 'object' && !Array.isArray(record.variants)
        ? readVariantsRecord(record.variants as Record<string, unknown>)
        : readVariantQueryEntries(record),
  };
}

function readExportName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ComponentPreviewValidationError('exportName must be a string.');
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === 'default') return trimmed;
  if (SAFE_COMPONENT_EXPORT_NAME.test(trimmed)) return trimmed;
  throw new ComponentPreviewValidationError(
    'exportName must be "default" or a safe JavaScript identifier.'
  );
}

function readVariantQueryEntries(
  record: Record<string, unknown>
): Record<string, string> | undefined {
  const variantEntries = Object.fromEntries(
    Object.entries(record)
      .filter(([key, value]) => key.startsWith('variant.') && typeof value === 'string')
      .map(([key, value]) => [key.slice('variant.'.length), value])
  );
  return readVariantsRecord(variantEntries);
}

function readVariantsRecord(input: Record<string, unknown>): Record<string, string> | undefined {
  const variants = Object.fromEntries(
    Object.entries(input)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key.trim(), value.trim()])
      .filter(
        ([key, value]) =>
          key.length > 0 &&
          value.length > 0 &&
          !RESERVED_VARIANT_KEYS.has(key) &&
          PREVIEW_VARIANT_TOKEN.test(key) &&
          PREVIEW_VARIANT_TOKEN.test(value)
      )
  );
  return Object.keys(variants).length > 0 ? variants : undefined;
}

function readAllowed<T extends string>(
  value: unknown,
  allowed: T[],
  fieldName: string
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ComponentPreviewValidationError(
      `${fieldName} must be one of: ${allowed.join(', ')}.`
    );
  }
  const match = allowed.find((option) => option === value);
  if (!match) {
    throw new ComponentPreviewValidationError(
      `${fieldName} must be one of: ${allowed.join(', ')}.`
    );
  }
  return match;
}

function readPreviewOrigin(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ComponentPreviewValidationError('parentOrigin must be a local HTTP origin.');
  }
  const trimmed = value.trim();
  if (!SAFE_LOCAL_ORIGIN.test(trimmed)) {
    throw new ComponentPreviewValidationError('parentOrigin must be a local HTTP origin.');
  }
  return trimmed;
}

async function resolvePreviewComponentPath(cwd: string, componentPath: string): Promise<string> {
  const rootPath = path.resolve(cwd);
  const absolutePath = path.resolve(rootPath, componentPath);
  const relativeToRoot = path.relative(rootPath, absolutePath);
  if (
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    throw new ComponentPreviewValidationError(
      'componentPath must resolve within the current workspace.'
    );
  }

  if (!(await fs.pathExists(absolutePath))) {
    throw new ComponentPreviewNotFoundError(`Component not found: ${componentPath}`);
  }

  const realRootPath = await fs.realpath(rootPath);
  const realComponentPath = await fs.realpath(absolutePath);
  const rootPrefix = realRootPath.endsWith(path.sep) ? realRootPath : `${realRootPath}${path.sep}`;
  if (realComponentPath !== realRootPath && !realComponentPath.startsWith(rootPrefix)) {
    throw new ComponentPreviewValidationError(
      'componentPath must resolve within the current workspace.'
    );
  }

  return absolutePath;
}

export async function createComponentPreviewManifest(
  cwd: string,
  input: unknown
): Promise<ComponentPreviewManifest> {
  const request = normalizePreviewRequest(input);
  await resolvePreviewComponentPath(cwd, request.componentPath);

  const detail = await getComponentLibraryDetail(cwd, request.componentPath);
  const variantDetail = await getVariantComponentDetail(cwd, request.componentPath);
  const defaultExport = chooseDefaultExport(detail.exports, request.exportName);

  return {
    component: {
      name: detail.name,
      path: detail.path,
      exports: detail.exports,
      defaultExport,
    },
    variants: variantDetail.definitions,
    states: PREVIEW_STATES,
    viewports: PREVIEW_VIEWPORTS,
    themes: PREVIEW_THEMES,
    densities: PREVIEW_DENSITIES,
    frameUrl: createPreviewFrameUrl({
      ...request,
      exportName: request.exportName,
    }),
    diagnostics: variantDetail.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
    })),
  };
}

function chooseDefaultExport(exports: string[], requested?: string): string {
  if (requested) {
    if (!exports.includes(requested)) {
      throw new ComponentPreviewValidationError(`Component export not found: ${requested}`);
    }
    return requested;
  }
  if (!exports[0]) {
    throw new ComponentPreviewValidationError('Component has no previewable exports.');
  }
  return exports[0];
}

export function createPreviewFrameUrl(request: ComponentPreviewRequest): string {
  return `${getPreviewOrigin()}/studio/preview/frame?${buildPreviewParams(request).toString()}`;
}

function buildPreviewParams(request: ComponentPreviewRequest): URLSearchParams {
  const params = new URLSearchParams();
  params.set('componentPath', request.componentPath);
  if (request.parentOrigin) params.set('parentOrigin', request.parentOrigin);
  if (request.exportName) params.set('exportName', request.exportName);
  params.set('viewport', request.viewport ?? 'desktop');
  params.set('theme', request.theme ?? 'light');
  params.set('density', request.density ?? 'default');
  params.set('state', request.state ?? 'default');
  for (const [key, value] of Object.entries(request.variants ?? {})) {
    params.append(`variant.${key}`, value);
  }
  return params;
}

export function createPreviewFrameHtml(request: ComponentPreviewRequest): string {
  const params = buildPreviewParams(request);

  const theme = escapeAttribute(request.theme ?? 'light');
  const density = escapeAttribute(request.density ?? 'default');
  const runtimeSrc = escapeAttribute(`/studio/preview/runtime?${params.toString()}`);
  return `<!doctype html>
<html lang="en" data-theme="${theme}" data-density="${density}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Component preview</title>
    <style>
      :root {
        color-scheme: light;
        --preview-frame-background: #ffffff;
        --preview-frame-foreground: #202124;
        --preview-frame-error-border: #c7372f;
        --preview-frame-error-foreground: #8f1f18;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--preview-frame-background);
        color: var(--preview-frame-foreground);
      }
      :root[data-theme="dark"] {
        color-scheme: dark;
        --preview-frame-background: #18191c;
        --preview-frame-foreground: #f7f7f4;
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
        border: 1px solid var(--preview-frame-error-border);
        border-radius: 8px;
        color: var(--preview-frame-error-foreground);
        max-width: 680px;
        padding: 16px;
      }
      .preview-error pre {
        overflow: auto;
        white-space: pre-wrap;
      }
      [data-force-hover="true"] :is(button, a, [role="button"]) {
        filter: brightness(0.96);
        outline: 2px solid currentColor;
        outline-offset: 2px;
      }
    </style>
  </head>
  <body>
    <div id="preview-root"></div>
    <script type="module" src="${runtimeSrc}"></script>
  </body>
</html>`;
}

export async function createPreviewRuntimeModule(
  cwd: string,
  request: ComponentPreviewRequest
): Promise<string> {
  await resolvePreviewComponentPath(cwd, request.componentPath);

  const componentModulePath = `/studio/preview/component/${encodeURIComponent(
    request.componentPath
  )}`;
  const detail = await getComponentLibraryDetail(cwd, request.componentPath);
  const exportName = chooseDefaultExport(detail.exports, request.exportName);
  const parentOrigin = request.parentOrigin ?? getStudioOrigin();
  const previewProps = createPreviewProps(request);

  // Request-derived values in this generated module must stay data-only. Use
  // JSON.stringify for every embedded runtime value instead of code interpolation.
  return `import React from 'react';
import { createRoot } from 'react-dom/client';
import * as ComponentModule from ${JSON.stringify(componentModulePath)};

const exportName = ${JSON.stringify(exportName)};
const parentOrigin = ${JSON.stringify(parentOrigin)};
const previewProps = ${JSON.stringify(previewProps, null, 2)};
const rootElement = document.getElementById('preview-root');

class PreviewErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    window.parent?.postMessage({
      type: 'shadcn-tweaker-preview-error',
      code: 'PREVIEW_RENDER_ERROR',
      message: error instanceof Error ? error.message : String(error),
    }, parentOrigin);
  }
  render() {
    if (this.state.error) {
      return React.createElement('div', { className: 'preview-error', role: 'alert' },
        React.createElement('strong', null, 'Preview render failed'),
        React.createElement('pre', null, this.state.error instanceof Error ? this.state.error.message : String(this.state.error))
      );
    }
    return this.props.children;
  }
}

function renderPreviewError(message, code = 'PREVIEW_RUNTIME_ERROR') {
  if (!rootElement) return;
  rootElement.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'preview-error';
  wrapper.setAttribute('role', 'alert');
  wrapper.innerHTML = '<strong>Preview unavailable</strong><pre></pre>';
  wrapper.querySelector('pre').textContent = message;
  rootElement.append(wrapper);
  window.parent?.postMessage({ type: 'shadcn-tweaker-preview-error', code, message }, parentOrigin);
}

if (!rootElement) {
  throw new Error('Preview root element is missing.');
}

const Component = ComponentModule[exportName] ?? (exportName === 'default' ? ComponentModule.default : undefined);
if (!Component) {
  renderPreviewError(\`Component export not found: \${exportName}\`, 'PREVIEW_EXPORT_NOT_FOUND');
} else {
  const root = createRoot(rootElement);
  root.render(
    React.createElement(PreviewErrorBoundary, null,
      React.createElement('div', {
        'data-preview-state': previewProps['data-preview-state'],
        'data-preview-label': previewProps['data-preview-label'],
        'data-force-hover': previewProps['data-force-hover'],
        'data-preview-variants': JSON.stringify(previewProps.variants ?? {}),
      }, React.createElement(Component, previewProps))
    )
  );
  if (previewProps['data-preview-state'] === 'focus') {
    window.requestAnimationFrame(() => {
      const focusTarget = rootElement.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      focusTarget?.focus?.();
    });
  }
}`;
}

export function createPreviewComponentImportModule(componentPath: string): string {
  const sourcePath = JSON.stringify(`/${componentPath}`);
  return `import * as PreviewModule from ${sourcePath};
export * from ${sourcePath};
export default PreviewModule.default;
`;
}

function createPreviewProps(request: ComponentPreviewRequest): Record<string, unknown> {
  const state = request.state ?? 'default';
  return {
    disabled: state === 'disabled' || undefined,
    loading: state === 'loading' || undefined,
    open: state === 'open' || undefined,
    'aria-selected': state === 'selected' ? true : undefined,
    'data-state': state === 'open' ? 'open' : state === 'selected' ? 'selected' : undefined,
    'data-force-hover': state === 'hover' ? true : undefined,
    'data-preview-state': state,
    'data-preview-label': previewLabel(request),
    variants: request.variants ?? {},
    ...(request.variants ?? {}),
  };
}

function previewLabel(request: ComponentPreviewRequest): string {
  const state = request.state && request.state !== 'default' ? ` ${request.state}` : '';
  return `Preview${state}`;
}

function escapeAttribute(value: string): string {
  // Preview frame attributes are double-quoted; escaping " is the quote boundary guard.
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readPort(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return port > 0 && port <= 65535 ? port : undefined;
}

export function getPreviewPort(mainPort = process.env.PORT): number {
  return readPort(process.env.PREVIEW_PORT) ?? (readPort(mainPort) ?? 3000) + 1;
}

export function getPreviewOrigin(mainPort = process.env.PORT): string {
  if (process.env.PREVIEW_ORIGIN && SAFE_LOCAL_ORIGIN.test(process.env.PREVIEW_ORIGIN)) {
    return process.env.PREVIEW_ORIGIN;
  }
  return `http://127.0.0.1:${getPreviewPort(mainPort)}`;
}

export function getStudioOrigin(mainPort = process.env.PORT): string {
  if (process.env.STUDIO_ORIGIN && SAFE_LOCAL_ORIGIN.test(process.env.STUDIO_ORIGIN)) {
    return process.env.STUDIO_ORIGIN;
  }
  return `http://127.0.0.1:${readPort(mainPort) ?? 3000}`;
}
