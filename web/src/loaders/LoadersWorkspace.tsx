import {
  type BrailleLoaderGenerated,
  type BrailleLoaderPreset,
  type BrailleLoaderReducedMotionMode,
  generateBrailleLoader,
  getBrailleLoaderPresets,
} from '@studio-shared';
import { useCallback, useEffect, useMemo, useState } from 'react';

const TONES: Array<{ id: string; label: string; color: string | undefined }> = [
  { id: 'inherit', label: 'Inherit', color: undefined },
  { id: 'primary', label: 'Primary', color: 'var(--primary, #7c3aed)' },
  { id: 'muted', label: 'Muted', color: '#6f7680' },
  { id: 'success', label: 'Success', color: '#1f8a4c' },
  { id: 'warning', label: 'Warning', color: '#b97700' },
  { id: 'danger', label: 'Danger', color: '#d64541' },
  { id: 'custom', label: 'Custom…', color: undefined },
];

interface LoaderDraft {
  intervalMs: number;
  label: string;
  sizeRem: number;
  toneId: string;
  customColor: string;
  reducedMotionMode: BrailleLoaderReducedMotionMode;
  componentName: string;
}

function draftForPreset(preset: BrailleLoaderPreset): LoaderDraft {
  return {
    intervalMs: preset.intervalMs,
    label: preset.defaultLabel,
    sizeRem: 1.5,
    toneId: 'inherit',
    customColor: '',
    reducedMotionMode: 'static-frame',
    componentName: '',
  };
}

function draftColor(draft: LoaderDraft): string | undefined {
  if (draft.toneId === 'custom') return draft.customColor.trim() || undefined;
  return TONES.find((tone) => tone.id === draft.toneId)?.color;
}

/** Animates through the preset frames, or renders the reduced-motion fallback. */
function LoaderGlyph({
  preset,
  intervalMs,
  reducedMotion,
  label,
  sizeRem,
  color,
  reducedMotionMode = 'static-frame',
}: {
  preset: BrailleLoaderPreset;
  intervalMs: number;
  reducedMotion: boolean;
  label: string;
  sizeRem?: number;
  color?: string;
  reducedMotionMode?: BrailleLoaderReducedMotionMode;
}) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (reducedMotion) return;
    const timer = setInterval(() => {
      setFrame((current) => (current + 1) % preset.frames.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [preset, intervalMs, reducedMotion]);

  const style = {
    color,
    fontSize: sizeRem ? `${sizeRem}rem` : undefined,
  };

  if (reducedMotion && reducedMotionMode === 'label-only') {
    return (
      <span className="loader-glyph" role="status" style={style}>
        {label}
      </span>
    );
  }

  return (
    <span aria-label={label} className="loader-glyph" role="status" style={style}>
      <span aria-hidden="true">
        {reducedMotion ? preset.reducedMotionFrame : preset.frames[frame]}
      </span>
    </span>
  );
}

export function LoadersWorkspace() {
  const [presets, setPresets] = useState<BrailleLoaderPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LoaderDraft | null>(null);
  const [generated, setGenerated] = useState<BrailleLoaderGenerated | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [reducedMotionPreview, setReducedMotionPreview] = useState(false);
  const [darkBackground, setDarkBackground] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getBrailleLoaderPresets().then((result) => {
      if (result.success && result.data) {
        setPresets(result.data.presets);
        setError(null);
      } else {
        setError(result.error?.message || 'Failed to load braille loader presets.');
      }
    });
  }, []);

  const selected = useMemo(
    () => presets.find((preset) => preset.id === selectedId) ?? null,
    [presets, selectedId]
  );

  const selectPreset = useCallback((preset: BrailleLoaderPreset) => {
    setSelectedId(preset.id);
    setDraft(draftForPreset(preset));
    setGenerated(null);
    setGenerateError(null);
    setCopied(false);
  }, []);

  useEffect(() => {
    if (!selected || !draft) return;
    const payload = {
      presetId: selected.id,
      intervalMs: draft.intervalMs,
      label: draft.label.trim() || undefined,
      sizeRem: draft.sizeRem,
      color: draftColor(draft),
      reducedMotionMode: draft.reducedMotionMode,
      componentName: draft.componentName.trim() || undefined,
    };
    const timer = setTimeout(async () => {
      const result = await generateBrailleLoader(payload);
      if (result.success && result.data) {
        setGenerated(result.data.generated);
        setGenerateError(null);
      } else {
        setGenerated(null);
        setGenerateError(result.error?.message || 'Failed to generate loader code.');
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [selected, draft]);

  const copyCode = useCallback(async () => {
    if (!generated) return;
    await navigator.clipboard.writeText(generated.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [generated]);

  const downloadCode = useCallback(() => {
    if (!generated) return;
    const blob = new Blob([generated.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = generated.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [generated]);

  if (error) {
    return (
      <section className="panel error">
        <p>{error}</p>
      </section>
    );
  }

  return (
    <section className="panel loaders-workspace">
      <section className="preview-section">
        <h2>Braille Loader Gallery</h2>
        <p className="preview-note">
          Curated braille spinner frame sets for terminal and web loading states. Pick one to
          customize speed, tone, label, and reduced-motion behavior, then copy the generated React
          component.
        </p>
        <div className="loader-gallery">
          {presets.map((preset) => (
            <button
              className={`loader-card ${preset.id === selectedId ? 'selected' : ''}`}
              key={preset.id}
              onClick={() => selectPreset(preset)}
              type="button"
            >
              <LoaderGlyph
                intervalMs={preset.intervalMs}
                label={preset.defaultLabel}
                preset={preset}
                reducedMotion={false}
                sizeRem={1.6}
              />
              <strong>{preset.name}</strong>
              <span>{preset.description}</span>
              <small>
                {preset.intervalMs}ms · {preset.frames.length} frames · {preset.tags.join(', ')}
              </small>
            </button>
          ))}
        </div>
      </section>

      {selected && draft ? (
        <section className="preview-section loader-playground">
          <h2>Customize “{selected.name}”</h2>
          <div className="preview-controls">
            <label>
              Speed ({draft.intervalMs}ms per frame)
              <input
                max={400}
                min={30}
                onChange={(event) => setDraft({ ...draft, intervalMs: Number(event.target.value) })}
                step={10}
                type="range"
                value={draft.intervalMs}
              />
            </label>
            <label>
              Size ({draft.sizeRem}rem)
              <input
                max={5}
                min={0.75}
                onChange={(event) => setDraft({ ...draft, sizeRem: Number(event.target.value) })}
                step={0.25}
                type="range"
                value={draft.sizeRem}
              />
            </label>
            <label>
              Tone
              <select
                onChange={(event) => setDraft({ ...draft, toneId: event.target.value })}
                value={draft.toneId}
              >
                {TONES.map((tone) => (
                  <option key={tone.id} value={tone.id}>
                    {tone.label}
                  </option>
                ))}
              </select>
            </label>
            {draft.toneId === 'custom' ? (
              <label>
                Custom color
                <input
                  onChange={(event) => setDraft({ ...draft, customColor: event.target.value })}
                  placeholder="#7c3aed or var(--primary)"
                  value={draft.customColor}
                />
              </label>
            ) : null}
            <label>
              Loading label
              <input
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                value={draft.label}
              />
            </label>
            <label>
              Component name
              <input
                onChange={(event) => setDraft({ ...draft, componentName: event.target.value })}
                placeholder={`${selected.name.replace(/[^A-Za-z0-9]/g, '')}Loader`}
                value={draft.componentName}
              />
            </label>
            <label>
              Reduced-motion fallback
              <select
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    reducedMotionMode: event.target.value as BrailleLoaderReducedMotionMode,
                  })
                }
                value={draft.reducedMotionMode}
              >
                <option value="static-frame">Static frame + hidden label</option>
                <option value="label-only">Label text only</option>
              </select>
            </label>
          </div>

          <div className="preview-toolbar">
            <label>
              <input
                checked={reducedMotionPreview}
                onChange={(event) => setReducedMotionPreview(event.target.checked)}
                type="checkbox"
              />{' '}
              Preview reduced motion
            </label>
            <label>
              <input
                checked={darkBackground}
                onChange={(event) => setDarkBackground(event.target.checked)}
                type="checkbox"
              />{' '}
              Dark background
            </label>
          </div>

          <div className={`loader-stage ${darkBackground ? 'dark' : 'light'}`}>
            <LoaderGlyph
              color={draftColor(draft)}
              intervalMs={draft.intervalMs}
              label={draft.label || selected.defaultLabel}
              preset={selected}
              reducedMotion={reducedMotionPreview}
              reducedMotionMode={draft.reducedMotionMode}
              sizeRem={draft.sizeRem}
            />
            <span className="loader-stage-label">{draft.label || selected.defaultLabel}</span>
          </div>

          <section className="preview-section">
            <h2>Generated React Component</h2>
            <p className="preview-note">
              Self-contained, dependency-free, announces{' '}
              {`"${draft.label || selected.defaultLabel}"`} via role="status", and honors
              prefers-reduced-motion.
            </p>
            {generateError ? <div className="preview-diagnostic">{generateError}</div> : null}
            {generated ? (
              <>
                <div className="actions">
                  <button onClick={copyCode} type="button">
                    {copied ? 'Copied!' : 'Copy code'}
                  </button>
                  <button onClick={downloadCode} type="button">
                    Download {generated.fileName}
                  </button>
                </div>
                <pre className="loader-code">
                  <code>{generated.code}</code>
                </pre>
              </>
            ) : (
              <p className="preset-status">Generating code…</p>
            )}
          </section>
        </section>
      ) : (
        <p className="preset-status">Select a loader preset above to open the playground.</p>
      )}

      <section className="preview-section">
        <h2>Accessibility Guidance</h2>
        <ul className="loader-guidance">
          <li>
            Loaders announce their label through <code>role="status"</code> and{' '}
            <code>aria-live="polite"</code>; the spinning glyph itself is <code>aria-hidden</code>{' '}
            so screen readers never hear raw braille characters.
          </li>
          <li>
            Keep labels short and specific (“Saving draft…” beats “Loading…”) and update or remove
            the loader as soon as the work finishes so the status region resolves.
          </li>
          <li>
            Reduced-motion users get either a static frame with a visually hidden label or plain
            label text — both variants respect <code>prefers-reduced-motion</code> automatically.
          </li>
          <li>
            The same frame sets work in terminal/TUI contexts: render <code>frames[i]</code> on an
            interval and print the reduced-motion frame when animation is unavailable or disabled.
          </li>
        </ul>
      </section>
    </section>
  );
}
