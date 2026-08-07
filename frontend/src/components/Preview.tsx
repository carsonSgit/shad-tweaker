import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import * as api from '../api/client.js';
import type { Preview } from '../types/index.js';
import { DiffPreview } from './DiffPreview.js';

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

  // Cancel is owned by the DiffPreview pane below, which is unmounted while
  // `applying` — matching the pre-extraction behaviour of ignoring all input
  // once an apply is in flight (there is no way to abort it).

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

  return (
    <Box flexDirection="column">
      {applying ? (
        <Box borderStyle="round" borderColor={THEME.success} paddingX={2} paddingY={1}>
          <Text color={THEME.success}>
            <Spinner type="dots" />
          </Text>
          <Text> Applying changes and creating backup...</Text>
        </Box>
      ) : (
        <DiffPreview
          title="Preview Changes"
          files={previews.map((preview) => ({
            path: preview.path,
            before: preview.before,
            after: preview.after,
            changes: preview.changes,
          }))}
          onSubmit={handleApply}
          onCancel={onCancel}
        />
      )}
    </Box>
  );
}
