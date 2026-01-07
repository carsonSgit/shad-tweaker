import React from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type { Component, Screen } from '../types/index.js';
import { THEME, SYMBOLS } from '../App.js';

interface DashboardProps {
  components: Component[];
  loading: boolean;
  error: string | null;
  onNavigate: (screen: Screen) => void;
  onScan: () => void;
}

interface MenuItem {
  label: string;
  value: Screen | 'rescan';
  icon: string;
  description: string;
  color: string;
}

export function Dashboard({
  components,
  loading,
  error,
  onNavigate,
  onScan,
}: DashboardProps) {
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  const menuItems: MenuItem[] = [
    { 
      label: 'Browse Components', 
      value: 'components' as Screen, 
      icon: '',
      description: 'View and select components to modify',
      color: 'cyan'
    },
    { 
      label: 'Template Manager', 
      value: 'templates' as Screen, 
      icon: '',
      description: 'Quick actions & saved templates',
      color: 'magenta'
    },
    { 
      label: 'Backup Browser', 
      value: 'backups' as Screen, 
      icon: '',
      description: 'Restore previous component versions',
      color: 'yellow'
    },
    { 
      label: 'Rescan Project', 
      value: 'rescan' as const, 
      icon: '',
      description: 'Refresh the component list',
      color: 'green'
    },
    { 
      label: 'Help & Shortcuts', 
      value: 'help' as Screen, 
      icon: '',
      description: 'View keyboard shortcuts and workflow',
      color: 'blue'
    },
  ];

  useInput((input, key) => {
    if (loading) return;
    
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(menuItems.length - 1, i + 1));
    } else if (key.return) {
      const item = menuItems[selectedIndex];
      if (item.value === 'rescan') {
        onScan();
      } else {
        onNavigate(item.value);
      }
    }
    
    // Number shortcuts
    const num = parseInt(input);
    if (num >= 1 && num <= menuItems.length) {
      const item = menuItems[num - 1];
      if (item.value === 'rescan') {
        onScan();
      } else {
        onNavigate(item.value);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {/* Status Card */}
      <Box flexDirection="column" marginBottom={1}>
        <Box borderStyle="round" borderColor={THEME.muted} paddingX={2} paddingY={0} flexDirection="column">
          <Box>
            <Text color={THEME.secondary}>{SYMBOLS.diamond} </Text>
            <Text color={THEME.muted}>Project Status</Text>
          </Box>
          
          {loading ? (
            <Box marginTop={1}>
              <Text color={THEME.success}>
                <Spinner type="dots" />
              </Text>
              <Text color={THEME.muted}> Scanning for shadcn/ui components...</Text>
            </Box>
          ) : error ? (
            <Box marginTop={1} flexDirection="column">
              <Box>
                <Text color={THEME.error}>{SYMBOLS.cross} </Text>
                <Text color={THEME.error}>{error}</Text>
              </Box>
              <Text color={THEME.muted} dimColor>   Make sure backend is running on localhost:3001</Text>
            </Box>
          ) : (
            <Box marginTop={1}>
              <Text color={THEME.success}>{SYMBOLS.check} </Text>
              <Text>Found </Text>
              <Text bold color={THEME.accent}>{components.length}</Text>
              <Text> components ready to tweak</Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Menu */}
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color={THEME.highlight}>Main Menu</Text>
          <Text color={THEME.muted}> ─ Select an option</Text>
        </Box>
        
        <Box flexDirection="column">
          {menuItems.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <Box key={item.value} marginBottom={0}>
                <Box width={3}>
                  <Text color={isSelected ? THEME.primary : THEME.muted}>
                    {isSelected ? SYMBOLS.arrow : ' '}
                  </Text>
                </Box>
                <Box width={3}>
                  <Text color={THEME.muted}>{idx + 1}.</Text>
                </Box>
                <Box width={20}>
                  <Text 
                    color={isSelected ? item.color : THEME.highlight} 
                    bold={isSelected}
                  >
                    {item.label}
                  </Text>
                </Box>
                <Text color={THEME.muted}>{item.description}</Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Quick Tips */}
      <Box marginTop={1} borderStyle="single" borderColor={THEME.muted} paddingX={2} paddingY={0}>
        <Text color={THEME.muted}>{SYMBOLS.arrow} </Text>
        <Text color={THEME.muted}>Tip: Press </Text>
        <Text color={THEME.secondary}>1-{menuItems.length}</Text>
        <Text color={THEME.muted}> for quick navigation, </Text>
        <Text color={THEME.secondary}>?</Text>
        <Text color={THEME.muted}> for help</Text>
      </Box>
    </Box>
  );
}
