import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
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
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.path.toLowerCase().includes(query)
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
        <Text color="yellow">No components found.</Text>
        <Text color="gray">Make sure you have shadcn/ui components in your project.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          Components ({selectedPaths.size} selected / {filteredComponents.length} total)
        </Text>
      </Box>

      {searchMode && (
        <Box marginBottom={1}>
          <Text color="cyan">Search: </Text>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            onSubmit={() => setSearchMode(false)}
          />
        </Box>
      )}

      {searchQuery && !searchMode && (
        <Box marginBottom={1}>
          <Text color="gray">Filter: "{searchQuery}" </Text>
          <Text color="gray">(press / to search)</Text>
        </Box>
      )}

      <Box flexDirection="column">
        {startIdx > 0 && (
          <Text color="gray">  ↑ {startIdx} more...</Text>
        )}

        {visibleComponents.map((component, idx) => {
          const actualIdx = startIdx + idx;
          const isSelected = selectedPaths.has(component.path);
          const isCursor = actualIdx === cursor;

          return (
            <Box key={component.path}>
              <Text color={isCursor ? 'cyan' : undefined}>
                {isCursor ? '>' : ' '}
              </Text>
              <Text color={isSelected ? 'green' : 'gray'}>
                [{isSelected ? 'x' : ' '}]
              </Text>
              <Text color={isCursor ? 'cyan' : undefined}>
                {' '}{component.name}
              </Text>
              <Text color="gray">
                {' '}({component.metadata.lines} lines)
              </Text>
            </Box>
          );
        })}

        {startIdx + visibleCount < filteredComponents.length && (
          <Text color="gray">
            {'  '}↓ {filteredComponents.length - startIdx - visibleCount} more...
          </Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          [Space] Toggle | [Enter] View | [e] Edit Selected | [a] All | [n] None
        </Text>
        <Text color="gray">
          [/] Search | [t] Templates | [b] Backups | [q] Back
        </Text>
      </Box>
    </Box>
  );
}
