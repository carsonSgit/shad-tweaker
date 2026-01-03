import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import * as Diff from 'diff';
import * as api from '../api/client.js';
import type { Backup } from '../types/index.js';
import type { BackupFilePreview } from '../api/client.js';

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

  useEffect(() => {
    fetchBackups();
  }, []);

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
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> Loading backups...</Text>
      </Box>
    );
  }

  if (loadingPreview) {
    return (
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> Loading preview...</Text>
      </Box>
    );
  }

  if (restoring) {
    return (
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> Restoring backup...</Text>
      </Box>
    );
  }

  if (mode === 'preview') {
    if (previews.length === 0) {
      return (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Restore Backup: </Text>
            <Text bold color="cyan">{selectedBackupId}</Text>
          </Box>
          <Box marginY={1}>
            <Text color="yellow">No changes to restore - files are identical to backup.</Text>
          </Box>
          <Text color="gray">[q/Esc] Go back</Text>
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
        const lines = part.value.split('\n').filter(l => l.length > 0);
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
        <Box marginBottom={1}>
          <Text bold>Restore Backup: </Text>
          <Text bold color="cyan">{selectedBackupId}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="gray">
            {previewIdx + 1}/{previews.length} files with changes
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="cyan">{preview.fileName}</Text>
          <Text color="gray"> ({changedGroups.length} change locations)</Text>
        </Box>

        {error && (
          <Box marginBottom={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        <Box flexDirection="column" borderStyle="single" paddingX={1}>
          {scrollOffset > 0 && (
            <Text color="gray">↑ {scrollOffset} more above</Text>
          )}

          {displayGroups.length === 0 ? (
            <Text color="yellow">No visible changes in this file</Text>
          ) : (
            displayGroups.map((group, idx) => (
              <Box key={idx} flexDirection="column" marginBottom={1}>
                <Text color="gray">Line {group.lineNum}:</Text>
                {group.removed.map((line, i) => (
                  <Box key={`r${i}`}>
                    <Text color="red">- </Text>
                    <Text color="red">{line.trim().slice(0, 70)}</Text>
                    {line.trim().length > 70 && <Text color="gray">...</Text>}
                  </Box>
                ))}
                {group.added.map((line, i) => (
                  <Box key={`a${i}`}>
                    <Text color="green">+ </Text>
                    <Text color="green">{line.trim().slice(0, 70)}</Text>
                    {line.trim().length > 70 && <Text color="gray">...</Text>}
                  </Box>
                ))}
              </Box>
            ))
          )}

          {scrollOffset + visibleGroups < changedGroups.length && (
            <Text color="gray">↓ {changedGroups.length - scrollOffset - visibleGroups} more below</Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color="red">- current (will be replaced) </Text>
            <Text color="green">+ backup (will be restored)</Text>
          </Box>

          <Box marginTop={1}>
            <Text color="gray">
              [←/→] Switch file | [↑/↓] Scroll | [y/Enter] Restore | [q/Esc] Cancel
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Backup Browser</Text>

      {error && (
        <Box marginY={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {backups.length === 0 ? (
        <Box marginY={1}>
          <Text color="gray">No backups found.</Text>
        </Box>
      ) : (
        <Box marginY={1} flexDirection="column">
          {backups.map((backup, idx) => (
            <Box key={backup.id} flexDirection="column">
              <Box>
                <Text color={idx === cursor ? 'cyan' : undefined}>
                  {idx === cursor ? '>' : ' '} {backup.id}
                </Text>
              </Box>
              <Box marginLeft={3}>
                <Text color="gray">
                  {new Date(backup.timestamp).toLocaleString()} | {backup.components} files
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">
          [↑/↓] Navigate | [Enter] Preview & Restore | [c] Create backup | [q/Esc] Back
        </Text>
      </Box>
    </Box>
  );
}
