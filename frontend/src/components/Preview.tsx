import * as Diff from 'diff';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import * as api from '../api/client.js';
import type { Preview } from '../types/index.js';

interface PreviewViewProps {
  componentPaths: string[];
  find: string;
  replace: string;
  isRegex: boolean;
  onApply: (message: string) => void;
  onCancel: () => void;
}

export function PreviewView({
  componentPaths,
  find,
  replace,
  isRegex,
  onApply,
  onCancel,
}: PreviewViewProps) {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    const fetchPreview = async () => {
      setLoading(true);
      setError(null);

      const result = await api.previewEdit(componentPaths, find, replace, isRegex);

      if (result.success && result.data) {
        setPreviews(result.data.previews);
      } else {
        setError(result.error?.message || 'Failed to generate preview');
      }

      setLoading(false);
    };

    fetchPreview();
  }, [componentPaths, find, replace, isRegex]);

  useInput((input, key) => {
    if (applying) return;

    if (key.escape || input === 'q') {
      onCancel();
      return;
    }

    if (key.leftArrow) {
      setCurrentIdx((i) => Math.max(0, i - 1));
      setScrollOffset(0);
    } else if (key.rightArrow) {
      setCurrentIdx((i) => Math.min(previews.length - 1, i + 1));
      setScrollOffset(0);
    } else if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow) {
      setScrollOffset((o) => o + 1);
    } else if (input === 'y' || key.return) {
      handleApply();
    }
  });

  const handleApply = async () => {
    setApplying(true);
    const result = await api.applyEdit(componentPaths, find, replace, isRegex);

    if (result.success && result.data) {
      onApply(
        `Applied changes to ${result.data.modified.length} files. Backup: ${result.data.backup}`
      );
    } else {
      setError(result.error?.message || 'Failed to apply changes');
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={THEME.secondary} paddingX={2} paddingY={1}>
          <Text color={THEME.success}>
            <Spinner type="dots" />
          </Text>
          <Text> Generating preview...</Text>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={THEME.error} paddingX={2} paddingY={1}>
          <Text color={THEME.error}>
            {SYMBOLS.cross} Error: {error}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={THEME.muted}>Press </Text>
          <Text color={THEME.secondary}>q/Esc</Text>
          <Text color={THEME.muted}> to go back</Text>
        </Box>
      </Box>
    );
  }

  if (previews.length === 0) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={THEME.accent} paddingX={2} paddingY={1}>
          <Text color={THEME.accent}>{SYMBOLS.diamond} No changes found matching pattern</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={THEME.muted}>Pattern: </Text>
          <Text color={THEME.secondary}>"{find}"</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={THEME.muted}>Press </Text>
          <Text color={THEME.secondary}>q/Esc</Text>
          <Text color={THEME.muted}> to go back</Text>
        </Box>
      </Box>
    );
  }

  const preview = previews[currentIdx];
  const totalChanges = previews.reduce((sum, p) => sum + p.changes, 0);

  // Parse diff for display
  const diffLines = Diff.createPatch(
    preview.path,
    preview.before,
    preview.after,
    'Original',
    'Modified'
  ).split('\n');

  const visibleLines = 12;
  const displayLines = diffLines.slice(scrollOffset, scrollOffset + visibleLines);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={THEME.highlight}>
          {SYMBOLS.diamond} Preview Changes
        </Text>
      </Box>

      {/* Stats Bar */}
      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          <Text color={THEME.secondary}>{currentIdx + 1}</Text>
          <Text color={THEME.muted}>/{previews.length} files</Text>
        </Box>
        <Box>
          <Text color={THEME.success}>+{totalChanges}</Text>
          <Text color={THEME.muted}> total changes</Text>
        </Box>
      </Box>

      {/* File Name */}
      <Box marginBottom={1}>
        <Text color={THEME.accent}>
          {SYMBOLS.arrow} {preview.path.split(/[/\\]/).pop()}
        </Text>
        <Text color={THEME.muted}> ({preview.changes} changes)</Text>
      </Box>

      {applying ? (
        <Box borderStyle="round" borderColor={THEME.success} paddingX={2} paddingY={1}>
          <Text color={THEME.success}>
            <Spinner type="dots" />
          </Text>
          <Text> Applying changes and creating backup...</Text>
        </Box>
      ) : (
        <>
          {/* Diff View */}
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

            {displayLines.map((line, idx) => {
              let color: string | undefined;
              let _prefix = ' ';

              if (line.startsWith('+') && !line.startsWith('+++')) {
                color = THEME.success;
                _prefix = '+';
              } else if (line.startsWith('-') && !line.startsWith('---')) {
                color = THEME.error;
                _prefix = '-';
              } else if (line.startsWith('@@')) {
                color = THEME.secondary;
                _prefix = '@';
              }

              const displayText = line.slice(0, 70);
              const isTruncated = line.length > 70;

              return (
                <Text key={idx} color={color}>
                  {displayText}
                  {isTruncated && <Text color={THEME.muted}>...</Text>}
                </Text>
              );
            })}

            {scrollOffset + visibleLines < diffLines.length && (
              <Box justifyContent="center">
                <Text color={THEME.muted}>↓ scroll down for more</Text>
              </Box>
            )}
          </Box>

          {/* Legend */}
          <Box marginTop={1} justifyContent="center">
            <Text color={THEME.success}>{SYMBOLS.box} additions</Text>
            <Text color={THEME.muted}> │ </Text>
            <Text color={THEME.error}>{SYMBOLS.box} deletions</Text>
          </Box>

          {/* Apply Button */}
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
            <Text color={THEME.success}> to apply changes</Text>
          </Box>

          {/* Controls */}
          <Box marginTop={1} justifyContent="center">
            <Text color={THEME.muted}>
              <Text color={THEME.secondary}>←/→</Text> Switch file │{' '}
              <Text color={THEME.secondary}>↑/↓</Text> Scroll │{' '}
              <Text color={THEME.secondary}>q/Esc</Text> Cancel
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
