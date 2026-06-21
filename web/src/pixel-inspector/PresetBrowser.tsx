import type { Preset } from '@studio-shared';
import { useState } from 'react';

interface PresetBrowserProps {
  presets: Preset[];
  onApply: (preset: Preset) => void;
  onDelete: (id: string) => void;
}

function presetJson(preset: Preset): string {
  return JSON.stringify(preset, null, 2);
}

export function PresetBrowser({ presets, onApply, onDelete }: PresetBrowserProps) {
  const [status, setStatus] = useState<string | null>(null);

  function exportPreset(preset: Preset) {
    const blob = new Blob([presetJson(preset)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${preset.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${preset.name}.`);
  }

  async function copyPreset(preset: Preset) {
    try {
      await navigator.clipboard.writeText(presetJson(preset));
      setStatus(`Copied ${preset.name} to clipboard.`);
    } catch {
      setStatus('Clipboard is unavailable in this browser.');
    }
  }

  return (
    <div className="pixel-inspector-panel preset-browser">
      <h2>Saved presets</h2>
      {presets.length === 0 ? (
        <p className="preset-empty">
          No presets yet. Save a draft as a reusable preset to see it here.
        </p>
      ) : (
        <ul className="preset-list">
          {presets.map((preset) => (
            <li className="preset-item" key={preset.id}>
              <div className="preset-meta">
                <strong>{preset.name}</strong>
                {preset.description ? <span>{preset.description}</span> : null}
                <small>
                  {preset.classTransforms.length} class change
                  {preset.classTransforms.length === 1 ? '' : 's'}
                  {preset.created ? ` · ${new Date(preset.created).toLocaleDateString()}` : ''}
                </small>
              </div>
              <div className="actions">
                <button onClick={() => onApply(preset)} type="button">
                  Apply
                </button>
                <button onClick={() => exportPreset(preset)} type="button">
                  Export
                </button>
                <button onClick={() => copyPreset(preset)} type="button">
                  Copy
                </button>
                <button onClick={() => onDelete(preset.id)} type="button">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {status ? <p className="preset-status">{status}</p> : null}
    </div>
  );
}
