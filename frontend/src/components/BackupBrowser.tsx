import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import * as api from '../api/client.js';
import type { Backup } from '../types/index.js';

interface BackupBrowserProps {
  onRestore: (message: string) => void;
  onBack: () => void;
}

export function BackupBrowser({ onRestore, onBack }: BackupBrowserProps) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

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

  const handleRestore = async (backupId: string) => {
    setRestoring(true);
    const result = await api.restoreBackup(backupId);
    if (result.success) {
      onRestore(`Restored from backup ${backupId}`);
    } else {
      setError(result.error?.message || 'Failed to restore backup');
      setRestoring(false);
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
    if (restoring) return;

    if (confirmRestore) {
      if (input === 'y') {
        handleRestore(confirmRestore);
        setConfirmRestore(null);
      } else if (input === 'n' || key.escape) {
        setConfirmRestore(null);
      }
      return;
    }

    if (key.escape || input === 'q') {
      onBack();
    } else if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(backups.length - 1, c + 1));
    } else if (key.return) {
      if (backups[cursor]) {
        setConfirmRestore(backups[cursor].id);
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

  return (
    <Box flexDirection="column">
      <Text bold>Backup Browser</Text>

      {error && (
        <Box marginY={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {confirmRestore && (
        <Box marginY={1} flexDirection="column">
          <Text color="yellow">
            Restore backup {confirmRestore}? This will overwrite current files.
          </Text>
          <Text color="gray">[y] Yes | [n] No</Text>
        </Box>
      )}

      {!confirmRestore && (
        <>
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
                      {new Date(backup.timestamp).toLocaleString()} | {backup.components.length} files
                    </Text>
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          <Box marginTop={1}>
            <Text color="gray">
              [↑/↓] Navigate | [Enter] Restore | [c] Create backup | [q/Esc] Back
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
