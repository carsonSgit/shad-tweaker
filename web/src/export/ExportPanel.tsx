import {
  type ComponentExportResult,
  type ComponentExportTarget,
  exportComponentPackage,
  type StudioSummary,
} from '@studio-shared';
import { useState } from 'react';

const TARGETS: Array<{ id: ComponentExportTarget; label: string; description: string }> = [
  {
    id: 'folder',
    label: 'Local folder',
    description: 'Components, tokens, dependency manifest, README, and Tailwind notes.',
  },
  {
    id: 'npm-package',
    label: 'npm package',
    description: 'Publish-ready scaffold with package.json, src/ entry point, and docs.',
  },
  {
    id: 'registry',
    label: 'shadcn registry',
    description: 'registry.json plus r/<name>.json item files for the shadcn CLI.',
  },
];

/** Exports the selected components into a reusable package structure. */
export function ExportPanel({
  selectedComponents,
}: {
  selectedComponents: StudioSummary['components']['inventory'];
}) {
  const [target, setTarget] = useState<ComponentExportTarget>('folder');
  const [outputDir, setOutputDir] = useState('');
  const [packageName, setPackageName] = useState('');
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ComponentExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetMeta = TARGETS.find((entry) => entry.id === target);

  async function runExport() {
    setExporting(true);
    setError(null);
    setResult(null);
    const response = await exportComponentPackage({
      componentPaths: selectedComponents.map((component) => component.path),
      target,
      outputDir: outputDir.trim() || undefined,
      packageName: packageName.trim() || undefined,
    });
    if (response.success && response.data) {
      setResult(response.data.result);
    } else {
      setError(response.error?.message || 'Failed to export components.');
    }
    setExporting(false);
  }

  return (
    <section className="preview-section">
      <h2>Export Selected Components</h2>
      {selectedComponents.length === 0 ? (
        <p className="preview-note">Select components above to export them as a package.</p>
      ) : (
        <>
          <div className="preview-toolbar">
            <label>
              Target
              <select
                onChange={(event) => setTarget(event.target.value as ComponentExportTarget)}
                value={target}
              >
                {TARGETS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Output directory
              <input
                onChange={(event) => setOutputDir(event.target.value)}
                placeholder={`exports/${target}`}
                value={outputDir}
              />
            </label>
            {target === 'npm-package' ? (
              <label>
                Package name
                <input
                  onChange={(event) => setPackageName(event.target.value)}
                  placeholder="@acme/ui"
                  value={packageName}
                />
              </label>
            ) : null}
            <button className="btn-primary" disabled={exporting} onClick={runExport} type="button">
              {exporting
                ? 'Exporting…'
                : `Export ${selectedComponents.length} component${
                    selectedComponents.length === 1 ? '' : 's'
                  }`}
            </button>
          </div>
          <p className="preview-note">{targetMeta?.description}</p>
        </>
      )}

      {error ? <div className="preview-diagnostic">{error}</div> : null}

      {result ? (
        <div className={result.validation.valid ? 'card' : 'preview-diagnostics'}>
          <strong>
            {result.validation.valid
              ? `Exported ${result.files.length} files to ${result.outputDir}`
              : 'Export finished with validation errors.'}
          </strong>
          {result.dependencies.length > 0 ? (
            <span>npm dependencies: {result.dependencies.join(', ')}</span>
          ) : (
            <span>No external npm dependencies detected.</span>
          )}
          {result.validation.errors.map((message) => (
            <span key={message}>error: {message}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
