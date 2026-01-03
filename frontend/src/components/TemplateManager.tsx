import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import * as Diff from 'diff';
import * as api from '../api/client.js';
import type { Template, TemplateRule, Preview } from '../types/index.js';

interface TemplateManagerProps {
  onApplyTemplate: (rules: TemplateRule[]) => void;
  onBack: () => void;
  selectedPaths?: string[];
  onDirectApply?: (message: string) => void;
}

type Mode = 'list' | 'create' | 'view' | 'confirm';

export function TemplateManager({ onApplyTemplate, onBack, selectedPaths = [], onDirectApply }: TemplateManagerProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  const [cursor, setCursor] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // Preview/confirm state
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newFind, setNewFind] = useState('');
  const [newReplace, setNewReplace] = useState('');
  const [activeField, setActiveField] = useState<'name' | 'find' | 'replace'>('name');

  const canDirectApply = selectedPaths.length > 0 && onDirectApply;

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

  const fetchPreview = async (template: Template) => {
    setLoadingPreview(true);
    setError(null);

    // Get previews for all rules combined
    const allPreviews: Preview[] = [];

    for (const rule of template.rules) {
      const result = await api.previewEdit(selectedPaths, rule.find, rule.replace, rule.isRegex);
      if (result.success && result.data) {
        // Merge previews, combining changes to the same file
        for (const preview of result.data.previews) {
          const existing = allPreviews.find(p => p.path === preview.path);
          if (existing) {
            // Update the existing preview with new changes
            existing.after = preview.after;
            existing.changes += preview.changes;
            existing.lineNumbers = [...existing.lineNumbers, ...preview.lineNumbers];
          } else {
            allPreviews.push({ ...preview });
          }
        }
      }
    }

    setPreviews(allPreviews);
    setPreviewIdx(0);
    setScrollOffset(0);
    setLoadingPreview(false);
    setMode('confirm');
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

    if (mode === 'confirm') {
      if (applying) return;

      if (key.escape || input === 'q') {
        setMode('view');
        setPreviews([]);
      } else if (key.leftArrow) {
        setPreviewIdx((i) => Math.max(0, i - 1));
        setScrollOffset(0);
      } else if (key.rightArrow) {
        setPreviewIdx((i) => Math.min(previews.length - 1, i + 1));
        setScrollOffset(0);
      } else if (key.upArrow) {
        setScrollOffset((o) => Math.max(0, o - 1));
      } else if (key.downArrow) {
        setScrollOffset((o) => o + 1);
      } else if (input === 'y' || key.return) {
        handleConfirmApply();
      }
      return;
    }

    if (mode === 'view') {
      if (applying || loadingPreview) return;

      if (key.escape) {
        setMode('list');
        setSelectedTemplate(null);
      } else if (input === 'a' && selectedTemplate) {
        if (canDirectApply) {
          fetchPreview(selectedTemplate);
        } else {
          onApplyTemplate(selectedTemplate.rules);
        }
      } else if (input === 'd' && selectedTemplate) {
        handleDelete(selectedTemplate.id);
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

  const handleDelete = async (id: string) => {
    const result = await api.deleteTemplate(id);
    if (result.success) {
      setMode('list');
      setSelectedTemplate(null);
      fetchTemplates();
    } else {
      setError(result.error?.message || 'Failed to delete template');
    }
  };

  const handleConfirmApply = async () => {
    if (!canDirectApply || !selectedTemplate) return;

    setApplying(true);
    const result = await api.applyTemplate(selectedTemplate.id, selectedPaths);
    setApplying(false);

    if (result.success && result.data) {
      onDirectApply!(`Applied "${selectedTemplate.name}" to ${result.data.modified.length} files`);
    } else {
      setError(result.error?.message || 'Failed to apply template');
      setMode('view');
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

  if (mode === 'confirm') {
    if (loadingPreview) {
      return (
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> Generating preview...</Text>
        </Box>
      );
    }

    if (applying) {
      return (
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> Applying template...</Text>
        </Box>
      );
    }

    if (previews.length === 0) {
      return (
        <Box flexDirection="column">
          <Text bold>Preview Changes - {selectedTemplate?.name}</Text>
          <Box marginY={1}>
            <Text color="yellow">No changes found for the selected components.</Text>
          </Box>
          <Text color="gray">[q/Esc] Go back</Text>
        </Box>
      );
    }

    const preview = previews[previewIdx];
    const totalChanges = previews.reduce((sum, p) => sum + p.changes, 0);

    // Use line-level diff to show changes clearly
    const lineDiff = Diff.diffLines(preview.before, preview.after);

    // Build a list of changed line groups for display
    const changedGroups: Array<{ removed: string[]; added: string[]; lineNum: number }> = [];
    let lineNum = 1;
    let currentGroup: { removed: string[]; added: string[]; lineNum: number } | null = null;

    for (const part of lineDiff) {
      if (part.added || part.removed) {
        if (!currentGroup) {
          currentGroup = { removed: [], added: [], lineNum };
        }
        const lines = part.value.split('\n').filter(l => l.length > 0);
        if (part.removed) {
          currentGroup.removed.push(...lines);
        }
        if (part.added) {
          currentGroup.added.push(...lines);
        }
      } else {
        if (currentGroup) {
          changedGroups.push(currentGroup);
          currentGroup = null;
        }
        lineNum += part.value.split('\n').length - 1;
      }
    }
    if (currentGroup) {
      changedGroups.push(currentGroup);
    }

    const visibleGroups = 3;
    const displayGroups = changedGroups.slice(scrollOffset, scrollOffset + visibleGroups);

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Apply Template: </Text>
          <Text bold color="cyan">{selectedTemplate?.name}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="gray">
            {previewIdx + 1}/{previews.length} files | {totalChanges} total changes
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="cyan">{preview.path.split(/[/\\]/).pop()}</Text>
          <Text color="gray"> ({changedGroups.length} change locations)</Text>
        </Box>

        {error && (
          <Box marginBottom={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        <Box flexDirection="column" borderStyle="single" paddingX={1}>
          {scrollOffset > 0 && (
            <Text color="gray">↑ {scrollOffset} more above</Text>
          )}

          {displayGroups.length === 0 ? (
            <Text color="yellow">No visible changes in this file</Text>
          ) : (
            displayGroups.map((group, idx) => (
              <Box key={idx} flexDirection="column" marginBottom={1}>
                <Text color="gray">Line {group.lineNum}:</Text>
                {group.removed.map((line, i) => (
                  <Box key={`r${i}`}>
                    <Text color="red">- </Text>
                    <Text color="red">{line.trim().slice(0, 70)}</Text>
                    {line.trim().length > 70 && <Text color="gray">...</Text>}
                  </Box>
                ))}
                {group.added.map((line, i) => (
                  <Box key={`a${i}`}>
                    <Text color="green">+ </Text>
                    <Text color="green">{line.trim().slice(0, 70)}</Text>
                    {line.trim().length > 70 && <Text color="gray">...</Text>}
                  </Box>
                ))}
              </Box>
            ))
          )}

          {scrollOffset + visibleGroups < changedGroups.length && (
            <Text color="gray">↓ {changedGroups.length - scrollOffset - visibleGroups} more below</Text>
          )}
        </Box>

        <Box marginTop={1}>
          <Text color="gray">
            [←/→] Switch file | [↑/↓] Scroll | [y/Enter] Apply | [q/Esc] Cancel
          </Text>
        </Box>
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
    if (loadingPreview) {
      return (
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> Generating preview...</Text>
        </Box>
      );
    }

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

        {error && (
          <Box marginY={1}>
            <Text color="red">{error}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          {canDirectApply ? (
            <Text color="gray">[a] Preview & apply ({selectedPaths.length} files) | [d] Delete | [q/Esc] Back</Text>
          ) : (
            <Text color="gray">[a] Load into editor | [d] Delete | [q/Esc] Back</Text>
          )}
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
