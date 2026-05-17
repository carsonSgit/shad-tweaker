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

export interface PreviewSelection {
  componentPath: string;
  exportName: string;
  viewport: PreviewViewport;
  theme: PreviewTheme;
  density: PreviewDensity;
  state: PreviewState;
  variants: Record<string, string>;
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

export function variantGridSelections(axes: VariantAxis[]): Array<Record<string, string>> {
  if (axes.length === 0) return [{}];
  return axes.reduce<Array<Record<string, string>>>(
    (rows, axis) =>
      rows.flatMap((row) =>
        axis.values.map((value) => ({
          ...row,
          [axis.name]: value.name,
        }))
      ),
    [{}]
  );
}

export function previewFrameUrl(selection: PreviewSelection): string {
  const params = new URLSearchParams();
  params.set('componentPath', selection.componentPath);
  params.set('exportName', selection.exportName);
  params.set('viewport', selection.viewport);
  params.set('theme', selection.theme);
  params.set('density', selection.density);
  params.set('state', selection.state);
  for (const [axis, value] of Object.entries(selection.variants)) {
    params.set(`variant.${axis}`, value);
  }
  return `/studio/preview/frame?${params.toString()}`;
}

export function describeVariants(variants: Record<string, string>): string {
  const entries = Object.entries(variants);
  return entries.length === 0 ? 'Default' : entries.map(([axis, value]) => `${axis}: ${value}`).join(', ');
}
