import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useMemo, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import { exportComponentPackage } from '../api/client.js';
import type {
  ComponentExportResult,
  ComponentExportTarget,
  StudioSummary,
} from '../types/index.js';
import type { WorkbenchArea } from '../workbench.js';
import { DiffPreview } from './DiffPreview.js';

/**
 * Export / publish flow for the current component set.
 *
 * Select components, pick a target, preview the planned output through the
 * shared diff pane, then write it via the existing export service.
 */

interface ExportViewProps {
  summary: StudioSummary | null;
  onNavigate: (area: WorkbenchArea) => void;
}

type Stage = 'select' | 'preview' | 'done';

const TARGETS: ComponentExportTarget[] = ['folder', 'npm-package', 'registry'];
const VISIBLE_COUNT = 8;

interface PlannedEntry {
  path: string;
  content: string;
}

/** Builds the planned output tree (paths + manifest content) shown before writing. */
function buildPlan(
  names: string[],
  target: ComponentExportTarget,
  outputDir: string
): PlannedEntry[] {
  const shared = [
    'tokens/css-variables.css',
    'tokens/tokens.json',
    'dependencies.json',
    'README.md',
    'TAILWIND.md',
  ];
  let componentFiles: string[];
  if (target === 'folder') {
    componentFiles = names.map((name) => `components/ui/${name}.tsx`);
  } else if (target === 'npm-package') {
    componentFiles = ['package.json', 'src/index.ts', ...names.map((name) => `src/${name}.tsx`)];
  } else {
    componentFiles = ['registry.json', ...names.map((name) => `r/${name}.json`)];
  }
  const tree = [...componentFiles, ...shared].sort();
  return [
    {
      path: `${outputDir}/`,
      content: `${tree.join('\n')}\n`,
    },
  ];
}

export function ExportView({ summary, onNavigate }: ExportViewProps) {
  const inventory = useMemo(() => summary?.components.inventory ?? [], [summary]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetIdx, setTargetIdx] = useState(0);
  const [stage, setStage] = useState<Stage>('select');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComponentExportResult | null>(null);

  const target = TARGETS[targetIdx] ?? 'folder';
  const outputDir = `exports/${target}`;
  const selectedItems = inventory.filter((item) => selected.has(item.path));

  const plan = useMemo(
    () =>
      buildPlan(
        selectedItems.map((item) => item.name),
        target,
        outputDir
      ),
    [selectedItems, target, outputDir]
  );

  async function runExport() {
    if (selectedItems.length === 0) return;
    setBusy(true);
    setError(null);
    const response = await exportComponentPackage({
      componentPaths: selectedItems.map((item) => item.path),
      target,
    });
    if (response.success && response.data) {
      setResult(response.data.result);
      setStage('done');
    } else {
      setError(response.error?.message ?? 'Export failed');
      setStage('select');
    }
    setBusy(false);
  }

  useInput(
    (input, key) => {
      if (stage === 'done') {
        if (key.escape || input === 'q') {
          setStage('select');
          setResult(null);
        }
        return;
      }
      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
      } else if (key.downArrow) {
        setCursor((c) => Math.min(Math.max(inventory.length - 1, 0), c + 1));
      } else if (input === ' ') {
        const item = inventory[cursor];
        if (!item) return;
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(item.path)) next.delete(item.path);
          else next.add(item.path);
          return next;
        });
      } else if (input === 'a') {
        setSelected(new Set(inventory.map((item) => item.path)));
      } else if (input === 'n') {
        setSelected(new Set());
      } else if (input === 't') {
        setTargetIdx((idx) => (idx + 1) % TARGETS.length);
      } else if (input === 'p' && selectedItems.length > 0) {
        setError(null);
        setStage('preview');
      } else if (input === 'c') {
        onNavigate('components');
      }
    },
    { isActive: stage !== 'preview' && !busy }
  );

  if (busy) {
    return (
      <Box>
        <Text color={THEME.success}>
          <Spinner type="dots" />
        </Text>
        <Text color={THEME.muted}> Writing export to {outputDir}...</Text>
      </Box>
    );
  }

  if (stage === 'preview') {
    return (
      <DiffPreview
        title={`Export preview - ${target} (${selectedItems.length} components)`}
        files={plan.map((entry) => ({ path: entry.path, before: '', after: entry.content }))}
        submitLabel="write export"
        onSubmit={runExport}
        onCancel={() => setStage('select')}
      />
    );
  }

  if (stage === 'done' && result) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
        <Text bold color={result.validation.valid ? THEME.success : THEME.error}>
          {result.validation.valid ? SYMBOLS.check : SYMBOLS.cross} Export {result.target} -{' '}
          {result.files.length} files
        </Text>
        <Text color={THEME.muted}>Output: {result.outputDir}</Text>
        {result.dependencies.length > 0 && (
          <Text color={THEME.muted}>Dependencies: {result.dependencies.join(', ')}</Text>
        )}
        {result.files.slice(0, 10).map((file) => (
          <Text key={file} color={THEME.secondary}>
            {SYMBOLS.arrow} {file}
          </Text>
        ))}
        {result.files.length > 10 && (
          <Text color={THEME.muted}>...and {result.files.length - 10} more</Text>
        )}
        {result.validation.errors.map((message) => (
          <Text key={message} color={THEME.error}>
            {SYMBOLS.cross} {message}
          </Text>
        ))}
        <Text color={THEME.muted}>Press q/Esc to export again.</Text>
      </Box>
    );
  }

  const start = Math.max(0, Math.min(cursor - 4, inventory.length - VISIBLE_COUNT));
  const visible = inventory.slice(start, start + VISIBLE_COUNT);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
      <Text>
        Target: <Text color={THEME.accent}>{target}</Text>
        <Text color={THEME.muted}> {SYMBOLS.arrow} </Text>
        <Text color={THEME.secondary}>{outputDir}</Text>
      </Text>
      <Text color={THEME.muted}>
        {selected.size} of {inventory.length} components selected
      </Text>

      {inventory.length === 0 ? (
        <Text color={THEME.muted}>
          No components in the workspace inventory. Press c to scan components.
        </Text>
      ) : (
        visible.map((item, idx) => {
          const isCursor = start + idx === cursor;
          const isSelected = selected.has(item.path);
          return (
            <Text key={item.path} color={isCursor ? THEME.highlight : undefined}>
              {isCursor ? SYMBOLS.arrow : ' '} {isSelected ? SYMBOLS.check : SYMBOLS.circle}{' '}
              {item.name}
              <Text color={THEME.muted}> {item.path}</Text>
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
        <Text color={THEME.secondary}>t</Text> Target │ <Text color={THEME.secondary}>p</Text>{' '}
        Preview export
      </Text>
    </Box>
  );
}
