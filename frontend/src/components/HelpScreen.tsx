import React from 'react';
import { Box, Text, useInput } from 'ink';

interface HelpScreenProps {
  onBack: () => void;
}

export function HelpScreen({ onBack }: HelpScreenProps) {
  useInput((input, key) => {
    if (key.escape) {
      onBack();
    }
    // 'q' handled by global App handler
  });

  const shortcuts = [
    { key: '↑/↓', desc: 'Navigate lists' },
    { key: 'Space', desc: 'Toggle component selection' },
    { key: 'Enter', desc: 'Select menu item / View component' },
    { key: 'e', desc: 'Enter edit mode (from component list)' },
    { key: 'a', desc: 'Select all components' },
    { key: 'n', desc: 'Deselect all components' },
    { key: 't', desc: 'Open template manager' },
    { key: 'b', desc: 'Open backup browser' },
    { key: '/', desc: 'Search/filter components' },
    { key: 'q', desc: 'Go back / Quit' },
    { key: 'Esc', desc: 'Cancel current action' },
    { key: '?', desc: 'Show this help' },
  ];

  return (
    <Box flexDirection="column">
      <Text bold underline>Keyboard Shortcuts</Text>
      <Box marginY={1} flexDirection="column">
        {shortcuts.map(({ key, desc }) => (
          <Box key={key}>
            <Box width={12}>
              <Text color="cyan">{key}</Text>
            </Box>
            <Text>{desc}</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold underline>Workflow</Text>
        <Box marginY={1} flexDirection="column">
          <Text>1. Browse components and select ones to edit</Text>
          <Text>2. Press 'e' to enter edit mode</Text>
          <Text>3. Enter find/replace patterns</Text>
          <Text>4. Preview changes before applying</Text>
          <Text>5. Confirm to apply (automatic backup created)</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">Press [q] or [Esc] to go back</Text>
      </Box>
    </Box>
  );
}
