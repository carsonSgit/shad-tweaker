import type { ComponentPreviewManifest, PreviewDensity, PreviewState, PreviewTheme, PreviewViewport } from '@studio-shared';
import type { PreviewSelection } from './previewState';

interface PreviewControlsProps {
  manifest: ComponentPreviewManifest;
  selection: PreviewSelection;
  onChange: (selection: PreviewSelection) => void;
}

export function PreviewControls({ manifest, selection, onChange }: PreviewControlsProps) {
  const definition = manifest.variants[0];

  return (
    <div className="preview-controls" aria-label="Preview controls">
      <label>
        Export
        <select
          onChange={(event) => onChange({ ...selection, exportName: event.target.value })}
          value={selection.exportName}
        >
          {manifest.component.exports.map((exportName) => (
            <option key={exportName} value={exportName}>
              {exportName}
            </option>
          ))}
        </select>
      </label>

      <label>
        Viewport
        <select
          onChange={(event) =>
            onChange({ ...selection, viewport: event.target.value as PreviewViewport })
          }
          value={selection.viewport}
        >
          {Object.entries(manifest.viewports).map(([name, viewport]) => (
            <option key={name} value={name}>
              {name} ({viewport.width} x {viewport.height})
            </option>
          ))}
        </select>
      </label>

      <label>
        Theme
        <select
          onChange={(event) => onChange({ ...selection, theme: event.target.value as PreviewTheme })}
          value={selection.theme}
        >
          {manifest.themes.map((theme) => (
            <option key={theme} value={theme}>
              {theme}
            </option>
          ))}
        </select>
      </label>

      <label>
        Density
        <select
          onChange={(event) =>
            onChange({ ...selection, density: event.target.value as PreviewDensity })
          }
          value={selection.density}
        >
          {manifest.densities.map((density) => (
            <option key={density} value={density}>
              {density}
            </option>
          ))}
        </select>
      </label>

      <label>
        State
        <select
          onChange={(event) => onChange({ ...selection, state: event.target.value as PreviewState })}
          value={selection.state}
        >
          {manifest.states.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </label>

      {definition?.axes.map((axis) => (
        <label key={axis.name}>
          {axis.name}
          <select
            onChange={(event) =>
              onChange({
                ...selection,
                variants: {
                  ...selection.variants,
                  [axis.name]: event.target.value,
                },
              })
            }
            value={selection.variants[axis.name] ?? axis.defaultValue ?? axis.values[0]?.name ?? ''}
          >
            {axis.values.map((value) => (
              <option key={value.name} value={value.name}>
                {value.name}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
