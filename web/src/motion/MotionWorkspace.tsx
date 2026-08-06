import {
  applyMotion,
  buildMotionOutput,
  createMotionPreset,
  deleteMotionPreset,
  getMotionPresets,
  getMotionSlots,
  type MotionEasing,
  type MotionOutput,
  type MotionPhase,
  type MotionPreset,
  type MotionReducedMotionBehavior,
  type MotionSettings,
  type MotionSlot,
  type MotionTransformOrigin,
  previewMotion,
  type StudioSummary,
} from '@studio-shared';
import { useCallback, useEffect, useRef, useState } from 'react';

const EASINGS: MotionEasing[] = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];
const ORIGINS: MotionTransformOrigin[] = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];
const REDUCED_MOTION_BEHAVIORS: Array<{ id: MotionReducedMotionBehavior; label: string }> = [
  { id: 'fade-only', label: 'Fade only (drop transforms)' },
  { id: 'disable', label: 'Disable all motion' },
  { id: 'full', label: 'Play full animation' },
];

const DEFAULT_SETTINGS: MotionSettings = {
  durationMs: 200,
  delayMs: 0,
  easing: 'ease-out',
  transformOrigin: 'center',
  enter: { opacity: 0, scale: 0.95, translateX: 0, translateY: 8 },
  exit: { opacity: 0, scale: 0.95, translateX: 0, translateY: 8 },
  reducedMotion: 'fade-only',
};

function phaseTransform(phase: MotionPhase): string {
  return `translate(${phase.translateX}px, ${phase.translateY}px) scale(${phase.scale})`;
}

/**
 * Plays enter/exit animations with the Web Animations API so the preview can
 * also emulate the selected reduced-motion behavior without a media query.
 */
function MotionPreviewPlayer({
  settings,
  reducedMotionPreview,
}: {
  settings: MotionSettings;
  reducedMotionPreview: boolean;
}) {
  const targetRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  const play = useCallback(
    (direction: 'enter' | 'exit') => {
      const target = targetRef.current;
      if (!target) return;
      setVisible(true);

      const reduced = reducedMotionPreview && settings.reducedMotion !== 'full';
      if (reduced && settings.reducedMotion === 'disable') {
        for (const animation of target.getAnimations()) animation.cancel();
        setVisible(direction === 'enter');
        return;
      }

      const phase = direction === 'enter' ? settings.enter : settings.exit;
      const offscreen: Keyframe = {
        opacity: phase.opacity,
        transform: reduced ? 'none' : phaseTransform(phase),
      };
      const onscreen: Keyframe = { opacity: 1, transform: 'none' };
      for (const animation of target.getAnimations()) animation.cancel();
      target.style.transformOrigin = settings.transformOrigin.replace('-', ' ');
      const animation = target.animate(
        direction === 'enter' ? [offscreen, onscreen] : [onscreen, offscreen],
        {
          duration: settings.durationMs,
          delay: settings.delayMs,
          easing: settings.easing,
          fill: 'both',
        }
      );
      animation.onfinish = () => {
        if (direction === 'exit') setVisible(false);
      };
    },
    [settings, reducedMotionPreview]
  );

  return (
    <div className="motion-player">
      <div className="actions">
        <button onClick={() => play('enter')} type="button">
          Play enter
        </button>
        <button onClick={() => play('exit')} type="button">
          Play exit
        </button>
      </div>
      <div className="motion-stage">
        <div
          className="motion-demo"
          ref={targetRef}
          style={{ visibility: visible ? 'visible' : 'hidden' }}
        >
          <strong>Motion preview</strong>
          <span>
            {settings.durationMs}ms · {settings.easing} · origin {settings.transformOrigin}
          </span>
        </div>
      </div>
    </div>
  );
}

function PhaseControls({
  title,
  phase,
  onChange,
}: {
  title: string;
  phase: MotionPhase;
  onChange: (phase: MotionPhase) => void;
}) {
  return (
    <fieldset className="motion-phase">
      <legend>{title}</legend>
      <label>
        Opacity ({phase.opacity})
        <input
          max={1}
          min={0}
          onChange={(event) => onChange({ ...phase, opacity: Number(event.target.value) })}
          step={0.05}
          type="range"
          value={phase.opacity}
        />
      </label>
      <label>
        Scale ({phase.scale})
        <input
          max={2}
          min={0.25}
          onChange={(event) => onChange({ ...phase, scale: Number(event.target.value) })}
          step={0.05}
          type="range"
          value={phase.scale}
        />
      </label>
      <label>
        Translate X ({phase.translateX}px)
        <input
          max={100}
          min={-100}
          onChange={(event) => onChange({ ...phase, translateX: Number(event.target.value) })}
          step={2}
          type="range"
          value={phase.translateX}
        />
      </label>
      <label>
        Translate Y ({phase.translateY}px)
        <input
          max={100}
          min={-100}
          onChange={(event) => onChange({ ...phase, translateY: Number(event.target.value) })}
          step={2}
          type="range"
          value={phase.translateY}
        />
      </label>
    </fieldset>
  );
}

export function MotionWorkspace({
  selectedComponents,
  summary,
}: {
  selectedComponents: StudioSummary['components']['inventory'];
  summary: StudioSummary;
}) {
  const components =
    selectedComponents.length > 0 ? selectedComponents : summary.components.inventory;
  const [settings, setSettings] = useState<MotionSettings>(DEFAULT_SETTINGS);
  const [reducedMotionPreview, setReducedMotionPreview] = useState(false);
  const [output, setOutput] = useState<MotionOutput | null>(null);
  const [presets, setPresets] = useState<MotionPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const [componentPath, setComponentPath] = useState(components[0]?.path ?? '');
  const [slots, setSlots] = useState<MotionSlot[]>([]);
  const [slotLine, setSlotLine] = useState<number | null>(null);
  const [previewChanges, setPreviewChanges] = useState<number | null>(null);

  const refreshPresets = useCallback(async () => {
    const result = await getMotionPresets();
    if (result.success && result.data) setPresets(result.data.presets);
  }, []);

  useEffect(() => {
    refreshPresets();
  }, [refreshPresets]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await buildMotionOutput(settings);
      if (cancelled) return;
      if (result.success && result.data) setOutput(result.data.output);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [settings]);

  useEffect(() => {
    if (!componentPath) {
      setSlots([]);
      setSlotLine(null);
      return;
    }
    getMotionSlots(componentPath).then((result) => {
      if (result.success && result.data) {
        setSlots(result.data.slots);
        setSlotLine(result.data.slots.find((slot) => slot.patchable)?.line ?? null);
      } else {
        setSlots([]);
        setSlotLine(null);
      }
      setPreviewChanges(null);
    });
  }, [componentPath]);

  async function savePreset() {
    const result = await createMotionPreset({ name: presetName, settings });
    if (result.success && result.data) {
      setMessage(`Saved preset “${result.data.preset.name}”.`);
      setPresetName('');
      await refreshPresets();
    } else {
      setMessage(result.error?.message || 'Failed to save preset.');
    }
  }

  async function removePreset(id: string) {
    await deleteMotionPreset(id);
    await refreshPresets();
  }

  async function previewSlotPatch() {
    if (!componentPath || slotLine === null) return;
    const result = await previewMotion({ componentPath, line: slotLine, settings });
    if (result.success && result.data) {
      setPreviewChanges(result.data.totalChanges);
      setMessage(
        result.data.totalChanges > 0
          ? `Preview: ${result.data.totalChanges} change(s) on line ${slotLine}.`
          : 'Preview: motion classes are already applied to this slot.'
      );
    } else {
      setPreviewChanges(null);
      setMessage(result.error?.message || 'Failed to preview motion patch.');
    }
  }

  async function applySlotPatch() {
    if (!componentPath || slotLine === null) return;
    const result = await applyMotion({ componentPath, line: slotLine, settings });
    if (result.success && result.data) {
      setMessage(
        result.data.result.changes > 0
          ? `Applied motion to ${componentPath} (line ${slotLine}).${
              result.data.result.backupId ? ` Backup ${result.data.result.backupId} created.` : ''
            }`
          : 'No changes needed; slot already has these classes.'
      );
      setPreviewChanges(null);
    } else {
      setMessage(result.error?.message || 'Failed to apply motion patch.');
    }
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    setMessage('Copied to clipboard.');
  }

  return (
    <section className="panel motion-workspace">
      <section className="preview-section">
        <h2>Timing &amp; Easing</h2>
        <div className="preview-controls">
          <label>
            Duration ({settings.durationMs}ms)
            <input
              max={2000}
              min={0}
              onChange={(event) =>
                setSettings({ ...settings, durationMs: Number(event.target.value) })
              }
              step={10}
              type="range"
              value={settings.durationMs}
            />
          </label>
          <label>
            Delay ({settings.delayMs}ms)
            <input
              max={2000}
              min={0}
              onChange={(event) =>
                setSettings({ ...settings, delayMs: Number(event.target.value) })
              }
              step={10}
              type="range"
              value={settings.delayMs}
            />
          </label>
          <label>
            Easing
            <select
              onChange={(event) =>
                setSettings({ ...settings, easing: event.target.value as MotionEasing })
              }
              value={settings.easing}
            >
              {EASINGS.map((easing) => (
                <option key={easing} value={easing}>
                  {easing}
                </option>
              ))}
            </select>
          </label>
          <label>
            Transform origin
            <select
              onChange={(event) =>
                setSettings({
                  ...settings,
                  transformOrigin: event.target.value as MotionTransformOrigin,
                })
              }
              value={settings.transformOrigin}
            >
              {ORIGINS.map((origin) => (
                <option key={origin} value={origin}>
                  {origin}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reduced motion behavior
            <select
              onChange={(event) =>
                setSettings({
                  ...settings,
                  reducedMotion: event.target.value as MotionReducedMotionBehavior,
                })
              }
              value={settings.reducedMotion}
            >
              {REDUCED_MOTION_BEHAVIORS.map((behavior) => (
                <option key={behavior.id} value={behavior.id}>
                  {behavior.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="motion-phases">
          <PhaseControls
            onChange={(enter) => setSettings({ ...settings, enter })}
            phase={settings.enter}
            title="Enter animation (from)"
          />
          <PhaseControls
            onChange={(exit) => setSettings({ ...settings, exit })}
            phase={settings.exit}
            title="Exit animation (to)"
          />
        </div>
      </section>

      <section className="preview-section">
        <h2>Preview Player</h2>
        <label>
          <input
            checked={reducedMotionPreview}
            onChange={(event) => setReducedMotionPreview(event.target.checked)}
            type="checkbox"
          />{' '}
          Emulate prefers-reduced-motion
        </label>
        <MotionPreviewPlayer reducedMotionPreview={reducedMotionPreview} settings={settings} />
      </section>

      <section className="preview-section">
        <h2>Motion Presets</h2>
        <div className="preview-toolbar">
          <label>
            Preset name
            <input
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="Dialog pop"
              value={presetName}
            />
          </label>
          <button disabled={!presetName.trim()} onClick={savePreset} type="button">
            Save current settings
          </button>
        </div>
        {presets.length === 0 ? (
          <p className="preset-empty">No motion presets saved yet.</p>
        ) : (
          <ul className="preset-list">
            {presets.map((preset) => (
              <li className="preset-item" key={preset.id}>
                <div className="preset-meta">
                  <strong>{preset.name}</strong>
                  <small>
                    {preset.settings.durationMs}ms · {preset.settings.easing} · reduced motion:{' '}
                    {preset.settings.reducedMotion}
                  </small>
                </div>
                <div className="actions">
                  <button onClick={() => setSettings(preset.settings)} type="button">
                    Load
                  </button>
                  <button onClick={() => removePreset(preset.id)} type="button">
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="preview-section">
        <h2>Apply To Component Slot</h2>
        {components.length === 0 ? (
          <p>No components found in {summary.workspace.manifest.config.componentDirectory}.</p>
        ) : (
          <>
            <div className="preview-toolbar">
              <label>
                Component
                <select
                  onChange={(event) => setComponentPath(event.target.value)}
                  value={componentPath}
                >
                  {components.map((component) => (
                    <option key={component.path} value={component.path}>
                      {component.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Slot
                <select
                  onChange={(event) => setSlotLine(Number(event.target.value))}
                  value={slotLine ?? ''}
                >
                  {slots.map((slot) => (
                    <option disabled={!slot.patchable} key={slot.line} value={slot.line}>
                      line {slot.line}: &lt;{slot.tagName}&gt; {slot.classes.slice(0, 4).join(' ')}
                      {slot.classes.length > 4 ? '…' : ''}
                      {slot.patchable ? '' : ' (dynamic className)'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="actions">
              <button disabled={slotLine === null} onClick={previewSlotPatch} type="button">
                Preview patch
              </button>
              <button
                disabled={slotLine === null || previewChanges === 0}
                onClick={applySlotPatch}
                type="button"
              >
                Apply motion to slot
              </button>
            </div>
          </>
        )}
      </section>

      <section className="preview-section">
        <h2>Generated Output</h2>
        {output ? (
          <div className="motion-outputs">
            <div>
              <div className="preview-frame-header">
                <span>Tailwind classes</span>
                <button onClick={() => copyText(output.tailwindClasses)} type="button">
                  Copy
                </button>
              </div>
              <pre className="loader-code">
                <code>{output.tailwindClasses}</code>
              </pre>
            </div>
            <div>
              <div className="preview-frame-header">
                <span>CSS variables &amp; keyframes</span>
                <button onClick={() => copyText(output.css)} type="button">
                  Copy
                </button>
              </div>
              <pre className="loader-code">
                <code>{output.css}</code>
              </pre>
            </div>
          </div>
        ) : (
          <p className="preset-status">Generating output…</p>
        )}
      </section>

      {message ? <p className="preview-note">{message}</p> : null}
    </section>
  );
}
