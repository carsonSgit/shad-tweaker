import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState } from 'react';
import { getStudioSummary } from '../api/client.js';
import { SYMBOLS, THEME } from '../App.js';
import type { StudioSummary } from '../types/index.js';
import type { WorkbenchArea } from '../workbench.js';
import { getWorkbenchAreaMeta } from '../workbench.js';

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
        <Text color={THEME.error}>{SYMBOLS.cross} {error}</Text>
        <Text color={THEME.muted}>Press r to retry.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={THEME.highlight}>
          {SYMBOLS.diamond} {meta.label}
        </Text>
        <Text color={THEME.muted}> - {meta.description}</Text>
      </Box>

      {area === 'registries' && <Registries summary={summary} />}
      {area === 'tokens' && <Tokens summary={summary} />}
      {area === 'variants' && <Variants summary={summary} />}
      {area === 'motion' && <Motion summary={summary} />}
      {area === 'preview' && <PreviewHub onNavigate={onNavigate} />}
      {area === 'diff' && <DiffHub summary={summary} onNavigate={onNavigate} />}
      {area === 'settings' && <Settings summary={summary} />}

      <Box marginTop={1}>
        <Text color={THEME.muted}>Press </Text>
        <Text color={THEME.secondary}>r</Text>
        <Text color={THEME.muted}> to refresh summary data.</Text>
      </Box>
    </Box>
  );
}

function Registries({ summary }: { summary: StudioSummary | null }) {
  const sources = summary?.registries.sources ?? [];
  const enabled = sources.filter((source) => source.enabled).length;
  const health = summary?.registries.health ?? [];
  const items = summary?.registries.items ?? [];

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
      <Text>
        <Text color={THEME.secondary}>{sources.length}</Text> sources,{' '}
        <Text color={THEME.success}>{enabled}</Text> enabled,{' '}
        <Text color={THEME.secondary}>{items.length}</Text> items visible
      </Text>
      {sources.length === 0 ? (
        <Text color={THEME.muted}>No registry sources configured yet.</Text>
      ) : (
        sources.slice(0, 8).map((source) => {
          const sourceHealth = health.find((item) => item.sourceId === source.id);
          return (
            <Text key={source.id}>
              {source.enabled ? SYMBOLS.check : SYMBOLS.circle} {source.name} ({source.type}){' '}
              <Text color={THEME.muted}>{source.registryJsonUrl || source.baseUrl || 'local'}</Text>{' '}
              <Text color={THEME.secondary}>{sourceHealth?.status ?? 'not checked'}</Text>
            </Text>
          );
        })
      )}
    </Box>
  );
}

function Tokens({ summary }: { summary: StudioSummary | null }) {
  const sets = summary?.tokens.tokenSets ?? [];
  const categories = tokenCategories(summary);
  const frequency = summary?.tokens.frequency?.entries ?? [];
  const inconsistencies = summary?.tokens.inconsistencies?.entries ?? [];

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
      <Text>
        <Text color={THEME.secondary}>{sets.length}</Text> token sets,{' '}
        <Text color={THEME.secondary}>{categories.length}</Text> active categories,{' '}
        <Text color={THEME.accent}>{inconsistencies.length}</Text> inconsistency groups
      </Text>
      <Text color={THEME.muted}>Categories: {categories.join(', ') || 'none yet'}</Text>
      {frequency.slice(0, 5).map((entry) => (
        <Text key={`${entry.category}:${entry.value}`}>
          {entry.category} {entry.value} - {entry.occurrences} uses
        </Text>
      ))}
    </Box>
  );
}

function Variants({ summary }: { summary: StudioSummary | null }) {
  const components = summary?.variants.components ?? [];
  const systems = new Set(components.flatMap((component) => component.systems));

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
      <Text>
        <Text color={THEME.secondary}>{components.length}</Text> components with variants, systems:{' '}
        <Text color={THEME.muted}>{[...systems].join(', ') || 'none detected'}</Text>
      </Text>
      {components.slice(0, 8).map((component) => (
        <Text key={component.path}>
          {component.name} - {component.variantCount} definitions - axes:{' '}
          {component.axes.join(', ') || 'none'}
        </Text>
      ))}
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
