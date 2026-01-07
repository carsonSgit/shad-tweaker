import * as Diff from 'diff';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useEffect, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import type { BackupFilePreview } from '../api/client.js';
import * as api from '../api/client.js';
import type { Backup } from '../types/index.js';

interface BackupBrowserProps {
  onRestore: (message: string) => void;
  onBack: () => void;
}

type Mode = 'list' | 'preview';

export function BackupBrowser({ onRestore, onBack }: BackupBrowserProps) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<Mode>('list');

  // Preview state
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<BackupFilePreview[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const fetchBackups = async () => {
    setLoading(true);
    const result = await api.listBackups();
    if (result.success && result.data) {
      setBackups(result.data.backups);
    } else {
      setError(result.error?.message || 'Failed to load backups');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const fetchPreview = async (backupId: string) => {
    setLoadingPreview(true);
    setError(null);
    setSelectedBackupId(backupId);

    const result = await api.previewBackup(backupId);
    if (result.success && result.data) {
      setPreviews(result.data.previews);
      setPreviewIdx(0);
      setScrollOffset(0);
      setMode('preview');
    } else {
      setError(result.error?.message || 'Failed to load preview');
    }
    setLoadingPreview(false);
  };

  const handleRestore = async (backupId: string) => {
    setRestoring(true);
    const result = await api.restoreBackup(backupId);
    setRestoring(false);

    if (result.success) {
      onRestore(`Restored from backup ${backupId}`);
    } else {
      setError(result.error?.message || 'Failed to restore backup');
    }
  };

  const handleCreateBackup = async () => {
    setLoading(true);
    const result = await api.createBackup();
    if (result.success && result.data) {
      fetchBackups();
    } else {
      setError(result.error?.message || 'Failed to create backup');
      setLoading(false);
    }
  };

  useInput((input, key) => {
    if (restoring || loadingPreview) return;

    if (mode === 'preview') {
      if (key.escape || input === 'q') {
        setMode('list');
        setPreviews([]);
        setSelectedBackupId(null);
      } else if (key.leftArrow) {
        setPreviewIdx((i) => Math.max(0, i - 1));
        setScrollOffset(0);
      } else if (key.rightArrow) {
        setPreviewIdx((i) => Math.min(previews.length - 1, i + 1));
        setScrollOffset(0);
      } else if (key.upArrow) {
        setScrollOffset((o) => Math.max(0, o - 1));
      } else if (key.downArrow) {
        setScrollOffset((o) => o + 1);
      } else if (input === 'y' || key.return) {
        if (selectedBackupId) {
          handleRestore(selectedBackupId);
        }
      }
      return;
    }

    // List mode
    if (key.escape || input === 'q') {
      onBack();
    } else if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(backups.length - 1, c + 1));
    } else if (key.return) {
      if (backups[cursor]) {
        fetchPreview(backups[cursor].id);
      }
    } else if (input === 'c') {
      handleCreateBackup();
    }
  });

  if (loading) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={THEME.secondary} paddingX={2} paddingY={1}>
          <Text color={THEME.success}>
            <Spinner type="dots" />
          </Text>
          <Text> Loading backups...</Text>
        </Box>
      </Box>
    );
  }

  if (loadingPreview) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={THEME.secondary} paddingX={2} paddingY={1}>
          <Text color={THEME.success}>
            <Spinner type="dots" />
          </Text>
          <Text> Loading backup preview...</Text>
        </Box>
      </Box>
    );
  }

  if (restoring) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={THEME.success} paddingX={2} paddingY={1}>
          <Text color={THEME.success}>
            <Spinner type="dots" />
          </Text>
          <Text> Restoring backup...</Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'preview') {
    if (previews.length === 0) {
      return (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color={THEME.highlight}>
              💾 Restore Backup
            </Text>
          </Box>
          <Box marginBottom={1}>
            <Text color={THEME.secondary}>{selectedBackupId}</Text>
          </Box>
          <Box borderStyle="round" borderColor={THEME.accent} paddingX={2} paddingY={1}>
            <Text color={THEME.accent}>
              {SYMBOLS.diamond} No changes to restore - files are identical
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

    const preview = previews[previewIdx];

    // Use line-level diff to show changes clearly
    const lineDiff = Diff.diffLines(preview.currentContent, preview.backupContent);

    // Build a list of changed line groups for display
    const changedGroups: Array<{ removed: string[]; added: string[]; lineNum: number }> = [];
    let lineNum = 1;
    let currentGroup: { removed: string[]; added: string[]; lineNum: number } | null = null;

    for (const part of lineDiff) {
      if (part.added || part.removed) {
        if (!currentGroup) {
          currentGroup = { removed: [], added: [], lineNum };
        }
        const lines = part.value.split('\n').filter((l) => l.length > 0);
        if (part.removed) {
          currentGroup.removed.push(...lines);
        }
        if (part.added) {
          currentGroup.added.push(...lines);
        }
      } else {
        if (currentGroup) {
          changedGroups.push(currentGroup);
          currentGroup = null;
        }
        lineNum += part.value.split('\n').length - 1;
      }
    }
    if (currentGroup) {
      changedGroups.push(currentGroup);
    }

    const visibleGroups = 3;
    const displayGroups = changedGroups.slice(scrollOffset, scrollOffset + visibleGroups);

    return (
      <Box flexDirection="column">
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color={THEME.highlight}>
            {SYMBOLS.diamond} Restore Backup
          </Text>
        </Box>

        {/* Backup ID */}
        <Box marginBottom={1}>
          <Text color={THEME.secondary}>{selectedBackupId}</Text>
        </Box>

        {/* Stats */}
        <Box marginBottom={1} justifyContent="space-between">
          <Box>
            <Text color={THEME.secondary}>{previewIdx + 1}</Text>
            <Text color={THEME.muted}>/{previews.length} files with changes</Text>
          </Box>
        </Box>

        {/* File Name */}
        <Box marginBottom={1}>
          <Text color={THEME.accent}>
            {SYMBOLS.arrow} {preview.fileName}
          </Text>
          <Text color={THEME.muted}> ({changedGroups.length} change locations)</Text>
        </Box>

        {error && (
          <Box marginBottom={1} borderStyle="round" borderColor={THEME.error} paddingX={2}>
            <Text color={THEME.error}>
              {SYMBOLS.cross} {error}
            </Text>
          </Box>
        )}

        {/* Diff View */}
        <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
          {scrollOffset > 0 && (
            <Box justifyContent="center">
              <Text color={THEME.muted}>↑ {scrollOffset} more above</Text>
            </Box>
          )}

          {displayGroups.length === 0 ? (
            <Text color={THEME.accent}>No visible changes in this file</Text>
          ) : (
            displayGroups.map((group, idx) => (
              <Box key={idx} flexDirection="column" marginBottom={1}>
                <Text color={THEME.muted}>Line {group.lineNum}:</Text>
                {group.removed.map((line, i) => (
                  <Box key={`r${i}`}>
                    <Text color={THEME.error}>- </Text>
                    <Text color={THEME.error}>{line.trim().slice(0, 60)}</Text>
                    {line.trim().length > 60 && <Text color={THEME.muted}>...</Text>}
                  </Box>
                ))}
                {group.added.map((line, i) => (
                  <Box key={`a${i}`}>
                    <Text color={THEME.success}>+ </Text>
                    <Text color={THEME.success}>{line.trim().slice(0, 60)}</Text>
                    {line.trim().length > 60 && <Text color={THEME.muted}>...</Text>}
                  </Box>
                ))}
              </Box>
            ))
          )}

          {scrollOffset + visibleGroups < changedGroups.length && (
            <Box justifyContent="center">
              <Text color={THEME.muted}>
                ↓ {changedGroups.length - scrollOffset - visibleGroups} more below
              </Text>
            </Box>
          )}
        </Box>

        {/* Legend */}
        <Box marginTop={1} justifyContent="center">
          <Text color={THEME.error}>{SYMBOLS.box} current (will be replaced)</Text>
          <Text color={THEME.muted}> │ </Text>
          <Text color={THEME.success}>{SYMBOLS.box} backup (will be restored)</Text>
        </Box>

        {/* Restore Button */}
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
          <Text color={THEME.success}> to restore</Text>
        </Box>

        {/* Controls */}
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

  // List mode
  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color={THEME.highlight}>
          {SYMBOLS.diamond} Backup Browser
        </Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="round" borderColor={THEME.error} paddingX={2}>
          <Text color={THEME.error}>
            {SYMBOLS.cross} {error}
          </Text>
        </Box>
      )}

      {backups.length === 0 ? (
        <Box borderStyle="round" borderColor={THEME.muted} paddingX={2} paddingY={1}>
          <Text color={THEME.muted}>{SYMBOLS.diamond} No backups found</Text>
        </Box>
      ) : (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={THEME.muted}
          paddingX={1}
          marginBottom={1}
        >
          {backups.map((backup, idx) => {
            const isCurrent = idx === cursor;
            const date = new Date(backup.timestamp);
            const dateStr = date.toLocaleDateString();
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return (
              <Box key={backup.id} flexDirection="column">
                <Box>
                  <Box width={3}>
                    <Text color={isCurrent ? THEME.primary : THEME.muted}>
                      {isCurrent ? SYMBOLS.arrow : ' '}
                    </Text>
                  </Box>
                  <Text color={isCurrent ? THEME.secondary : THEME.highlight} bold={isCurrent}>
                    {backup.id}
                  </Text>
                </Box>
                <Box marginLeft={3}>
                  <Text color={THEME.muted}>
                    {dateStr} {timeStr} {SYMBOLS.line}{' '}
                    {typeof backup.components === 'number'
                      ? backup.components
                      : backup.components?.length || 0}{' '}
                    files
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Create Backup Button */}
      <Box
        borderStyle="round"
        borderColor={THEME.accent}
        paddingX={2}
        justifyContent="center"
        marginBottom={1}
      >
        <Text color={THEME.accent}>Press </Text>
        <Text bold color={THEME.accent}>
          c
        </Text>
        <Text color={THEME.accent}> to create a new backup</Text>
      </Box>

      {/* Controls */}
      <Box justifyContent="center">
        <Text color={THEME.muted}>
          <Text color={THEME.secondary}>↑/↓</Text> Navigate │ <Text color={THEME.secondary}>↵</Text>{' '}
          Preview & Restore │ <Text color={THEME.secondary}>q/Esc</Text> Back
        </Text>
      </Box>
    </Box>
  );
}
