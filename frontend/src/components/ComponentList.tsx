import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useMemo, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import type { Component, Screen } from '../types/index.js';

interface ComponentListProps {
  components: Component[];
  selectedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onView: (component: Component) => void;
  onEdit: () => void;
  onNavigate: (screen: Screen) => void;
}

export function ComponentList({
  components,
  selectedPaths,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onView,
  onEdit,
  onNavigate,
}: ComponentListProps) {
  const [cursor, setCursor] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredComponents = useMemo(() => {
    if (!searchQuery) return components;
    const query = searchQuery.toLowerCase();
    return components.filter(
      (c) => c.name.toLowerCase().includes(query) || c.path.toLowerCase().includes(query)
    );
  }, [components, searchQuery]);

  const visibleCount = 10;
  const startIdx = Math.max(0, Math.min(cursor - 4, filteredComponents.length - visibleCount));
  const visibleComponents = filteredComponents.slice(startIdx, startIdx + visibleCount);

  useInput((input, key) => {
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setSearchQuery('');
      }
      return;
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(filteredComponents.length - 1, c + 1));
    } else if (input === ' ') {
      const component = filteredComponents[cursor];
      if (component) {
        onToggle(component.path);
      }
    } else if (key.return) {
      const component = filteredComponents[cursor];
      if (component) {
        onView(component);
      }
    } else if (input === 'e') {
      onEdit();
    } else if (input === 'a') {
      onSelectAll();
    } else if (input === 'n') {
      onDeselectAll();
    } else if (input === 't') {
      onNavigate('templates');
    } else if (input === 'b') {
      onNavigate('backups');
    } else if (input === '/') {
      setSearchMode(true);
    }
  });

  if (components.length === 0) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={THEME.accent} paddingX={2} paddingY={1}>
          <Text color={THEME.accent}>{SYMBOLS.diamond} </Text>
          <Text color={THEME.accent}>No components found</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={THEME.muted}>Make sure you have shadcn/ui components in your project.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          <Text bold color={THEME.highlight}>
            {SYMBOLS.diamond} Components
          </Text>
        </Box>
        <Box>
          <Text color={selectedPaths.size > 0 ? THEME.success : THEME.muted}>
            {SYMBOLS.check} {selectedPaths.size}
          </Text>
          <Text color={THEME.muted}> / {filteredComponents.length}</Text>
        </Box>
      </Box>

      {/* Search Bar */}
      {searchMode && (
        <Box marginBottom={1} borderStyle="round" borderColor={THEME.secondary} paddingX={1}>
          <Text color={THEME.secondary}>{SYMBOLS.arrow} </Text>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            onSubmit={() => setSearchMode(false)}
            placeholder="Type to filter..."
          />
        </Box>
      )}

      {searchQuery && !searchMode && (
        <Box marginBottom={1}>
          <Text color={THEME.muted}>{SYMBOLS.arrow} Filtered: </Text>
          <Text color={THEME.secondary}>"{searchQuery}"</Text>
          <Text color={THEME.muted}> ─ press </Text>
          <Text color={THEME.secondary}>/</Text>
          <Text color={THEME.muted}> to search</Text>
        </Box>
      )}

      {/* Component List */}
      <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
        {startIdx > 0 && (
          <Box justifyContent="center">
            <Text color={THEME.muted}>↑ {startIdx} more above</Text>
          </Box>
        )}

        {visibleComponents.map((component, idx) => {
          const actualIdx = startIdx + idx;
          const isSelected = selectedPaths.has(component.path);
          const isCursor = actualIdx === cursor;

          return (
            <Box key={component.path}>
              {/* Cursor Indicator */}
              <Box width={2}>
                <Text color={isCursor ? THEME.primary : THEME.muted}>
                  {isCursor ? SYMBOLS.arrow : ' '}
                </Text>
              </Box>

              {/* Selection Checkbox */}
              <Box width={4}>
                <Text color={isSelected ? THEME.success : THEME.muted}>
                  {isSelected ? `${SYMBOLS.check} ` : `${SYMBOLS.circle} `}
                </Text>
              </Box>

              {/* Component Name */}
              <Box width={20}>
                <Text
                  color={isCursor ? THEME.secondary : isSelected ? THEME.success : THEME.highlight}
                  bold={isCursor}
                >
                  {component.name}
                </Text>
              </Box>

              {/* Metadata */}
              <Text color={THEME.muted}>{component.metadata.lines} ln</Text>

              {/* File indicator for selected */}
              {isSelected && <Text color={THEME.success}> {SYMBOLS.dot}</Text>}
            </Box>
          );
        })}

        {startIdx + visibleCount < filteredComponents.length && (
          <Box justifyContent="center">
            <Text color={THEME.muted}>
              ↓ {filteredComponents.length - startIdx - visibleCount} more below
            </Text>
          </Box>
        )}
      </Box>

      {/* Actions Bar */}
      <Box marginTop={1} flexDirection="column">
        {/* Primary Actions */}
        <Box
          borderStyle="round"
          borderColor={selectedPaths.size > 0 ? THEME.success : THEME.muted}
          paddingX={2}
          justifyContent="center"
        >
          {selectedPaths.size > 0 ? (
            <Text>
              <Text color={THEME.success}>e</Text>
              <Text color={THEME.muted}> Edit {selectedPaths.size} selected</Text>
              <Text color={THEME.muted}> │ </Text>
              <Text color={THEME.secondary}>t</Text>
              <Text color={THEME.muted}> Templates</Text>
            </Text>
          ) : (
            <Text color={THEME.muted}>
              Select components with <Text color={THEME.secondary}>Space</Text> to enable editing
            </Text>
          )}
        </Box>

        {/* Secondary Actions */}
        <Box marginTop={1} justifyContent="center">
          <Text color={THEME.muted}>
            <Text color={THEME.secondary}>Space</Text> Toggle │{' '}
            <Text color={THEME.secondary}>↵</Text> View │ <Text color={THEME.secondary}>a</Text> All
            │ <Text color={THEME.secondary}>n</Text> None │ <Text color={THEME.secondary}>/</Text>{' '}
            Search │ <Text color={THEME.secondary}>b</Text> Backups
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
