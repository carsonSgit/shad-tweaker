import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface EditorProps {
  selectedCount: number;
  onPreview: (find: string, replace: string, isRegex: boolean) => void;
  onCancel: () => void;
}

type Field = 'find' | 'replace';

export function Editor({ selectedCount, onPreview, onCancel }: EditorProps) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [activeField, setActiveField] = useState<Field>('find');
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.tab) {
      setActiveField((f) => (f === 'find' ? 'replace' : 'find'));
      return;
    }

    if (input === 'r' && key.ctrl) {
      setIsRegex((r) => !r);
      return;
    }
  });

  const handleSubmit = () => {
    if (!find.trim()) {
      setError('Find pattern is required');
      return;
    }

    if (isRegex) {
      try {
        new RegExp(find);
      } catch (e) {
        setError(`Invalid regex: ${e instanceof Error ? e.message : 'Unknown error'}`);
        return;
      }
    }

    setError(null);
    onPreview(find, replace, isRegex);
  };

  const quickActions = [
    { label: 'Remove cursor-pointer', find: 'cursor-pointer', replace: '' },
    { label: 'Add focus-visible ring', find: 'focus:', replace: 'focus-visible:' },
    { label: 'Update rounded-md to rounded-lg', find: 'rounded-md', replace: 'rounded-lg' },
    { label: 'Replace ring-2 with ring-1', find: 'ring-2', replace: 'ring-1' },
  ];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Edit Mode</Text>
        <Text color="gray"> - {selectedCount} components selected</Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Box marginBottom={1}>
          <Box width={12}>
            <Text color={activeField === 'find' ? 'cyan' : 'gray'}>Find:</Text>
          </Box>
          <Box borderStyle="single" paddingX={1} width={50}>
            {activeField === 'find' ? (
              <TextInput
                value={find}
                onChange={setFind}
                onSubmit={() => setActiveField('replace')}
              />
            ) : (
              <Text color="gray">{find || '(empty)'}</Text>
            )}
          </Box>
        </Box>

        <Box marginBottom={1}>
          <Box width={12}>
            <Text color={activeField === 'replace' ? 'cyan' : 'gray'}>Replace:</Text>
          </Box>
          <Box borderStyle="single" paddingX={1} width={50}>
            {activeField === 'replace' ? (
              <TextInput
                value={replace}
                onChange={setReplace}
                onSubmit={handleSubmit}
              />
            ) : (
              <Text color="gray">{replace || '(empty - will delete matches)'}</Text>
            )}
          </Box>
        </Box>

        <Box>
          <Box width={12} />
          <Text color={isRegex ? 'green' : 'gray'}>
            [{isRegex ? 'x' : ' '}] Regex mode (Ctrl+R to toggle)
          </Text>
        </Box>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text bold>Quick Actions:</Text>
        {quickActions.map((action, idx) => (
          <Box key={idx}>
            <Text color="gray">{idx + 1}. </Text>
            <Text>{action.label}</Text>
            <Text color="gray"> ({action.find} → {action.replace || '(delete)'})</Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color="gray">
          [Tab] Switch field | [Enter] Preview | [Ctrl+R] Toggle regex | [Esc] Cancel
        </Text>
      </Box>
    </Box>
  );
}
