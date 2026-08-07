import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useCallback, useEffect, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import * as api from '../api/client.js';
import type { Preview, Template } from '../types/index.js';
import { type DiffFileChange, DiffPreview } from './DiffPreview.js';

/**
 * Preset selector.
 *
 * Browses saved presets (templates) from the shared template/preset service,
 * lets the user pick the target components, renders the pending change through
 * the shared {@link DiffPreview} pane and only writes to disk after an explicit
 * confirmation.
 */
export interface PresetSelectorProps {
  /** Preset pre-selected by the caller, if any. */
  initialPresetId?: string;
  /** Components already selected elsewhere in the TUI. */
  selectedPaths?: string[];
  /** Leave the selector. */
  onBack: () => void;
  /** Called with a status message after a preset has been applied. */
  onApplied?: (message: string) => void;
}

type Stage = 'list' | 'components' | 'diff';

const VISIBLE_COMPONENTS = 8;

function Loading({ message }: { message: string }) {
  return (
    <Box borderStyle="round" borderColor={THEME.secondary} paddingX={2} paddingY={1}>
      <Text color={THEME.success}>
        <Spinner type="dots" />
      </Text>
      <Text> {message}</Text>
    </Box>
  );
}

function mergePreviews(target: Preview[], incoming: Preview[]): void {
  for (const preview of incoming) {
    const existing = target.find((entry) => entry.path === preview.path);
    if (existing) {
      existing.after = preview.after;
      existing.changes += preview.changes;
      existing.lineNumbers = [...existing.lineNumbers, ...preview.lineNumbers];
    } else {
      target.push({ ...preview });
    }
  }
}

export function PresetSelector({
  initialPresetId,
  selectedPaths = [],
  onBack,
  onApplied,
}: PresetSelectorProps) {
  const [presets, setPresets] = useState<Template[]>([]);
  const [components, setComponents] = useState<Array<{ name: string; path: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage>('list');
  const [cursor, setCursor] = useState(0);
  const [componentCursor, setComponentCursor] = useState(0);
  const [targets, setTargets] = useState<Set<string>>(new Set(selectedPaths));
  const [activePreset, setActivePreset] = useState<Template | null>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [presetResult, componentResult] = await Promise.all([
      api.getTemplates(),
      api.getComponents(),
    ]);

    if (presetResult.success && presetResult.data) {
      setPresets(presetResult.data.templates);
    } else {
      setError(presetResult.error?.message || 'Failed to load presets');
    }

    if (componentResult.success && componentResult.data) {
      setComponents(
        componentResult.data.components.map((entry: unknown) => {
          const component = entry as { name: string; path: string };
          return { name: component.name, path: component.path };
        })
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!initialPresetId || presets.length === 0) return;
    const idx = presets.findIndex((preset) => preset.id === initialPresetId);
    if (idx >= 0) setCursor(idx);
  }, [initialPresetId, presets]);

  const buildPreview = useCallback(async (preset: Template, paths: string[]) => {
    setBusy('Building preview...');
    setError(null);

    const merged: Preview[] = [];
    for (const rule of preset.rules) {
      const result = await api.previewEdit(paths, rule.find, rule.replace, rule.isRegex);
      if (result.success && result.data) {
        mergePreviews(merged, result.data.previews);
      } else if (!result.success) {
        setError(result.error?.message || 'Failed to build preview');
      }
    }

    setPreviews(merged);
    setActivePreset(preset);
    setStage('diff');
    setBusy(null);
  }, []);

  const applyPreset = useCallback(async () => {
    if (!activePreset) return;
    setBusy(`Applying "${activePreset.name}"...`);
    const result = await api.applyTemplate(activePreset.id, Array.from(targets));
    setBusy(null);

    if (result.success && result.data) {
      const message = `Applied preset "${activePreset.name}" to ${result.data.modified.length} files`;
      if (onApplied) {
        onApplied(message);
      } else {
        setStage('list');
        setPreviews([]);
      }
      return;
    }

    setError(result.error?.message || 'Failed to apply preset');
    setStage('list');
  }, [activePreset, targets, onApplied]);

  const startPreset = useCallback(
    (preset: Template) => {
      setActivePreset(preset);
      setError(null);
      if (targets.size > 0) {
        buildPreview(preset, Array.from(targets));
        return;
      }
      setComponentCursor(0);
      setStage('components');
    },
    [buildPreview, targets]
  );

  useInput(
    (input, key) => {
      if (stage === 'components') {
        if (key.escape || input === 'q') {
          setStage('list');
          setActivePreset(null);
          return;
        }
        if (key.upArrow) {
          setComponentCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (key.downArrow) {
          setComponentCursor((c) => Math.min(components.length - 1, c + 1));
          return;
        }
        if (input === ' ') {
          const component = components[componentCursor];
          if (!component) return;
          setTargets((prev) => {
            const next = new Set(prev);
            if (next.has(component.path)) next.delete(component.path);
            else next.add(component.path);
            return next;
          });
          return;
        }
        if (input === 'a') {
          setTargets(new Set(components.map((component) => component.path)));
          return;
        }
        if (input === 'n') {
          setTargets(new Set());
          return;
        }
        if (key.return || input === 'c') {
          if (targets.size === 0) {
            setError('Select at least one component');
            return;
          }
          if (activePreset) buildPreview(activePreset, Array.from(targets));
        }
        return;
      }

      // List stage
      if (key.escape || input === 'q') {
        onBack();
        return;
      }
      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(presets.length - 1, c + 1));
        return;
      }
      if (input === 'r') {
        load();
        return;
      }
      if (key.return) {
        const preset = presets[cursor];
        if (preset) startPreset(preset);
        return;
      }
      const num = Number.parseInt(input, 10);
      if (num >= 1 && num <= Math.min(9, presets.length)) {
        startPreset(presets[num - 1]);
      }
    },
    { isActive: stage !== 'diff' && !busy && !loading }
  );

  if (loading) return <Loading message="Loading presets..." />;
  if (busy) return <Loading message={busy} />;

  const errorBanner = error ? (
    <Box marginBottom={1} borderStyle="round" borderColor={THEME.error} paddingX={2}>
      <Text color={THEME.error}>
        {SYMBOLS.cross} {error}
      </Text>
    </Box>
  ) : null;

  if (stage === 'diff' && activePreset) {
    const files: DiffFileChange[] = previews.map((preview) => ({
      path: preview.path,
      before: preview.before,
      after: preview.after,
      changes: preview.changes,
    }));

    return (
      <Box flexDirection="column">
        {errorBanner}
        <DiffPreview
          title={`Preset: ${activePreset.name}`}
          files={files}
          emptyMessage={`"${activePreset.name}" produces no changes for the selected components.`}
          submitLabel="apply preset"
          onSubmit={files.length > 0 ? applyPreset : undefined}
          onCancel={() => {
            setStage('list');
            setPreviews([]);
            setActivePreset(null);
          }}
        />
      </Box>
    );
  }

  if (stage === 'components') {
    const startIdx = Math.max(
      0,
      Math.min(componentCursor - 3, components.length - VISIBLE_COMPONENTS)
    );
    const visible = components.slice(startIdx, startIdx + VISIBLE_COMPONENTS);

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color={THEME.highlight}>
            {SYMBOLS.diamond} {activePreset?.name ?? 'Preset'}
          </Text>
          <Text color={THEME.muted}> ─ Select target components</Text>
        </Box>

        {errorBanner}

        <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
          {startIdx > 0 && (
            <Box justifyContent="center">
              <Text color={THEME.muted}>↑ {startIdx} more</Text>
            </Box>
          )}
          {visible.map((component, idx) => {
            const actualIdx = startIdx + idx;
            const isSelected = targets.has(component.path);
            const isCursor = actualIdx === componentCursor;
            return (
              <Box key={component.path}>
                <Box width={3}>
                  <Text color={isCursor ? THEME.primary : THEME.muted}>
                    {isCursor ? SYMBOLS.arrow : ' '}
                  </Text>
                </Box>
                <Box width={4}>
                  <Text color={isSelected ? THEME.success : THEME.muted}>
                    {isSelected ? SYMBOLS.check : SYMBOLS.circle}
                  </Text>
                </Box>
                <Text color={isCursor ? THEME.secondary : THEME.highlight} bold={isCursor}>
                  {component.name}
                </Text>
              </Box>
            );
          })}
          {startIdx + VISIBLE_COMPONENTS < components.length && (
            <Box justifyContent="center">
              <Text color={THEME.muted}>
                ↓ {components.length - startIdx - VISIBLE_COMPONENTS} more
              </Text>
            </Box>
          )}
        </Box>

        <Box marginTop={1} justifyContent="center">
          <Text color={THEME.muted}>
            <Text color={THEME.secondary}>Space</Text> Toggle │{' '}
            <Text color={THEME.secondary}>a</Text> All │ <Text color={THEME.secondary}>n</Text> None
            │ <Text color={THEME.secondary}>↵</Text> Preview diff │{' '}
            <Text color={THEME.secondary}>Esc</Text> Back
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={THEME.highlight}>
          {SYMBOLS.diamond} Preset Selector
        </Text>
        {targets.size > 0 && (
          <Text color={THEME.success}> ({targets.size} components selected)</Text>
        )}
      </Box>

      {errorBanner}

      <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
        {presets.length === 0 ? (
          <Text color={THEME.muted}>
            No saved presets yet. Create one from the Template Manager.
          </Text>
        ) : (
          presets.map((preset, idx) => {
            const isCurrent = idx === cursor;
            return (
              <Box key={preset.id}>
                <Box width={3}>
                  <Text color={isCurrent ? THEME.primary : THEME.muted}>
                    {isCurrent ? SYMBOLS.arrow : ' '}
                  </Text>
                </Box>
                <Box width={3}>
                  <Text color={THEME.muted}>{idx + 1}.</Text>
                </Box>
                <Box width={24}>
                  <Text color={isCurrent ? THEME.secondary : THEME.highlight} bold={isCurrent}>
                    {preset.name}
                  </Text>
                </Box>
                <Text color={THEME.muted}>{preset.rules.length} rules</Text>
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1} justifyContent="center">
        <Text color={THEME.muted}>
          <Text color={THEME.secondary}>↵</Text> Preview preset │{' '}
          <Text color={THEME.secondary}>1-9</Text> Quick pick │{' '}
          <Text color={THEME.secondary}>r</Text> Reload │ <Text color={THEME.secondary}>Esc</Text>{' '}
          Back
        </Text>
      </Box>
    </Box>
  );
}
