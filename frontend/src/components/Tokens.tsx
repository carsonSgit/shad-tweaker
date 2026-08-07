import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import { applyTokenPatch, getTokenSets, previewTokenPatch, updateTokenSet } from '../api/client.js';
import type {
  DesignToken,
  DesignTokenSet,
  StudioSummary,
  TokenCategory,
  TokenPatchChange,
} from '../types/index.js';
import { type DiffFileChange, DiffPreview, type DiffValueChange } from './DiffPreview.js';

/**
 * Token selector workbench area.
 *
 * Lets the operator pick the active token set, walk its categories/tokens, and
 * stage new values. Every staged edit is turned into a `TokenPatchChange` and
 * rendered through the shared DiffPreview pane (values + real file previews
 * fetched from `POST /api/tokens/patch/preview`). Applying delegates to the
 * existing token services: `applyTokenPatch` for component files and
 * `updateTokenSet` for the token set itself.
 */

type Focus = 'sets' | 'categories' | 'tokens';

interface PendingEdit {
  category: TokenCategory;
  tokenName: string;
  from: string;
  to: string;
}

const VISIBLE_ROWS = 8;

function editKey(category: TokenCategory, tokenName: string): string {
  return `${category}.${tokenName}`;
}

function usedCategories(tokenSet: DesignTokenSet | undefined): TokenCategory[] {
  if (!tokenSet) return [];
  return (Object.keys(tokenSet.tokens) as TokenCategory[]).filter(
    (category) => Object.keys(tokenSet.tokens[category] ?? {}).length > 0
  );
}

function tokensOf(
  tokenSet: DesignTokenSet | undefined,
  category: TokenCategory | undefined
): DesignToken[] {
  if (!tokenSet || !category) return [];
  return Object.values(tokenSet.tokens[category] ?? {}).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

function withEdits(tokenSet: DesignTokenSet, edits: PendingEdit[]): DesignTokenSet['tokens'] {
  const next = structuredClone(tokenSet.tokens);
  const stamp = new Date().toISOString();
  for (const edit of edits) {
    const bucket = next[edit.category];
    const token = bucket?.[edit.tokenName];
    if (!bucket || !token) continue;
    bucket[edit.tokenName] = { ...token, value: edit.to, updatedAt: stamp };
  }
  return next;
}

function windowStart(cursor: number, length: number): number {
  return Math.max(0, Math.min(cursor - Math.floor(VISIBLE_ROWS / 2), length - VISIBLE_ROWS));
}

export function Tokens({ summary }: { summary: StudioSummary | null }) {
  const [tokenSets, setTokenSets] = useState<DesignTokenSet[]>(summary?.tokens.tokenSets ?? []);
  const [setIdx, setSetIdx] = useState(0);
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [tokenIdx, setTokenIdx] = useState(0);
  const [focus, setFocus] = useState<Focus>('sets');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [edits, setEdits] = useState<PendingEdit[]>([]);
  const [files, setFiles] = useState<DiffFileChange[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const componentPaths = useMemo(
    () => (summary?.components.inventory ?? []).map((item) => item.path),
    [summary]
  );

  const activeSet = tokenSets[Math.min(setIdx, Math.max(tokenSets.length - 1, 0))];
  const categories = useMemo(() => usedCategories(activeSet), [activeSet]);
  const activeCategory = categories[Math.min(categoryIdx, Math.max(categories.length - 1, 0))];
  const tokens = useMemo(() => tokensOf(activeSet, activeCategory), [activeSet, activeCategory]);
  const activeToken = tokens[Math.min(tokenIdx, Math.max(tokens.length - 1, 0))];

  const changes = useMemo<TokenPatchChange[]>(
    () =>
      edits.map((edit) => ({
        category: edit.category,
        from: edit.from,
        to: edit.to,
        tokenName: edit.tokenName,
      })),
    [edits]
  );

  const values = useMemo<DiffValueChange[]>(
    () =>
      edits.map((edit) => ({
        key: editKey(edit.category, edit.tokenName),
        current: edit.from,
        proposed: edit.to,
      })),
    [edits]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadSets() {
      const response = await getTokenSets();
      if (cancelled) return;
      if (response.success && response.data) {
        setTokenSets(response.data.tokenSets);
      } else if (response.error) {
        setError(response.error.message);
      }
    }
    void loadSets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (changes.length === 0 || componentPaths.length === 0) {
      setFiles([]);
      return;
    }
    async function loadPreview() {
      const response = await previewTokenPatch({ componentPaths, changes });
      if (cancelled) return;
      if (response.success && response.data) {
        setFiles(
          response.data.previews.map((preview) => ({
            path: preview.path,
            before: preview.before,
            after: preview.after,
            changes: preview.changes,
          }))
        );
      } else {
        setFiles([]);
      }
    }
    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [changes, componentPaths]);

  const stageEdit = useCallback(
    (value: string) => {
      if (!activeToken || !activeCategory) return;
      const next = value.trim();
      setEdits((current) => {
        const rest = current.filter(
          (edit) => !(edit.category === activeCategory && edit.tokenName === activeToken.name)
        );
        if (next.length === 0 || next === activeToken.value) return rest;
        return [
          ...rest,
          {
            category: activeCategory,
            tokenName: activeToken.name,
            from: activeToken.value,
            to: next,
          },
        ];
      });
    },
    [activeCategory, activeToken]
  );

  const apply = useCallback(async () => {
    if (!activeSet || edits.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);

    // Patch the component files before persisting the token set. Both calls are
    // idempotent, so the ordering only matters for what a mid-way failure leaves
    // behind: patch-first means a failed patch persists nothing, whereas
    // set-first would leave the token set claiming values the files never got.
    let applied = 0;
    if (componentPaths.length > 0) {
      const response = await applyTokenPatch({
        tokenSetId: activeSet.id,
        componentPaths,
        changes,
        createBackup: true,
        recordOverrides: false,
      });
      if (!response.success) {
        setError(response.error?.message ?? 'Failed to apply token patch');
        setBusy(false);
        return;
      }
      applied = response.data?.result.changes ?? 0;
    }

    const patched = withEdits(activeSet, edits);
    const updated = await updateTokenSet(activeSet.id, {
      name: activeSet.name,
      description: activeSet.description,
      tokens: patched,
    });
    if (!updated.success) {
      setError(
        `${updated.error?.message ?? 'Failed to update token set'} - ${applied} file change(s) were already written; a backup was created. Re-run to retry.`
      );
      setBusy(false);
      return;
    }

    setTokenSets((current) =>
      current.map((entry) =>
        entry.id === activeSet.id ? (updated.data?.tokenSet ?? entry) : entry
      )
    );
    setEdits([]);
    setFiles([]);
    setStatus(`Applied ${edits.length} token edits (${applied} file changes).`);
    setBusy(false);
  }, [activeSet, busy, changes, componentPaths, edits]);

  useInput(
    (input, key) => {
      if (editing) {
        if (key.escape) {
          setEditing(false);
          setDraft('');
        }
        return;
      }

      if (key.tab) {
        setFocus((current) =>
          current === 'sets' ? 'categories' : current === 'categories' ? 'tokens' : 'sets'
        );
        return;
      }
      if (key.leftArrow) {
        setFocus((current) => (current === 'tokens' ? 'categories' : 'sets'));
        return;
      }
      if (key.rightArrow) {
        setFocus((current) => (current === 'sets' ? 'categories' : 'tokens'));
        return;
      }

      const step = key.upArrow ? -1 : key.downArrow ? 1 : 0;
      if (step !== 0) {
        if (focus === 'sets') {
          setSetIdx((i) => Math.max(0, Math.min(tokenSets.length - 1, i + step)));
          setCategoryIdx(0);
          setTokenIdx(0);
        } else if (focus === 'categories') {
          setCategoryIdx((i) => Math.max(0, Math.min(categories.length - 1, i + step)));
          setTokenIdx(0);
        } else {
          setTokenIdx((i) => Math.max(0, Math.min(tokens.length - 1, i + step)));
        }
        return;
      }

      if (key.return || input === 'e') {
        if (focus === 'tokens' && activeToken) {
          setDraft(activeToken.value);
          setEditing(true);
        } else {
          setFocus(focus === 'sets' ? 'categories' : 'tokens');
        }
        return;
      }
      if (input === 'x' && focus === 'tokens' && activeToken && activeCategory) {
        setEdits((current) =>
          current.filter(
            (edit) => !(edit.category === activeCategory && edit.tokenName === activeToken.name)
          )
        );
        return;
      }
      if (input === 'c') {
        setEdits([]);
        setFiles([]);
        setStatus(null);
        return;
      }
      if (input === 'y') {
        void apply();
      }
    },
    { isActive: true }
  );

  if (tokenSets.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
        <Text color={THEME.muted}>
          {SYMBOLS.circle} No token sets yet. Create one from the CLI or web studio.
        </Text>
        {error && <Text color={THEME.error}>{error}</Text>}
      </Box>
    );
  }

  const setStart = windowStart(setIdx, tokenSets.length);
  const categoryStart = windowStart(categoryIdx, categories.length);
  const tokenStart = windowStart(tokenIdx, tokens.length);

  return (
    <Box flexDirection="column">
      <Box>
        <Column title="Token sets" active={focus === 'sets'}>
          {tokenSets.slice(setStart, setStart + VISIBLE_ROWS).map((entry, idx) => (
            <Row
              key={entry.id}
              label={entry.name}
              selected={setStart + idx === setIdx}
              active={focus === 'sets'}
            />
          ))}
        </Column>

        <Column title="Categories" active={focus === 'categories'}>
          {categories.length === 0 && <Text color={THEME.muted}>no categories</Text>}
          {categories.slice(categoryStart, categoryStart + VISIBLE_ROWS).map((category, idx) => (
            <Row
              key={category}
              label={`${category} (${Object.keys(activeSet?.tokens[category] ?? {}).length})`}
              selected={categoryStart + idx === categoryIdx}
              active={focus === 'categories'}
            />
          ))}
        </Column>

        <Column title="Tokens" active={focus === 'tokens'}>
          {tokens.length === 0 && <Text color={THEME.muted}>no tokens</Text>}
          {tokens.slice(tokenStart, tokenStart + VISIBLE_ROWS).map((token, idx) => {
            const pending = edits.find(
              (edit) => edit.category === activeCategory && edit.tokenName === token.name
            );
            return (
              <Row
                key={token.name}
                label={`${token.name} ${SYMBOLS.line} ${pending ? pending.to : token.value}`}
                selected={tokenStart + idx === tokenIdx}
                active={focus === 'tokens'}
                marker={pending ? SYMBOLS.dot : undefined}
              />
            );
          })}
        </Column>
      </Box>

      {editing && activeToken && activeCategory && (
        <Box marginTop={1} borderStyle="round" borderColor={THEME.accent} paddingX={1}>
          <Text color={THEME.accent}>{editKey(activeCategory, activeToken.name)} = </Text>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={(value) => {
              stageEdit(value);
              setEditing(false);
              setDraft('');
            }}
          />
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <DiffPreview
          title={activeSet ? `Token set: ${activeSet.name}` : 'Token set'}
          values={values}
          files={files}
          interactive={false}
          emptyMessage="No staged token edits. Press Enter on a token to change its value."
          visibleLines={10}
        />
      </Box>

      {busy && (
        <Box marginTop={1}>
          <Text color={THEME.secondary}>
            <Spinner type="dots" />
          </Text>
          <Text color={THEME.muted}> Applying token changes...</Text>
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
        <Text color={THEME.muted}>
          <Text color={THEME.secondary}>↑/↓</Text> Move │{' '}
          <Text color={THEME.secondary}>←/→/Tab</Text> Pane │{' '}
          <Text color={THEME.secondary}>Enter/e</Text> Edit │ <Text color={THEME.secondary}>x</Text>{' '}
          Unstage │ <Text color={THEME.secondary}>c</Text> Clear │{' '}
          <Text color={THEME.secondary}>y</Text> Apply
        </Text>
      </Box>
    </Box>
  );
}

function Column({
  title,
  active,
  children,
}: {
  title: string;
  active: boolean;
  children: React.ReactNode;
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
      {marker ? <Text color={THEME.accent}>{marker} </Text> : ' '}
      {label}
    </Text>
  );
}
