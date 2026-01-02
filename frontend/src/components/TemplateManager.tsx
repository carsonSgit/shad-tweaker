import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import * as api from '../api/client.js';
import type { Template, TemplateRule } from '../types/index.js';

interface TemplateManagerProps {
  onApplyTemplate: (rules: TemplateRule[]) => void;
  onBack: () => void;
}

type Mode = 'list' | 'create' | 'view';

export function TemplateManager({ onApplyTemplate, onBack }: TemplateManagerProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  const [cursor, setCursor] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newFind, setNewFind] = useState('');
  const [newReplace, setNewReplace] = useState('');
  const [activeField, setActiveField] = useState<'name' | 'find' | 'replace'>('name');

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    const result = await api.getTemplates();
    if (result.success && result.data) {
      setTemplates(result.data.templates);
    } else {
      setError(result.error?.message || 'Failed to load templates');
    }
    setLoading(false);
  };

  useInput((input, key) => {
    if (mode === 'create') {
      if (key.escape) {
        setMode('list');
        return;
      }
      if (key.tab) {
        setActiveField((f) => {
          if (f === 'name') return 'find';
          if (f === 'find') return 'replace';
          return 'name';
        });
        return;
      }
      return;
    }

    if (mode === 'view') {
      if (key.escape) {
        setMode('list');
        setSelectedTemplate(null);
      } else if (input === 'a' && selectedTemplate) {
        onApplyTemplate(selectedTemplate.rules);
      } else if (input === 'd' && selectedTemplate) {
        handleDelete(selectedTemplate.name);
      }
      // 'q' in view mode goes back to list
      if (input === 'q') {
        setMode('list');
        setSelectedTemplate(null);
      }
      return;
    }

    // List mode
    if (key.escape || input === 'q') {
      onBack();
    } else if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(templates.length - 1, c + 1));
    } else if (key.return) {
      if (templates[cursor]) {
        setSelectedTemplate(templates[cursor]);
        setMode('view');
      }
    } else if (input === 'n') {
      setMode('create');
      setNewName('');
      setNewFind('');
      setNewReplace('');
      setActiveField('name');
    }
  });

  const handleCreateSubmit = async () => {
    if (!newName.trim() || !newFind.trim()) {
      setError('Name and find pattern are required');
      return;
    }

    const result = await api.createTemplate(newName, [
      { find: newFind, replace: newReplace, isRegex: false },
    ]);

    if (result.success) {
      setMode('list');
      fetchTemplates();
    } else {
      setError(result.error?.message || 'Failed to create template');
    }
  };

  const handleDelete = async (name: string) => {
    const result = await api.deleteTemplate(name);
    if (result.success) {
      setMode('list');
      setSelectedTemplate(null);
      fetchTemplates();
    } else {
      setError(result.error?.message || 'Failed to delete template');
    }
  };

  if (loading) {
    return (
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text> Loading templates...</Text>
      </Box>
    );
  }

  if (mode === 'create') {
    return (
      <Box flexDirection="column">
        <Text bold>Create New Template</Text>

        {error && (
          <Box marginY={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        <Box marginY={1} flexDirection="column">
          <Box marginBottom={1}>
            <Box width={10}>
              <Text color={activeField === 'name' ? 'cyan' : 'gray'}>Name:</Text>
            </Box>
            {activeField === 'name' ? (
              <TextInput
                value={newName}
                onChange={setNewName}
                onSubmit={() => setActiveField('find')}
              />
            ) : (
              <Text>{newName || '(empty)'}</Text>
            )}
          </Box>

          <Box marginBottom={1}>
            <Box width={10}>
              <Text color={activeField === 'find' ? 'cyan' : 'gray'}>Find:</Text>
            </Box>
            {activeField === 'find' ? (
              <TextInput
                value={newFind}
                onChange={setNewFind}
                onSubmit={() => setActiveField('replace')}
              />
            ) : (
              <Text>{newFind || '(empty)'}</Text>
            )}
          </Box>

          <Box marginBottom={1}>
            <Box width={10}>
              <Text color={activeField === 'replace' ? 'cyan' : 'gray'}>Replace:</Text>
            </Box>
            {activeField === 'replace' ? (
              <TextInput
                value={newReplace}
                onChange={setNewReplace}
                onSubmit={handleCreateSubmit}
              />
            ) : (
              <Text>{newReplace || '(empty)'}</Text>
            )}
          </Box>
        </Box>

        <Text color="gray">[Tab] Next field | [Enter] Save | [Esc] Cancel</Text>
      </Box>
    );
  }

  if (mode === 'view' && selectedTemplate) {
    return (
      <Box flexDirection="column">
        <Text bold color="cyan">{selectedTemplate.name}</Text>
        <Text color="gray">Created: {new Date(selectedTemplate.created).toLocaleString()}</Text>

        <Box marginY={1} flexDirection="column">
          <Text bold>Rules:</Text>
          {selectedTemplate.rules.map((rule, idx) => (
            <Box key={idx} flexDirection="column" marginLeft={2}>
              <Text>Find: <Text color="yellow">{rule.find}</Text></Text>
              <Text>Replace: <Text color="green">{rule.replace || '(delete)'}</Text></Text>
              {rule.isRegex && <Text color="gray">(regex)</Text>}
            </Box>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text color="gray">[a] Apply to selected | [d] Delete | [q/Esc] Back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Template Manager</Text>

      {error && (
        <Box marginY={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {templates.length === 0 ? (
        <Box marginY={1}>
          <Text color="gray">No templates saved yet.</Text>
        </Box>
      ) : (
        <Box marginY={1} flexDirection="column">
          {templates.map((template, idx) => (
            <Box key={template.id}>
              <Text color={idx === cursor ? 'cyan' : undefined}>
                {idx === cursor ? '>' : ' '} {template.name}
              </Text>
              <Text color="gray"> ({template.rules.length} rules)</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">
          [↑/↓] Navigate | [Enter] View | [n] New | [q/Esc] Back
        </Text>
      </Box>
    </Box>
  );
}
