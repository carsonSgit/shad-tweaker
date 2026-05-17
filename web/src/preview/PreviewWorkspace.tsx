import {
  type ComponentPreviewManifest,
  getComponentPreviewManifest,
  type StudioSummary,
} from '@studio-shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PreviewControls } from './PreviewControls';
import { PreviewFrame } from './PreviewFrame';
import {
  createInitialSelection,
  describeVariants,
  type PreviewSelection,
  selectionFromManifest,
  variantGridSelections,
} from './previewState';

interface PreviewWorkspaceProps {
  selectedComponents: StudioSummary['components']['inventory'];
  summary: StudioSummary;
}

export function PreviewWorkspace({ selectedComponents, summary }: PreviewWorkspaceProps) {
  const components =
    selectedComponents.length > 0 ? selectedComponents : summary.components.inventory;
  const [componentPath, setComponentPath] = useState(components[0]?.path ?? '');
  const [manifest, setManifest] = useState<ComponentPreviewManifest | null>(null);
  const [selection, setSelection] = useState<PreviewSelection | null>(
    componentPath ? createInitialSelection(componentPath) : null
  );
  const [loading, setLoading] = useState(Boolean(componentPath));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!componentPath && components[0]) {
      setComponentPath(components[0].path);
    }
  }, [componentPath, components]);

  const loadManifest = useCallback(async (path: string) => {
    if (!path) return;
    setLoading(true);
    setError(null);
    const initial = createInitialSelection(path);
    const result = await getComponentPreviewManifest(initial);
    if (result.success && result.data) {
      setManifest(result.data.manifest);
      setSelection(selectionFromManifest(result.data.manifest, initial));
    } else {
      setManifest(null);
      setSelection(initial);
      setError(result.error?.message || 'Failed to load preview manifest.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadManifest(componentPath);
  }, [componentPath, loadManifest]);

  const variantDefinition = manifest?.variants[0];
  const variantSelections = useMemo(
    () => variantGridSelections(variantDefinition?.axes ?? []),
    [variantDefinition]
  );

  if (components.length === 0) {
    return (
      <section className="panel">
        <p>No components found in {summary.workspace.manifest.config.componentDirectory}.</p>
      </section>
    );
  }

  return (
    <section className="panel preview-workspace">
      <div className="preview-toolbar">
        <label>
          Component
          <select onChange={(event) => setComponentPath(event.target.value)} value={componentPath}>
            {components.map((component) => (
              <option key={component.path} value={component.path}>
                {component.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <p>Loading preview...</p> : null}
      {error ? <div className="preview-diagnostic">{error}</div> : null}

      {manifest && selection ? (
        <>
          <PreviewControls manifest={manifest} onChange={setSelection} selection={selection} />
          {manifest.diagnostics.length > 0 ? (
            <div className="preview-diagnostics">
              {manifest.diagnostics.map((diagnostic) => (
                <span key={`${diagnostic.code}:${diagnostic.message}`}>
                  {diagnostic.severity}: {diagnostic.message}
                </span>
              ))}
            </div>
          ) : null}
          <PreviewFrame
            label={`${manifest.component.name} preview`}
            manifest={manifest}
            selection={selection}
          />

          <section className="preview-section">
            <h2>Variant Grid</h2>
            <div className="preview-grid">
              {variantSelections.map((variants) => (
                <PreviewFrame
                  key={JSON.stringify(variants)}
                  label={describeVariants(variants)}
                  manifest={manifest}
                  selection={{ ...selection, variants }}
                />
              ))}
            </div>
          </section>

          <section className="preview-section">
            <h2>States</h2>
            <div className="preview-grid compact-grid">
              {manifest.states.map((state) => (
                <PreviewFrame
                  key={state}
                  label={state}
                  manifest={manifest}
                  selection={{ ...selection, state }}
                />
              ))}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
