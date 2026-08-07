import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import {
  applyVariantGeneration,
  getBackendUrl,
  getVariantComponent,
  getVariantComponents,
} from '../api/client.js';
import type {
  StudioSummary,
  VariantAxis,
  VariantComponentDetail,
  VariantComponentSummary,
  VariantDefinitionDetail,
  VariantGenerationPreview,
  VariantPreviewOperation,
  VariantValue,
} from '../types/index.js';
import { type DiffFileChange, DiffPreview } from './DiffPreview.js';

/**
 * Variant quick editor workbench area.
 *
 * Pick a component with variants, choose one of its cva/tailwind-variants
 * definitions, and stage a quick edit: set a default variant value, add a new
 * variant value, or add a whole new axis. Every staged edit is previewed
 * through the shared DiffPreview pane (current vs proposed component source),
 * reusing the existing variant services:
 *   - GET  /api/variants/components            (list)
 *   - GET  /api/variants/components/:id        (detail, via getVariantComponent)
 *   - POST /api/variants/preview               (staged diff, called below)
 *   - POST /api/variants/apply                 (apply, via applyVariantGeneration)
 */

const VISIBLE_ROWS = 8;

type Focus = 'components' | 'definitions' | 'axes';

type EditState =
  | { kind: 'none' }
  | { kind: 'set-default-value'; axisName: string; candidates: string[]; cursor: number }
  | { kind: 'add-value-name' }
  | { kind: 'add-value-classes'; valueName: string }
  | { kind: 'add-axis-name' }
  | { kind: 'add-axis-value-name'; axisName: string }
  | { kind: 'add-axis-value-classes'; axisName: string; valueName: string };

function windowStart(cursor: number, length: number): number {
  return Math.max(
    0,
    Math.min(cursor - Math.floor(VISIBLE_ROWS / 2), Math.max(0, length - VISIBLE_ROWS))
  );
}

function isEditableDefinition(definition: VariantDefinitionDetail | undefined): boolean {
  return definition?.system === 'cva' || definition?.system === 'tv';
}

async function fetchVariantPreview(
  componentPath: string,
  targetDefinition: string,
  operation: VariantPreviewOperation
): Promise<VariantGenerationPreview | null> {
  const base = getBackendUrl();
  try {
    const response = await fetch(`${base}/api/variants/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentPath, targetDefinition, operation }),
    });
    const data = (await response.json()) as {
      success: boolean;
      preview?: VariantGenerationPreview;
      error?: { message?: string };
    };
    if (!response.ok || !data.success || !data.preview) {
      return null;
    }
    return data.preview;
  } catch {
    return null;
  }
}

export function Variants({ summary }: { summary: StudioSummary | null }) {
  const [components, setComponents] = useState<VariantComponentSummary[]>(
    summary?.variants.components ?? []
  );
  const [compIdx, setCompIdx] = useState(0);
  const [detail, setDetail] = useState<VariantComponentDetail | null>(null);
  const [defIdx, setDefIdx] = useState(0);
  const [axisIdx, setAxisIdx] = useState(0);
  const [focus, setFocus] = useState<Focus>('components');
  const [edit, setEdit] = useState<EditState>({ kind: 'none' });
  const [draft, setDraft] = useState('');
  const [pendingOp, setPendingOp] = useState<VariantPreviewOperation | null>(null);
  const [files, setFiles] = useState<DiffFileChange[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeComponent = components[Math.min(compIdx, Math.max(components.length - 1, 0))];
  const definitions = detail?.definitions ?? [];
  const activeDefinition = definitions[Math.min(defIdx, Math.max(definitions.length - 1, 0))];
  const axes = activeDefinition?.axes ?? [];
  const activeAxis = axes[Math.min(axisIdx, Math.max(axes.length - 1, 0))];

  useEffect(() => {
    let cancelled = false;
    async function loadComponents() {
      const response = await getVariantComponents();
      if (cancelled) return;
      if (response.success && response.data) {
        setComponents(response.data.components);
      } else if (response.error && components.length === 0) {
        setError(response.error.message);
      }
    }
    void loadComponents();
    return () => {
      cancelled = true;
    };
  }, [components.length]);

  const loadDetail = useCallback(async (path: string) => {
    setLoadingDetail(true);
    const response = await getVariantComponent(path);
    setLoadingDetail(false);
    if (response.success && response.data) {
      setDetail(response.data.component);
      setDefIdx(0);
      setAxisIdx(0);
    } else if (response.error) {
      setError(response.error.message);
    }
  }, []);

  useEffect(() => {
    if (activeComponent && (!detail || detail.path !== activeComponent.path)) {
      void loadDetail(activeComponent.path);
    }
  }, [activeComponent, detail, loadDetail]);

  const runPreview = useCallback(
    async (operation: VariantPreviewOperation) => {
      if (!activeComponent || !activeDefinition) return;
      setBusy(true);
      setError(null);
      const preview = await fetchVariantPreview(
        activeComponent.path,
        activeDefinition.name,
        operation
      );
      setBusy(false);
      if (!preview) {
        setError('Could not preview variant change (unsupported definition or invalid operation).');
        return;
      }
      setPendingOp(operation);
      setFiles([
        {
          path: activeComponent.path,
          before: preview.before,
          after: preview.after,
          changes: preview.changes,
        },
      ]);
      setStatus(null);
    },
    [activeComponent, activeDefinition]
  );

  const applyPending = useCallback(async () => {
    if (!activeComponent || !activeDefinition || !pendingOp || busy) return;
    setBusy(true);
    setError(null);
    const response = await applyVariantGeneration({
      componentPath: activeComponent.path,
      targetDefinition: activeDefinition.name,
      operation: pendingOp,
    });
    setBusy(false);
    if (response.success) {
      setStatus(`Applied variant change to ${activeComponent.name}.`);
      setPendingOp(null);
      setFiles([]);
      await loadDetail(activeComponent.path);
    } else {
      setError(response.error?.message ?? 'Failed to apply variant change.');
    }
  }, [activeComponent, activeDefinition, pendingOp, busy, loadDetail]);

  const clearPending = useCallback(() => {
    setPendingOp(null);
    setFiles([]);
    setStatus(null);
  }, []);

  useInput(
    (input, key) => {
      if (edit.kind !== 'none') {
        if (edit.kind === 'set-default-value') {
          if (key.upArrow) {
            setEdit((current) =>
              current.kind === 'set-default-value'
                ? {
                    ...current,
                    cursor: Math.max(0, current.cursor - 1),
                  }
                : current
            );
          } else if (key.downArrow) {
            setEdit((current) =>
              current.kind === 'set-default-value'
                ? {
                    ...current,
                    cursor: Math.min(current.candidates.length - 1, current.cursor + 1),
                  }
                : current
            );
          } else if (key.return) {
            const axisName = edit.axisName;
            const valueName = edit.candidates[edit.cursor];
            setEdit({ kind: 'none' });
            void runPreview({ type: 'set-default', axisName, valueName });
          } else if (key.escape || input === 'q') {
            setEdit({ kind: 'none' });
          }
        } else if (key.escape) {
          setEdit({ kind: 'none' });
          setDraft('');
        }
        return;
      }

      if (pendingOp) {
        if (input === 'y') {
          void applyPending();
        } else if (input === 'c' || key.escape || input === 'q') {
          clearPending();
        }
        return;
      }

      if (focus === 'components') {
        if (key.upArrow) {
          setCompIdx((i) => Math.max(0, i - 1));
          setFocus('components');
        } else if (key.downArrow) {
          setCompIdx((i) => Math.min(components.length - 1, i + 1));
        } else if (key.return || key.rightArrow) {
          setFocus('definitions');
        }
        return;
      }

      if (key.tab) {
        setFocus((current) =>
          current === 'components'
            ? 'definitions'
            : current === 'definitions'
              ? 'axes'
              : 'components'
        );
        return;
      }
      if (key.leftArrow) {
        setFocus((current) => (current === 'axes' ? 'definitions' : 'components'));
        return;
      }
      if (key.rightArrow) {
        setFocus((current) => (current === 'components' ? 'definitions' : 'axes'));
        return;
      }

      if (key.upArrow) {
        if (focus === 'definitions') {
          setDefIdx((i) => Math.max(0, i - 1));
          setAxisIdx(0);
        } else {
          setAxisIdx((i) => Math.max(0, i - 1));
        }
        return;
      }
      if (key.downArrow) {
        if (focus === 'definitions') {
          setDefIdx((i) => Math.min(definitions.length - 1, i + 1));
          setAxisIdx(0);
        } else {
          setAxisIdx((i) => Math.min(axes.length - 1, i + 1));
        }
        return;
      }

      if (!isEditableDefinition(activeDefinition)) {
        if (key.escape) setFocus('components');
        return;
      }

      if (input === 's') {
        if (!activeAxis) {
          setError('Select an axis first to set its default value.');
          return;
        }
        setEdit({
          kind: 'set-default-value',
          axisName: activeAxis.name,
          candidates: activeAxis.values.map((value) => value.name),
          cursor: 0,
        });
        return;
      }

      if (input === 'v') {
        if (!activeAxis) {
          setError('Select an axis first to add a variant value.');
          return;
        }
        setEdit({ kind: 'add-value-name' });
        setDraft('');
        return;
      }

      if (input === 'a') {
        setEdit({ kind: 'add-axis-name' });
        setDraft('');
        return;
      }

      if (key.escape) {
        setFocus('components');
      }
    },
    {
      isActive: true,
    }
  );

  if (components.length === 0 && !loadingDetail) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
        <Text color={THEME.muted}>{SYMBOLS.circle} No components with variants detected yet.</Text>
        {error && <Text color={THEME.error}>{error}</Text>}
      </Box>
    );
  }

  const compStart = windowStart(compIdx, components.length);
  const defStart = windowStart(defIdx, definitions.length);
  const axisStart = windowStart(axisIdx, axes.length);

  const editingText =
    edit.kind === 'add-value-name' ||
    edit.kind === 'add-value-classes' ||
    edit.kind === 'add-axis-name' ||
    edit.kind === 'add-axis-value-name' ||
    edit.kind === 'add-axis-value-classes';

  return (
    <Box flexDirection="column">
      <Box>
        <Column title="Components" active={focus === 'components'}>
          {components.length === 0 && <Text color={THEME.muted}>loading…</Text>}
          {components.slice(compStart, compStart + VISIBLE_ROWS).map((component, idx) => (
            <Row
              key={component.path}
              label={`${component.name} ${SYMBOLS.line} ${component.variantCount} defs`}
              selected={compStart + idx === compIdx}
              active={focus === 'components'}
            />
          ))}
        </Column>

        <Column title="Definitions" active={focus === 'definitions'}>
          {loadingDetail && (
            <Text color={THEME.secondary}>
              <Spinner type="dots" /> loading
            </Text>
          )}
          {!loadingDetail && definitions.length === 0 && (
            <Text color={THEME.muted}>no definitions</Text>
          )}
          {definitions.slice(defStart, defStart + VISIBLE_ROWS).map((definition, idx) => (
            <Row
              key={definition.name}
              label={`${definition.name} ${SYMBOLS.line} ${definition.system}`}
              selected={defStart + idx === defIdx}
              active={focus === 'definitions'}
              marker={isEditableDefinition(definition) ? undefined : SYMBOLS.cross}
            />
          ))}
        </Column>

        <Column title="Axes" active={focus === 'axes'}>
          {!isEditableDefinition(activeDefinition) && (
            <Text color={THEME.muted}>select a cva/tv definition</Text>
          )}
          {isEditableDefinition(activeDefinition) && axes.length === 0 && (
            <Text color={THEME.muted}>no axes</Text>
          )}
          {axes.slice(axisStart, axisStart + VISIBLE_ROWS).map((axis, idx) => (
            <Row
              key={axis.name}
              label={`${axis.name} ${SYMBOLS.line} ${axis.values.length} values`}
              selected={axisStart + idx === axisIdx}
              active={focus === 'axes'}
            />
          ))}
        </Column>
      </Box>

      {edit.kind === 'set-default-value' && (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor={THEME.accent}
          paddingX={1}
        >
          <Text color={THEME.accent}>
            {SYMBOLS.arrow} Set default for <Text bold>{edit.axisName}</Text> ─ pick a value
          </Text>
          {edit.candidates.map((candidate, idx) => (
            <Text key={candidate} color={idx === edit.cursor ? THEME.secondary : undefined}>
              <Text color={idx === edit.cursor ? THEME.primary : THEME.muted}>
                {idx === edit.cursor ? SYMBOLS.arrow : ' '}
              </Text>{' '}
              {candidate}
            </Text>
          ))}
          <Text color={THEME.muted}>↑/↓ move │ ↵ choose │ q cancel</Text>
        </Box>
      )}

      {editingText && (
        <Box marginTop={1} borderStyle="round" borderColor={THEME.accent} paddingX={1}>
          <Text color={THEME.accent}>{editPrompt(edit)} </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={onEditSubmit} />
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <DiffPreview
          title={activeComponent ? `Variant: ${activeComponent.name}` : 'Variant editor'}
          files={files}
          interactive={false}
          emptyMessage="Select a definition and press s/v/a to stage a variant edit. It previews here before you apply."
          visibleLines={10}
        />
      </Box>

      {busy && (
        <Box marginTop={1}>
          <Text color={THEME.secondary}>
            <Spinner type="dots" />
          </Text>
          <Text color={THEME.muted}> Working…</Text>
        </Box>
      )}
      {status && !busy && (
        <Text color={THEME.success}>
          {SYMBOLS.check} {status}
        </Text>
      )}
      {error && (
        <Text color={THEME.error}>
          {SYMBOLS.cross} {error}
        </Text>
      )}

      <Box marginTop={1}>
        {pendingOp ? (
          <Text color={THEME.muted}>
            <Text color={THEME.secondary}>y</Text> Apply │ <Text color={THEME.secondary}>c</Text>{' '}
            Cancel
          </Text>
        ) : (
          <Text color={THEME.muted}>
            <Text color={THEME.secondary}>↑/↓</Text> Move │{' '}
            <Text color={THEME.secondary}>←/→/Tab</Text> Pane │{' '}
            <Text color={THEME.secondary}>s</Text> Set default │{' '}
            <Text color={THEME.secondary}>v</Text> Add value │{' '}
            <Text color={THEME.secondary}>a</Text> Add axis
          </Text>
        )}
      </Box>
    </Box>
  );

  function editPrompt(state: EditState): string {
    switch (state.kind) {
      case 'add-value-name':
        return activeAxis ? `New value name for ${activeAxis.name}:` : 'New value name:';
      case 'add-value-classes':
        return `Classes for ${state.valueName}:`;
      case 'add-axis-name':
        return 'New axis name:';
      case 'add-axis-value-name':
        return `First value name for ${state.axisName}:`;
      case 'add-axis-value-classes':
        return `Classes for ${state.valueName}:`;
      default:
        return '';
    }
  }

  function onEditSubmit(value: string) {
    const next = value.trim();
    setDraft('');
    setEdit((current) => {
      if (current.kind === 'add-value-name') {
        if (!next || !activeAxis) return { kind: 'none' };
        return { kind: 'add-value-classes', valueName: next };
      }
      if (current.kind === 'add-value-classes') {
        const valueName = current.valueName;
        if (!next || !activeAxis) return { kind: 'none' };
        const op: VariantPreviewOperation = {
          type: 'add-value',
          axisName: activeAxis.name,
          value: { name: valueName, classes: next.split(/\s+/).filter(Boolean) },
        };
        void runPreview(op);
        return { kind: 'none' };
      }
      if (current.kind === 'add-axis-name') {
        if (!next) return { kind: 'none' };
        return { kind: 'add-axis-value-name', axisName: next };
      }
      if (current.kind === 'add-axis-value-name') {
        if (!next) return { kind: 'none' };
        return { kind: 'add-axis-value-classes', axisName: current.axisName, valueName: next };
      }
      if (current.kind === 'add-axis-value-classes') {
        const axisName = current.axisName;
        const valueName = current.valueName;
        if (!next) return { kind: 'none' };
        const variantValue: VariantValue = {
          name: valueName,
          classes: next.split(/\s+/).filter(Boolean),
        };
        const axis: VariantAxis = {
          name: axisName,
          values: [variantValue],
          defaultValue: valueName,
        };
        void runPreview({ type: 'add-axis', axis, defaultValue: valueName });
        return { kind: 'none' };
      }
      return { kind: 'none' };
    });
  }
}

function Column({
  title,
  active,
  children,
}: {
  title: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={active ? THEME.primary : THEME.muted}
      paddingX={1}
      marginRight={1}
      minWidth={24}
    >
      <Text bold color={active ? THEME.highlight : THEME.muted}>
        {title}
      </Text>
      {children}
    </Box>
  );
}

function Row({
  label,
  selected,
  active,
  marker,
}: {
  label: string;
  selected: boolean;
  active: boolean;
  marker?: string;
}) {
  return (
    <Text color={selected ? (active ? THEME.secondary : THEME.highlight) : undefined}>
      <Text color={selected ? THEME.primary : THEME.muted}>{selected ? SYMBOLS.arrow : ' '}</Text>
      {marker ? <Text color={THEME.muted}>{marker} </Text> : ' '}
      {label}
    </Text>
  );
}
