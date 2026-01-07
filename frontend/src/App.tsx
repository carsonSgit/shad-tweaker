import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Component, Screen } from './types/index.js';
import { useComponents, useNavigation } from './hooks/useComponents.js';
import { Dashboard } from './components/Dashboard.js';
import { ComponentList } from './components/ComponentList.js';
import { ComponentView } from './components/ComponentView.js';
import { Editor } from './components/Editor.js';
import { PreviewView } from './components/Preview.js';
import { TemplateManager } from './components/TemplateManager.js';
import { BackupBrowser } from './components/BackupBrowser.js';
import { HelpScreen } from './components/HelpScreen.js';
import { StatusBar } from './components/StatusBar.js';

// Visual constants for consistent theming
export const THEME = {
  primary: 'magenta',
  secondary: 'cyan',
  accent: 'yellow',
  success: 'green',
  error: 'red',
  muted: 'gray',
  highlight: 'white',
} as const;

export const SYMBOLS = {
  dot: '●',
  circle: '○',
  arrow: '▸',
  arrowDown: '▾',
  check: '✓',
  cross: '✗',
  star: '★',
  diamond: '◆',
  box: '■',
  line: '─',
  corner: '╭',
  cornerEnd: '╰',
  vertical: '│',
  horizontalLine: '═',
} as const;

export function App() {
  const { exit } = useApp();
  const { screen, navigate, goBack, canGoBack } = useNavigation('dashboard');
  const {
    components,
    selectedPaths,
    loading,
    error,
    hasScanned,
    scanComponents,
    toggleSelection,
    selectAll,
    deselectAll,
    getSelectedComponents,
    setError,
  } = useComponents();

  const [currentComponent, setCurrentComponent] = useState<Component | null>(null);
  const [editState, setEditState] = useState({ find: '', replace: '', isRegex: false });
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Auto-scan once on first load
  useEffect(() => {
    if (!hasScanned() && !loading) {
      scanComponents();
    }
  }, [hasScanned, loading, scanComponents]);

  // Clear notification after 3 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Global keyboard shortcuts
  useInput((input, key) => {
    // Don't handle input when in editor mode or loading
    if (loading) return;

    // Screens that handle their own 'q' for internal navigation
    const screensWithInternalNav = ['editor', 'preview', 'templates', 'backups'];
    if (input === 'q' && !screensWithInternalNav.includes(screen)) {
      if (!goBack()) {
        exit();
      }
    }

    if (input === '?') {
      navigate('help');
    }
  });

  const handleNavigate = (newScreen: Screen) => {
    setError(null);
    navigate(newScreen);
  };

  const handleViewComponent = (component: Component) => {
    setCurrentComponent(component);
    navigate('component-view');
  };

  const handleStartEdit = () => {
    if (selectedPaths.size === 0) {
      setNotification({ message: 'Select at least one component first', type: 'error' });
      return;
    }
    navigate('editor');
  };

  const handlePreview = (find: string, replace: string, isRegex: boolean) => {
    setEditState({ find, replace, isRegex });
    navigate('preview');
  };

  const handleApplySuccess = (message: string) => {
    setNotification({ message, type: 'success' });
    scanComponents(); // Refresh component list
    navigate('components');
  };

  const renderScreen = () => {
    switch (screen) {
      case 'dashboard':
        return (
          <Dashboard
            components={components}
            loading={loading}
            error={error}
            onNavigate={handleNavigate}
            onScan={scanComponents}
          />
        );

      case 'components':
        return (
          <ComponentList
            components={components}
            selectedPaths={selectedPaths}
            onToggle={toggleSelection}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            onView={handleViewComponent}
            onEdit={handleStartEdit}
            onNavigate={handleNavigate}
          />
        );

      case 'component-view':
        return currentComponent ? (
          <ComponentView
            component={currentComponent}
            onBack={() => goBack()}
          />
        ) : null;

      case 'editor':
        return (
          <Editor
            selectedCount={selectedPaths.size}
            onPreview={handlePreview}
            onCancel={() => goBack()}
          />
        );

      case 'preview':
        return (
          <PreviewView
            componentPaths={Array.from(selectedPaths)}
            find={editState.find}
            replace={editState.replace}
            isRegex={editState.isRegex}
            onApply={handleApplySuccess}
            onCancel={() => goBack()}
          />
        );

      case 'templates':
        return (
          <TemplateManager
            onApplyTemplate={(rules) => {
              if (rules.length > 0) {
                setEditState({
                  find: rules[0].find,
                  replace: rules[0].replace,
                  isRegex: rules[0].isRegex || false,
                });
              }
              navigate('components');
            }}
            onBack={() => goBack()}
            selectedPaths={Array.from(selectedPaths)}
            onDirectApply={(message) => {
              setNotification({ message, type: 'success' });
              scanComponents();
              navigate('components');
            }}
          />
        );

      case 'backups':
        return (
          <BackupBrowser
            onRestore={(message) => {
              setNotification({ message, type: 'success' });
              scanComponents();
            }}
            onBack={() => goBack()}
          />
        );

      case 'help':
        return <HelpScreen onBack={() => goBack()} />;

      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color={THEME.primary}>╭</Text>
          <Text color={THEME.primary}>{'─'.repeat(40)}</Text>
          <Text color={THEME.primary}>╮</Text>
        </Box>
        <Box>
          <Text color={THEME.primary}>│</Text>
          <Text> </Text>
          <Text bold color={THEME.primary}>◆ </Text>
          <Text bold color={THEME.highlight}>shadcn</Text>
          <Text bold color={THEME.primary}>/</Text>
          <Text bold color={THEME.secondary}>tweaker</Text>
          <Text color={THEME.muted}> ─ </Text>
          <Text color={THEME.muted}>v1.0.1</Text>
          <Text>{'   '.repeat(6)}</Text>
          <Text color={THEME.primary}>│</Text>
        </Box>
        <Box>
          <Text color={THEME.primary}>╰</Text>
          <Text color={THEME.primary}>{'─'.repeat(40)}</Text>
          <Text color={THEME.primary}>╯</Text>
        </Box>
      </Box>

      {/* Main Content */}
      <Box flexDirection="column" minHeight={15}>
        {renderScreen()}
      </Box>

      {/* Status Bar */}
      <StatusBar
        screen={screen}
        selectedCount={selectedPaths.size}
        totalCount={components.length}
        notification={notification}
      />
    </Box>
  );
}
