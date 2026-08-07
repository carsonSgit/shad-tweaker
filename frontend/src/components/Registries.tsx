import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import * as api from '../api/client.js';
import type {
  RegistryItemSummary,
  RegistrySource,
  RegistrySourceHealth,
  StudioSummary,
} from '../types/index.js';

interface RegistriesProps {
  summary?: StudioSummary | null;
}

interface RegistryWarning {
  sourceId: string;
  sourceName: string;
  message: string;
}

interface RegistryData {
  sources: RegistrySource[];
  health: RegistrySourceHealth[];
  items: RegistryItemSummary[];
  warnings: RegistryWarning[];
}

type Pane = 'sources' | 'items';

const EMPTY_DATA: RegistryData = { sources: [], health: [], items: [], warnings: [] };
const VISIBLE_ROWS = 8;

function useRegistryData(summary?: StudioSummary | null) {
  const [data, setData] = useState<RegistryData>(summary?.registries ?? EMPTY_DATA);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [sources, health, items] = await Promise.all([
      api.getRegistrySources(),
      api.getRegistrySourceHealth(),
      api.getRegistryItems(),
    ]);

    if (!sources.success || !sources.data) {
      setError(sources.error?.message || 'Failed to load registry sources');
      setLoading(false);
      return;
    }

    setData({
      sources: sources.data.sources,
      health: health.success && health.data ? health.data.health : [],
      items: items.success && items.data ? items.data.items : [],
      warnings: items.success && items.data ? items.data.warnings : [],
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}

function statusColor(status: RegistrySourceHealth['status'] | 'unknown'): string {
  if (status === 'healthy') return THEME.success;
  if (status === 'degraded') return THEME.accent;
  if (status === 'unhealthy') return THEME.error;
  return THEME.muted;
}

function windowFor<T>(entries: T[], cursor: number): { slice: T[]; start: number } {
  const start = Math.max(0, Math.min(cursor - 3, entries.length - VISIBLE_ROWS));
  return {
    slice: entries.slice(Math.max(0, start), Math.max(0, start) + VISIBLE_ROWS),
    start: Math.max(0, start),
  };
}

export function Registries({ summary }: RegistriesProps) {
  const { data, loading, error, refresh } = useRegistryData(summary);
  const [pane, setPane] = useState<Pane>('sources');
  const [sourceCursor, setSourceCursor] = useState(0);
  const [itemCursor, setItemCursor] = useState(0);

  const sources = data.sources;
  const selectedSource = sources[Math.min(sourceCursor, Math.max(0, sources.length - 1))];

  const items = useMemo(
    () => (selectedSource ? data.items.filter((item) => item.sourceId === selectedSource.id) : []),
    [data.items, selectedSource]
  );
  const selectedItem = items[Math.min(itemCursor, Math.max(0, items.length - 1))];

  const health = selectedSource
    ? data.health.find((entry) => entry.sourceId === selectedSource.id)
    : undefined;
  const warnings = selectedSource
    ? data.warnings.filter((warning) => warning.sourceId === selectedSource.id)
    : [];

  useInput((input, key) => {
    const down = key.downArrow || input === 'j';
    const up = key.upArrow || input === 'k';

    if (input === 'R') {
      refresh();
      return;
    }
    if (key.tab || input === 'h' || key.leftArrow) {
      setPane('sources');
      return;
    }
    if (input === 'l' || key.rightArrow || key.return) {
      if (items.length > 0) setPane('items');
      return;
    }

    if (pane === 'sources') {
      if (down) {
        setSourceCursor((c) => Math.min(sources.length - 1, c + 1));
        setItemCursor(0);
      } else if (up) {
        setSourceCursor((c) => Math.max(0, c - 1));
        setItemCursor(0);
      }
      return;
    }

    if (down) {
      setItemCursor((c) => Math.min(items.length - 1, c + 1));
    } else if (up) {
      setItemCursor((c) => Math.max(0, c - 1));
    }
  });

  if (loading && sources.length === 0) {
    return (
      <Box>
        <Text color={THEME.success}>
          <Spinner type="dots" />
        </Text>
        <Text color={THEME.muted}> Loading registry sources...</Text>
      </Box>
    );
  }

  if (error && sources.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={THEME.error}>
          {SYMBOLS.cross} {error}
        </Text>
        <Text color={THEME.muted}>Press R to retry.</Text>
      </Box>
    );
  }

  const sourceWindow = windowFor(sources, sourceCursor);
  const itemWindow = windowFor(items, itemCursor);

  return (
    <Box flexDirection="column">
      <Box>
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={pane === 'sources' ? THEME.highlight : THEME.muted}
          paddingX={1}
          width={40}
        >
          <Text bold color={THEME.secondary}>
            Sources ({sources.length})
          </Text>
          {sources.length === 0 ? (
            <Text color={THEME.muted}>No registry sources configured.</Text>
          ) : (
            sourceWindow.slice.map((source, index) => {
              const absolute = sourceWindow.start + index;
              const active = absolute === sourceCursor;
              const entryHealth = data.health.find((entry) => entry.sourceId === source.id);
              return (
                <Text key={source.id} color={active ? THEME.highlight : undefined}>
                  {active ? SYMBOLS.arrow : ' '} {source.enabled ? SYMBOLS.check : SYMBOLS.circle}{' '}
                  {source.name}{' '}
                  <Text color={statusColor(entryHealth?.status ?? 'unknown')}>
                    {entryHealth?.status ?? 'unchecked'}
                  </Text>
                </Text>
              );
            })
          )}
        </Box>

        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={pane === 'items' ? THEME.highlight : THEME.muted}
          paddingX={1}
          flexGrow={1}
        >
          <Text bold color={THEME.secondary}>
            Entries ({items.length})
          </Text>
          {items.length === 0 ? (
            <Text color={THEME.muted}>No entries listed for this source.</Text>
          ) : (
            itemWindow.slice.map((item, index) => {
              const absolute = itemWindow.start + index;
              const active = pane === 'items' && absolute === itemCursor;
              return (
                <Text key={item.id} color={active ? THEME.highlight : undefined}>
                  {active ? SYMBOLS.arrow : ' '} {item.name}{' '}
                  <Text color={THEME.muted}>{item.type}</Text>
                </Text>
              );
            })
          )}
        </Box>
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
        <Text bold color={THEME.secondary}>
          Details
        </Text>
        {selectedSource ? (
          <>
            <Text>
              {pane === 'items' && selectedItem ? selectedItem.name : selectedSource.name}{' '}
              <Text color={THEME.muted}>
                ({pane === 'items' && selectedItem ? selectedItem.type : selectedSource.type})
              </Text>
            </Text>
            <Text color={THEME.muted}>
              id: {pane === 'items' && selectedItem ? selectedItem.id : selectedSource.id}
            </Text>
            <Text color={THEME.muted}>
              url: {selectedSource.registryJsonUrl || selectedSource.baseUrl || 'local'}
            </Text>
            <Text>
              enabled:{' '}
              <Text color={selectedSource.enabled ? THEME.success : THEME.muted}>
                {selectedSource.enabled ? 'yes' : 'no'}
              </Text>{' '}
              | health:{' '}
              <Text color={statusColor(health?.status ?? 'unknown')}>
                {health?.status ?? 'unchecked'}
              </Text>{' '}
              | entries: <Text color={THEME.secondary}>{items.length}</Text>
            </Text>
            <Text color={THEME.muted}>updated: {selectedSource.updatedAt}</Text>
            {(health?.issues ?? []).slice(0, 3).map((issue) => (
              <Text key={`${issue.code}:${issue.message}`} color={THEME.accent}>
                {SYMBOLS.circle} {issue.code}: {issue.message}
              </Text>
            ))}
            {warnings.slice(0, 2).map((warning) => (
              <Text key={warning.message} color={THEME.accent}>
                {SYMBOLS.circle} {warning.message}
              </Text>
            ))}
          </>
        ) : (
          <Text color={THEME.muted}>Add a registry source to browse entries.</Text>
        )}
      </Box>

      <Text color={THEME.muted}>
        <Text color={THEME.secondary}>j/k</Text> move · <Text color={THEME.secondary}>l/enter</Text>{' '}
        entries · <Text color={THEME.secondary}>h/tab</Text> sources ·{' '}
        <Text color={THEME.secondary}>R</Text> reload registries
      </Text>
    </Box>
  );
}
