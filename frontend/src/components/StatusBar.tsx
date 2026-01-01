import React from 'react';
import { Box, Text } from 'ink';
import type { Screen } from '../types/index.js';

interface StatusBarProps {
  screen: Screen;
  selectedCount: number;
  totalCount: number;
  notification: { message: string; type: 'success' | 'error' } | null;
}

const screenLabels: Record<Screen, string> = {
  dashboard: 'Dashboard',
  components: 'Component Browser',
  'component-view': 'Component View',
  editor: 'Edit Mode',
  preview: 'Preview Changes',
  templates: 'Template Manager',
  backups: 'Backup Browser',
  help: 'Help',
};

export function StatusBar({
  screen,
  selectedCount,
  totalCount,
  notification,
}: StatusBarProps) {
  return (
    <Box
      marginTop={1}
      paddingTop={1}
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      flexDirection="column"
    >
      {notification && (
        <Box marginBottom={1}>
          <Text color={notification.type === 'success' ? 'green' : 'red'}>
            {notification.type === 'success' ? '✓' : '✗'} {notification.message}
          </Text>
        </Box>
      )}

      <Box justifyContent="space-between">
        <Box>
          <Text color="gray">{screenLabels[screen]}</Text>
          {totalCount > 0 && (
            <Text color="gray">
              {' '}| {selectedCount}/{totalCount} selected
            </Text>
          )}
        </Box>

        <Box>
          <Text color="gray">
            {screen === 'dashboard' ? '[q] Quit' : '[q] Back'} | [?] Help
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
