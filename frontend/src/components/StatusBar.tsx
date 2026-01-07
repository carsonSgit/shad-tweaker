import React from 'react';
import { Box, Text } from 'ink';
import type { Screen } from '../types/index.js';
import { THEME, SYMBOLS } from '../App.js';

interface StatusBarProps {
  screen: Screen;
  selectedCount: number;
  totalCount: number;
  notification: { message: string; type: 'success' | 'error' } | null;
}

const screenLabels: Record<Screen, { label: string; icon: string }> = {
  dashboard: { label: 'Dashboard', icon: '~' },
  components: { label: 'Components', icon: '*' },
  'component-view': { label: 'Viewing', icon: '>' },
  editor: { label: 'Edit Mode', icon: '#' },
  preview: { label: 'Preview', icon: '%' },
  templates: { label: 'Templates', icon: '@' },
  backups: { label: 'Backups', icon: '+' },
  help: { label: 'Help', icon: '?' },
};

export function StatusBar({
  screen,
  selectedCount,
  totalCount,
  notification,
}: StatusBarProps) {
  const screenInfo = screenLabels[screen];
  
  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Notification Banner */}
      {notification && (
        <Box 
          marginBottom={1} 
          paddingX={2}
          borderStyle="round"
          borderColor={notification.type === 'success' ? THEME.success : THEME.error}
        >
          <Text color={notification.type === 'success' ? THEME.success : THEME.error}>
            {notification.type === 'success' ? SYMBOLS.check : SYMBOLS.cross}
          </Text>
          <Text> </Text>
          <Text color={notification.type === 'success' ? THEME.success : THEME.error}>
            {notification.message}
          </Text>
        </Box>
      )}

      {/* Status Line */}
      <Box>
        <Text color={THEME.primary}>{'─'.repeat(42)}</Text>
      </Box>
      
      <Box justifyContent="space-between">
        {/* Left: Current Screen */}
        <Box>
          <Text>{screenInfo.icon} </Text>
          <Text color={THEME.secondary}>{screenInfo.label}</Text>
          {totalCount > 0 && (
            <>
              <Text color={THEME.muted}> │ </Text>
              <Text color={selectedCount > 0 ? THEME.accent : THEME.muted}>
                {SYMBOLS.box} {selectedCount}
              </Text>
              <Text color={THEME.muted}>/{totalCount}</Text>
            </>
          )}
        </Box>

        {/* Right: Controls Hint */}
        <Box>
          <Text color={THEME.muted}>
            <Text color={THEME.secondary}>{screen === 'dashboard' ? 'q' : '←/q'}</Text>
            <Text> {screen === 'dashboard' ? 'Quit' : 'Back'}</Text>
            <Text color={THEME.muted}> │ </Text>
            <Text color={THEME.secondary}>?</Text>
            <Text> Help</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
