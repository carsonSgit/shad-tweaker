import type {
  ComponentPreviewManifest,
  PreviewDensity,
  PreviewState,
  PreviewTheme,
  PreviewViewport,
  VariantAxis,
} from '@studio-shared';

export const DEFAULT_VIEWPORT: PreviewViewport = 'desktop';
export const DEFAULT_THEME: PreviewTheme = 'light';
export const DEFAULT_DENSITY: PreviewDensity = 'default';
export const DEFAULT_STATE: PreviewState = 'default';
export const VARIANT_GRID_LIMIT = 20;

export interface PreviewSelection {
  componentPath: string;
  exportName: string;
  viewport: PreviewViewport;
  theme: PreviewTheme;
  density: PreviewDensity;
  state: PreviewState;
  variants: Record<string, string>;
  inspectorClassName?: string;
}

export function createInitialSelection(componentPath: string): PreviewSelection {
  return {
    componentPath,
    exportName: '',
    viewport: DEFAULT_VIEWPORT,
    theme: DEFAULT_THEME,
    density: DEFAULT_DENSITY,
    state: DEFAULT_STATE,
    variants: {},
  };
}

export function selectionFromManifest(
  manifest: ComponentPreviewManifest,
  previous: PreviewSelection
): PreviewSelection {
  // Milestone 41 previews the primary variant definition; multi-definition controls are future work.
  const definition = manifest.variants[0];
  return {
    ...previous,
    componentPath: manifest.component.path,
    exportName: manifest.component.defaultExport,
    variants: defaultVariantSelection(definition?.axes ?? []),
  };
}

export function defaultVariantSelection(axes: VariantAxis[]): Record<string, string> {
  return Object.fromEntries(
    axes
      .map((axis) => [axis.name, axis.defaultValue ?? axis.values[0]?.name])
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}

export interface VariantGridSelections {
  selections: Array<Record<string, string>>;
  total: number;
  truncated: boolean;
}

export function variantGridSelections(
  axes: VariantAxis[],
  limit = VARIANT_GRID_LIMIT
): VariantGridSelections {
  const total = axes.reduce((count, axis) => count * Math.max(axis.values.length, 1), 1);
  // No axes still represents one preview: the unmodified/default component state.
  if (axes.length === 0) return { selections: [{}], total, truncated: false };

  const selections: Array<Record<string, string>> = [{}];
  for (const axis of axes) {
    const rows = selections.splice(0, selections.length);
    for (const row of rows) {
      for (const value of axis.values) {
        if (selections.length >= limit) {
          return { selections, total, truncated: total > selections.length };
        }
        selections.push({ ...row, [axis.name]: value.name });
      }
    }
  }

  return { selections, total, truncated: total > selections.length };
}

export function previewFrameUrl(selection: PreviewSelection, baseFrameUrl: string): string {
  const url = new URL(baseFrameUrl, window.location.href);
  const params = url.searchParams;
  params.set('componentPath', selection.componentPath);
  if (selection.exportName) params.set('exportName', selection.exportName);
  params.set('parentOrigin', window.location.origin);
  params.set('viewport', selection.viewport);
  params.set('theme', selection.theme);
  params.set('density', selection.density);
  params.set('state', selection.state);
  if (selection.inspectorClassName) params.set('inspectorClassName', selection.inspectorClassName);
  for (const [axis, value] of Object.entries(selection.variants)) {
    params.set(`variant.${axis}`, value);
  }
  url.search = params.toString();
  return url.toString();
}

export function describeVariants(variants: Record<string, string>): string {
  const entries = Object.entries(variants);
  return entries.length === 0
    ? 'Default'
    : entries.map(([axis, value]) => `${axis}: ${value}`).join(', ');
}
