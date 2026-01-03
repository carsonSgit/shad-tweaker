import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import type { Component, Screen } from '../types/index.js';

interface DashboardProps {
  components: Component[];
  loading: boolean;
  error: string | null;
  onNavigate: (screen: Screen) => void;
  onScan: () => void;
}

export function Dashboard({
  components,
  loading,
  error,
  onNavigate,
  onScan,
}: DashboardProps) {
  const menuItems = [
    { label: 'Browse Components', value: 'components' as Screen },
    { label: 'Template Manager', value: 'templates' as Screen },
    { label: 'Backup Browser', value: 'backups' as Screen },
    { label: 'Rescan Project', value: 'rescan' as const },
    { label: 'Help', value: 'help' as Screen },
  ];

  const handleSelect = (item: { value: Screen | 'rescan' }) => {
    if (item.value === 'rescan') {
      onScan();
    } else {
      onNavigate(item.value);
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text color="gray">Project detected with shadcn/ui components</Text>
      </Box>

      {loading && (
        <Box marginBottom={1}>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> Scanning for components...</Text>
        </Box>
      )}

      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
          <Text color="gray"> (Make sure backend is running on localhost:3001)</Text>
        </Box>
      )}

      {!loading && !error && (
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text color="green">Found </Text>
            <Text bold color="green">{components.length}</Text>
            <Text color="green"> components</Text>
          </Box>
        </Box>
      )}

      <Box marginY={1} flexDirection="column">
        <Box marginBottom={1}>
          <Text bold underline>Main Menu</Text>
        </Box>
        <SelectInput items={menuItems} onSelect={handleSelect} />
      </Box>
    </Box>
  );
}
