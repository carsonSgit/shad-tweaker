import {
  generateLocalRegistry,
  getRegistryPublishInstructions,
  type RegistryGenerateResult,
  type RegistryValidationResult,
  validateLocalRegistry,
} from '@studio-shared';
import { useCallback, useEffect, useState } from 'react';

/**
 * Generates a shadcn-compatible registry from the local component library,
 * shows validation status, and surfaces publish instructions.
 */
export function RegistryPublishPanel() {
  const [name, setName] = useState('local-registry');
  const [homepage, setHomepage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<RegistryGenerateResult | null>(null);
  const [validation, setValidation] = useState<RegistryValidationResult | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshValidation = useCallback(async () => {
    const res = await validateLocalRegistry();
    if (res.success && res.data) setValidation(res.data.validation);
  }, []);

  useEffect(() => {
    refreshValidation();
  }, [refreshValidation]);

  async function generate() {
    setGenerating(true);
    setError(null);
    const res = await generateLocalRegistry({ name, homepage: homepage || undefined });
    if (res.success && res.data) {
      setResult(res.data);
    } else {
      setResult(null);
      setError(res.error?.message || 'Failed to generate registry.');
    }
    await refreshValidation();
    setGenerating(false);
  }

  async function toggleInstructions() {
    if (!instructions) {
      const res = await getRegistryPublishInstructions();
      if (res.success && res.data) setInstructions(res.data.instructions);
    }
    setShowInstructions((current) => !current);
  }

  return (
    <section className="preview-section">
      <h2>Publish Local Registry</h2>
      <p className="preview-note">
        Generate a shadcn-compatible registry (registry.json plus r/&lt;name&gt;.json item files)
        from your local component library. The studio serves it at <code>/r</code> so you can test
        installs with <code>npx shadcn@latest add &lt;studio-url&gt;/r/&lt;name&gt;.json</code>.
      </p>
      <div className="preview-toolbar">
        <label>
          Registry name
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label>
          Homepage (optional)
          <input
            onChange={(event) => setHomepage(event.target.value)}
            placeholder="https://your-domain.com"
            value={homepage}
          />
        </label>
        <button className="btn-primary" disabled={generating} onClick={generate} type="button">
          {generating ? 'Generating…' : 'Generate registry'}
        </button>
        <button onClick={toggleInstructions} type="button">
          {showInstructions ? 'Hide publish instructions' : 'Publish instructions'}
        </button>
      </div>

      {error ? <div className="preview-diagnostic">{error}</div> : null}

      {result ? (
        <div className="card">
          <strong>
            Generated {result.itemCount} item{result.itemCount === 1 ? '' : 's'} into{' '}
            {result.outputDir}
          </strong>
          {result.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      ) : null}

      {validation ? (
        <div className={validation.valid ? 'card' : 'preview-diagnostics'}>
          <strong>
            {validation.valid
              ? `Registry is valid (${validation.itemCount} items).`
              : 'Registry validation failed.'}
          </strong>
          {validation.errors.map((message) => (
            <span key={message}>error: {message}</span>
          ))}
          {validation.warnings.map((message) => (
            <span key={message}>warning: {message}</span>
          ))}
        </div>
      ) : null}

      {showInstructions && instructions ? (
        <pre className="loader-code">
          <code>{instructions}</code>
        </pre>
      ) : null}
    </section>
  );
}
