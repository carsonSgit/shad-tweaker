import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import { applyImportPlan, generateImportPlan, getRegistryItems } from '../api/client.js';
import type {
  ApplyImportPlanResult,
  ImportConflictResolution,
  ImportPlan,
  RegistryItemSummary,
  StudioSummary,
} from '../types/index.js';
import type { WorkbenchArea } from '../workbench.js';
import { type DiffFileChange, DiffPreview } from './DiffPreview.js';

/**
 * Registry import flow.
 *
 * Pick registry entries (same data as the registry browser), plan the import,
 * review the planned files in the shared diff pane, then apply and report the
 * per-component outcome.
 */

interface ImportViewProps {
  summary: StudioSummary | null;
  onNavigate: (area: WorkbenchArea) => void;
}

type Stage = 'select' | 'planning' | 'preview' | 'applying' | 'done';

/** Per-component outcome reported after execution. */
interface ImportOutcome {
  item: string;
  ok: boolean;
  detail: string;
}

const VISIBLE_COUNT = 8;

function planFiles(plan: ImportPlan): DiffFileChange[] {
  return [
    ...plan.filesToAdd.map((file) => ({
      path: `${plan.itemName} + ${file.targetPath}`,
      before: '',
      after: file.content,
    })),
    ...plan.filesToOverwrite.map((file) => ({
      path: `${plan.itemName} ~ ${file.targetPath}`,
      before: '',
      after: file.content,
    })),
  ];
}

function summarizeResult(plan: ImportPlan, result: ApplyImportPlanResult): ImportOutcome {
  const parts = [
    `${result.added.length} added`,
    `${result.overwritten.length} overwritten`,
    `${result.skipped.length} skipped`,
  ];
  if (result.rolledBack) parts.push('rolled back');
  if (result.backupId) parts.push(`backup ${result.backupId}`);
  return { item: plan.itemName, ok: result.success, detail: parts.join(', ') };
}

export function ImportView({ summary, onNavigate }: ImportViewProps) {
  const [items, setItems] = useState<RegistryItemSummary[]>(summary?.registries.items ?? []);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<Stage>('select');
  const [plans, setPlans] = useState<ImportPlan[]>([]);
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const response = await getRegistryItems();
    if (response.success && response.data) {
      setItems(response.data.items);
      setError(null);
    } else {
      setError(response.error?.message ?? 'Failed to load registry entries');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if ((summary?.registries.items ?? []).length === 0) refresh();
  }, [refresh, summary]);

  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.id)),
    [items, selected]
  );

  const files = useMemo(() => plans.flatMap(planFiles), [plans]);
  const conflicts = useMemo(() => plans.flatMap((plan) => plan.conflicts), [plans]);
  const dependencies = useMemo(
    () => [...new Set(plans.flatMap((plan) => plan.dependencies))],
    [plans]
  );

  const buildPlans = useCallback(async () => {
    if (selectedItems.length === 0) return;
    setStage('planning');
    setError(null);
    const collected: ImportPlan[] = [];
    const failures: ImportOutcome[] = [];
    for (const item of selectedItems) {
      const response = await generateImportPlan(item.name, item.sourceId);
      if (response.success && response.data) {
        collected.push(response.data.plan);
      } else {
        failures.push({
          item: item.name,
          ok: false,
          detail: response.error?.message ?? 'Failed to plan import',
        });
      }
    }
    setPlans(collected);
    setOutcomes(failures);
    if (collected.length === 0) {
      setError('No importable plans could be generated for the selection.');
      setStage(failures.length > 0 ? 'done' : 'select');
      return;
    }
    setStage('preview');
  }, [selectedItems]);

  const runImport = useCallback(async () => {
    setStage('applying');
    const results: ImportOutcome[] = [...outcomes];
    for (const plan of plans) {
      const resolutions: ImportConflictResolution[] = overwrite
        ? plan.conflicts.map((conflict) => ({ path: conflict.path, action: 'overwrite' as const }))
        : [];
      const response = await applyImportPlan(plan, resolutions);
      if (response.success && response.data) {
        results.push(summarizeResult(plan, response.data.result));
      } else {
        results.push({
          item: plan.itemName,
          ok: false,
          detail: response.error?.message ?? 'Import failed',
        });
      }
    }
    setOutcomes(results);
    setStage('done');
  }, [outcomes, overwrite, plans]);

  useInput(
    (input, key) => {
      if (stage === 'done') {
        if (key.escape || input === 'q') {
          setStage('select');
          setPlans([]);
          setOutcomes([]);
        }
        return;
      }
      if (key.upArrow || input === 'k') {
        setCursor((c) => Math.max(0, c - 1));
      } else if (key.downArrow || input === 'j') {
        setCursor((c) => Math.min(Math.max(items.length - 1, 0), c + 1));
      } else if (input === ' ') {
        const item = items[cursor];
        if (!item) return;
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
      } else if (input === 'a') {
        setSelected(new Set(items.map((item) => item.id)));
      } else if (input === 'n') {
        setSelected(new Set());
      } else if (input === 'o') {
        setOverwrite((value) => !value);
      } else if (input === 'R') {
        refresh();
      } else if (input === 'p') {
        buildPlans();
      } else if (input === 'g') {
        onNavigate('registries');
      }
    },
    { isActive: stage === 'select' || stage === 'done' }
  );

  if (loading && items.length === 0) {
    return (
      <Box>
        <Text color={THEME.success}>
          <Spinner type="dots" />
        </Text>
        <Text color={THEME.muted}> Loading registry entries...</Text>
      </Box>
    );
  }

  if (stage === 'planning' || stage === 'applying') {
    return (
      <Box>
        <Text color={THEME.success}>
          <Spinner type="dots" />
        </Text>
        <Text color={THEME.muted}>
          {stage === 'planning'
            ? ` Planning import for ${selectedItems.length} component(s)...`
            : ` Importing ${plans.length} component(s)...`}
        </Text>
      </Box>
    );
  }

  if (stage === 'preview') {
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
          <Text bold color={THEME.secondary}>
            Import plan - {plans.length} component(s), {files.length} file(s)
          </Text>
          {dependencies.length > 0 && (
            <Text color={THEME.muted}>Dependencies: {dependencies.join(', ')}</Text>
          )}
          <Text>
            Conflicts:{' '}
            <Text color={conflicts.length > 0 ? THEME.accent : THEME.success}>
              {conflicts.length}
            </Text>{' '}
            | on apply:{' '}
            <Text color={overwrite ? THEME.accent : THEME.muted}>
              {overwrite ? 'overwrite' : 'planner default'}
            </Text>
          </Text>
          {conflicts.slice(0, 4).map((conflict) => (
            <Text key={`${conflict.path}:${conflict.type}`} color={THEME.accent}>
              {SYMBOLS.circle} {conflict.path}: {conflict.message}
            </Text>
          ))}
        </Box>
        <DiffPreview
          title={`Import preview - ${plans.map((plan) => plan.itemName).join(', ')}`}
          files={files}
          submitLabel="run import"
          onSubmit={runImport}
          onCancel={() => {
            setPlans([]);
            setStage('select');
          }}
        />
      </Box>
    );
  }

  if (stage === 'done') {
    const failed = outcomes.filter((outcome) => !outcome.ok).length;
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
        <Text bold color={failed === 0 ? THEME.success : THEME.error}>
          {failed === 0 ? SYMBOLS.check : SYMBOLS.cross} Import finished -{' '}
          {outcomes.length - failed} succeeded, {failed} failed
        </Text>
        {outcomes.map((outcome) => (
          <Text key={outcome.item} color={outcome.ok ? THEME.success : THEME.error}>
            {outcome.ok ? SYMBOLS.check : SYMBOLS.cross} {outcome.item}
            <Text color={THEME.muted}> - {outcome.detail}</Text>
          </Text>
        ))}
        <Text color={THEME.muted}>Press q/Esc to import more.</Text>
      </Box>
    );
  }

  const start = Math.max(0, Math.min(cursor - 4, items.length - VISIBLE_COUNT));
  const visible = items.slice(start, start + VISIBLE_COUNT);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
      <Text color={THEME.muted}>
        {selected.size} of {items.length} registry entries selected
      </Text>

      {items.length === 0 ? (
        <Text color={THEME.muted}>
          No registry entries available. Press g to browse registries, R to reload.
        </Text>
      ) : (
        visible.map((item, idx) => {
          const isCursor = start + idx === cursor;
          const isSelected = selected.has(item.id);
          return (
            <Text key={item.id} color={isCursor ? THEME.highlight : undefined}>
              {isCursor ? SYMBOLS.arrow : ' '} {isSelected ? SYMBOLS.check : SYMBOLS.circle}{' '}
              {item.name}
              <Text color={THEME.muted}>
                {' '}
                {item.type} · {item.sourceName}
              </Text>
            </Text>
          );
        })
      )}

      {error && (
        <Text color={THEME.error}>
          {SYMBOLS.cross} {error}
        </Text>
      )}

      <Text color={THEME.muted}>
        <Text color={THEME.secondary}>↑/↓</Text> Move │ <Text color={THEME.secondary}>space</Text>{' '}
        Toggle │ <Text color={THEME.secondary}>a/n</Text> All/None │{' '}
        <Text color={THEME.secondary}>o</Text> Overwrite conflicts ({overwrite ? 'on' : 'off'}) │{' '}
        <Text color={THEME.secondary}>p</Text> Plan import │ <Text color={THEME.secondary}>R</Text>{' '}
        Reload
      </Text>
    </Box>
  );
}
