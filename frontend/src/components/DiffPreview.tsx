import * as Diff from 'diff';
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';

/**
 * Shared before/after diff preview pane.
 *
 * Any flow with pending tweaks (import, preset, variant, export, edit) can render
 * this component to show current vs proposed state before applying changes.
 */

/** A pending file-level tweak: full current content vs proposed content. */
export interface DiffFileChange {
  /** File path (or any label identifying the target). */
  path: string;
  /** Current content. */
  before: string;
  /** Proposed content. */
  after: string;
  /** Optional pre-computed change count. */
  changes?: number;
}

/** A pending key/value tweak (token value, variant class, config field). */
export interface DiffValueChange {
  /** Human readable key, e.g. `colors.primary` or `button:default`. */
  key: string;
  /** Current value, or null when the key is being added. */
  current: string | null;
  /** Proposed value, or null when the key is being removed. */
  proposed: string | null;
}

export interface DiffPreviewProps {
  /** Pane title, usually the owning flow, e.g. "Preset: Neo Brutalist". */
  title?: string;
  /** Pending file content tweaks. */
  files?: DiffFileChange[];
  /** Pending token/class tweaks. */
  values?: DiffValueChange[];
  /** Rendered when there is nothing pending. */
  emptyMessage?: string;
  /** Number of diff lines visible at once. */
  visibleLines?: number;
  /** When false, the pane ignores keyboard input (owner handles it). */
  interactive?: boolean;
  /** Called on `y`/Enter when interactive. Omit to hide the apply hint. */
  onSubmit?: () => void;
  /** Called on `q`/Esc when interactive. */
  onCancel?: () => void;
  /** Label for the confirm action. */
  submitLabel?: string;
}

const MAX_LINE_WIDTH = 70;

function countChanges(change: DiffFileChange): number {
  if (typeof change.changes === 'number') return change.changes;
  return Diff.diffLines(change.before, change.after).filter((part) => part.added || part.removed)
    .length;
}

function diffLineColor(line: string): string | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) return THEME.success;
  if (line.startsWith('-') && !line.startsWith('---')) return THEME.error;
  if (line.startsWith('@@')) return THEME.secondary;
  return undefined;
}

export function DiffPreview({
  title,
  files = [],
  values = [],
  emptyMessage = 'No pending changes.',
  visibleLines = 12,
  interactive = true,
  onSubmit,
  onCancel,
  submitLabel = 'apply changes',
}: DiffPreviewProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const fileIdx = files.length > 0 ? Math.min(currentIdx, files.length - 1) : 0;

  const file = files[fileIdx];
  const diffLines = file
    ? Diff.createPatch(file.path, file.before, file.after, 'Current', 'Proposed').split('\n')
    : [];
  const maxScroll = Math.max(0, diffLines.length - visibleLines);

  useInput(
    (input, key) => {
      if (key.escape || input === 'q') {
        onCancel?.();
        return;
      }
      if (key.leftArrow) {
        setCurrentIdx((i) => Math.max(0, i - 1));
        setScrollOffset(0);
      } else if (key.rightArrow) {
        setCurrentIdx((i) => Math.min(Math.max(files.length - 1, 0), i + 1));
        setScrollOffset(0);
      } else if (key.upArrow) {
        setScrollOffset((o) => Math.max(0, o - 1));
      } else if (key.downArrow) {
        setScrollOffset((o) => Math.min(maxScroll, o + 1));
      } else if (input === 'y' || key.return) {
        onSubmit?.();
      }
    },
    { isActive: interactive }
  );

  if (files.length === 0 && values.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
        {title && <Text color={THEME.accent}>{title}</Text>}
        <Text color={THEME.muted}>
          {SYMBOLS.circle} {emptyMessage}
        </Text>
      </Box>
    );
  }

  const totalChanges = files.reduce((sum, entry) => sum + countChanges(entry), 0) + values.length;

  const displayLines = diffLines.slice(scrollOffset, scrollOffset + visibleLines);

  return (
    <Box flexDirection="column">
      {title && (
        <Box marginBottom={1}>
          <Text bold color={THEME.highlight}>
            {SYMBOLS.diamond} {title}
          </Text>
        </Box>
      )}

      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          {files.length > 0 ? (
            <>
              <Text color={THEME.secondary}>{fileIdx + 1}</Text>
              <Text color={THEME.muted}>/{files.length} files</Text>
            </>
          ) : (
            <Text color={THEME.muted}>{values.length} values</Text>
          )}
        </Box>
        <Box>
          <Text color={THEME.success}>+{totalChanges}</Text>
          <Text color={THEME.muted}> pending changes</Text>
        </Box>
      </Box>

      {values.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={THEME.muted}
          paddingX={1}
          marginBottom={1}
        >
          {values.map((value) => (
            <Text key={value.key}>
              <Text color={THEME.accent}>{value.key}</Text>
              <Text color={THEME.muted}>: </Text>
              <Text color={THEME.error}>{value.current ?? '(none)'}</Text>
              <Text color={THEME.muted}> {SYMBOLS.arrow} </Text>
              <Text color={THEME.success}>{value.proposed ?? '(removed)'}</Text>
            </Text>
          ))}
        </Box>
      )}

      {file && (
        <>
          <Box marginBottom={1}>
            <Text color={THEME.accent}>
              {SYMBOLS.arrow} {file.path.split(/[/\\]/).pop()}
            </Text>
            <Text color={THEME.muted}> ({countChanges(file)} changes)</Text>
          </Box>

          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor={THEME.muted}
            paddingX={1}
            height={visibleLines + 2}
          >
            {scrollOffset > 0 && (
              <Box justifyContent="center">
                <Text color={THEME.muted}>↑ scroll up for more</Text>
              </Box>
            )}

            {displayLines.map((line, idx) => (
              <Text key={`${fileIdx}-${scrollOffset + idx}`} color={diffLineColor(line)}>
                {line.slice(0, MAX_LINE_WIDTH)}
                {line.length > MAX_LINE_WIDTH && <Text color={THEME.muted}>...</Text>}
              </Text>
            ))}

            {scrollOffset + visibleLines < diffLines.length && (
              <Box justifyContent="center">
                <Text color={THEME.muted}>↓ scroll down for more</Text>
              </Box>
            )}
          </Box>

          <Box marginTop={1} justifyContent="center">
            <Text color={THEME.success}>{SYMBOLS.box} additions</Text>
            <Text color={THEME.muted}> │ </Text>
            <Text color={THEME.error}>{SYMBOLS.box} deletions</Text>
          </Box>
        </>
      )}

      {onSubmit && (
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor={THEME.success}
          paddingX={2}
          justifyContent="center"
        >
          <Text color={THEME.success}>Press </Text>
          <Text bold color={THEME.success}>
            y
          </Text>
          <Text color={THEME.success}> or </Text>
          <Text bold color={THEME.success}>
            Enter
          </Text>
          <Text color={THEME.success}> to {submitLabel}</Text>
        </Box>
      )}

      <Box marginTop={1} justifyContent="center">
        <Text color={THEME.muted}>
          <Text color={THEME.secondary}>←/→</Text> Switch file │{' '}
          <Text color={THEME.secondary}>↑/↓</Text> Scroll │{' '}
          <Text color={THEME.secondary}>q/Esc</Text> Cancel
        </Text>
      </Box>
    </Box>
  );
}
