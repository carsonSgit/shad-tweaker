import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import { getStudioSummary } from '../api/client.js';
import type { StudioSummary } from '../types/index.js';
import type { WorkbenchArea } from '../workbench.js';
import { getWorkbenchAreaMeta } from '../workbench.js';
import { DiffPreview } from './DiffPreview.js';
import { ExportView } from './ExportView.js';
import { ImportView } from './ImportView.js';
import { Registries } from './Registries.js';
import { Tokens } from './Tokens.js';
import { Variants } from './Variants.js';

interface WorkbenchPanelProps {
  area: WorkbenchArea;
  summary: StudioSummary | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onNavigate: (area: WorkbenchArea) => void;
}

function countBackupComponents(value: StudioSummary['backups']['backups'][number]): number {
  return value.components;
}

function tokenCategories(summary: StudioSummary | null): string[] {
  if (!summary) return [];
  const categories = new Set<string>();
  for (const tokenSet of summary.tokens.tokenSets) {
    for (const [category, tokens] of Object.entries(tokenSet.tokens)) {
      if (Object.keys(tokens).length > 0) {
        categories.add(category);
      }
    }
  }
  return [...categories].sort();
}

export function WorkbenchPanel({
  area,
  summary,
  loading,
  error,
  onRefresh,
  onNavigate,
}: WorkbenchPanelProps) {
  const meta = getWorkbenchAreaMeta(area);

  useInput((input) => {
    if (input === 'r') {
      onRefresh();
    }
  });

  if (loading && !summary) {
    return (
      <Box>
        <Text color={THEME.success}>
          <Spinner type="dots" />
        </Text>
        <Text color={THEME.muted}> Loading studio summary...</Text>
      </Box>
    );
  }

  if (error && !summary) {
    return (
      <Box flexDirection="column">
        <Text color={THEME.error}>
          {SYMBOLS.cross} {error}
        </Text>
        <Text color={THEME.muted}>Press r to retry.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* TODO(studio-shell): Replace milestone stub panels as each workbench area graduates. */}
      <Box marginBottom={1}>
        <Text bold color={THEME.highlight}>
          {SYMBOLS.diamond} {meta.label}
        </Text>
        <Text color={THEME.muted}> - {meta.description}</Text>
      </Box>

      {area === 'registries' && <Registries summary={summary} />}
      {area === 'import' && <ImportView summary={summary} onNavigate={onNavigate} />}
      {area === 'tokens' && <Tokens summary={summary} />}
      {area === 'variants' && <Variants summary={summary} />}
      {area === 'motion' && <Motion summary={summary} />}
      {area === 'pixel-inspector' && <PixelInspector summary={summary} />}
      {area === 'preview' && <PreviewHub onNavigate={onNavigate} />}
      {area === 'diff' && <DiffHub summary={summary} onNavigate={onNavigate} />}
      {area === 'export' && <ExportView summary={summary} onNavigate={onNavigate} />}
      {area === 'settings' && <Settings summary={summary} />}

      <Box marginTop={1}>
        <Text color={THEME.muted}>Press </Text>
        <Text color={THEME.secondary}>r</Text>
        <Text color={THEME.muted}> to refresh summary data.</Text>
      </Box>
    </Box>
  );
}

function Motion({ summary }: { summary: StudioSummary | null }) {
  const categories = tokenCategories(summary).filter((category) =>
    ['motion', 'easing', 'duration'].includes(category)
  );

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
      <Text>
        Motion token readiness:{' '}
        <Text color={categories.length > 0 ? THEME.success : THEME.muted}>
          {categories.length > 0 ? categories.join(', ') : 'no motion tokens found'}
        </Text>
      </Text>
      <Text color={THEME.muted}>
        Motion authoring belongs to the Motion Editor epic; this shell exposes readiness now.
      </Text>
    </Box>
  );
}

function PixelInspector({ summary }: { summary: StudioSummary | null }) {
  const componentCount = summary?.components.inventory.length ?? 0;
  const tokenSetCount = summary?.tokens.tokenSets.length ?? 0;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
      <Text>
        Pixel Inspector is available in the browser studio. Components:{' '}
        <Text color={THEME.secondary}>{componentCount}</Text>, token sets:{' '}
        <Text color={THEME.secondary}>{tokenSetCount}</Text>
      </Text>
      <Text color={THEME.muted}>
        Launch with studio --web to tune classes in the preview iframe.
      </Text>
    </Box>
  );
}

function PreviewHub({ onNavigate }: { onNavigate: (area: WorkbenchArea) => void }) {
  useInput((input) => {
    if (input === 'c') onNavigate('components');
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
      <Text>Text/class previews are available from selected components.</Text>
      <Text color={THEME.muted}>
        Press <Text color={THEME.secondary}>c</Text> to go to Components, select files, then edit.
      </Text>
    </Box>
  );
}

function DiffHub({
  summary,
  onNavigate,
}: {
  summary: StudioSummary | null;
  onNavigate: (area: WorkbenchArea) => void;
}) {
  const latestBackup = summary?.backups.backups[0];

  useInput((input) => {
    if (input === 'b') onNavigate('backups');
    if (input === 'c') onNavigate('components');
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
      <Text>Diffs appear after edit previews or backup preview selection.</Text>
      <DiffPreview
        title="Pending tweaks"
        files={[]}
        values={[]}
        interactive={false}
        emptyMessage="No pending tweaks staged. Stage changes from import, preset, variant or export flows."
      />

      {latestBackup ? (
        <Text>
          Latest backup: {latestBackup.id} ({countBackupComponents(latestBackup)} components)
        </Text>
      ) : (
        <Text color={THEME.muted}>No backups available yet.</Text>
      )}
      <Text color={THEME.muted}>Press c for Components or b for Backups.</Text>
    </Box>
  );
}

function Settings({ summary }: { summary: StudioSummary | null }) {
  const manifest = summary?.workspace.manifest;
  const config = manifest?.config;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
      <Text>
        Project: <Text color={THEME.secondary}>{summary?.workspace.cwd ?? 'unknown'}</Text>
      </Text>
      <Text>Component directory: {config?.componentDirectory ?? 'unknown'}</Text>
      <Text>Port: {config?.port ?? 'unknown'}</Text>
      <Text>
        Backups: max {config?.maxBackups ?? 'unknown'}, retention{' '}
        {config?.backupRetentionDays ?? 'unknown'} days
      </Text>
      <Text>
        Auto backup: {config?.autoBackup ? 'on' : 'off'} | Validate after edit:{' '}
        {config?.validateAfterEdit ? 'on' : 'off'}
      </Text>
    </Box>
  );
}

export function useStudioSummary() {
  const [summary, setSummary] = useState<StudioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    const result = await getStudioSummary();
    if (result.success && result.data) {
      setSummary(result.data);
    } else {
      setError(result.error?.message || 'Failed to load studio summary');
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  return { summary, loading, error, refresh };
}
