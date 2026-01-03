import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import * as Diff from 'diff';
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
      onApply(`Applied changes to ${result.data.modified.length} files. Backup: ${result.data.backup}`);
    } else {
      setError(result.error?.message || 'Failed to apply changes');
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> Generating preview...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Error: {error}</Text>
        <Box marginTop={1}>
          <Text color="gray">[q/Esc] Go back</Text>
        </Box>
      </Box>
    );
  }

  if (previews.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No changes found matching pattern "{find}"</Text>
        <Box marginTop={1}>
          <Text color="gray">[q/Esc] Go back</Text>
        </Box>
      </Box>
    );
  }

  const preview = previews[currentIdx];
  const diffLines = Diff.createPatch(
    preview.path,
    preview.before,
    preview.after,
    'Original',
    'Modified'
  ).split('\n');

  const visibleLines = 15;
  const displayLines = diffLines.slice(scrollOffset, scrollOffset + visibleLines);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Preview Changes</Text>
        <Text color="gray">
          {' '}({currentIdx + 1}/{previews.length} files | {preview.changes} changes)
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text color="cyan">{preview.path}</Text>
      </Box>

      {applying ? (
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> Applying changes...</Text>
        </Box>
      ) : (
        <>
          <Box
            flexDirection="column"
            borderStyle="single"
            paddingX={1}
            height={visibleLines + 2}
          >
            {scrollOffset > 0 && (
              <Text color="gray">↑ more above</Text>
            )}

            {displayLines.map((line, idx) => {
              let color: string | undefined;
              if (line.startsWith('+') && !line.startsWith('+++')) {
                color = 'green';
              } else if (line.startsWith('-') && !line.startsWith('---')) {
                color = 'red';
              } else if (line.startsWith('@@')) {
                color = 'cyan';
              }

              return (
                <Text key={idx} color={color}>
                  {line.slice(0, 80)}
                </Text>
              );
            })}

            {scrollOffset + visibleLines < diffLines.length && (
              <Text color="gray">↓ more below</Text>
            )}
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text color="green">+ additions </Text>
              <Text color="red">- deletions</Text>
            </Box>

            <Box marginTop={1}>
              <Text color="gray">
                [←/→] Switch file | [↑/↓] Scroll | [y/Enter] Apply | [q/Esc] Cancel
              </Text>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
