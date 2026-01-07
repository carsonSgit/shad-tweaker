import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface EditorProps {
  selectedCount: number;
  onPreview: (find: string, replace: string, isRegex: boolean) => void;
  onCancel: () => void;
}

type Field = 'find' | 'replace';
type Mode = 'manual' | 'quick' | 'suboptions';

interface SubOption {
  label: string;
  value: string;
}

interface QuickActionCategory {
  label: string;
  description: string;
  type: 'select-from' | 'select-to' | 'simple';
  options?: SubOption[];
  // For simple actions (no sub-options)
  find?: string;
  replace?: string;
  isRegex?: boolean;
}

const QUICK_ACTION_CATEGORIES: QuickActionCategory[] = [
  {
    label: 'Change Border Radius',
    description: 'Update rounded-* classes',
    type: 'select-to',
    options: [
      { label: 'none (sharp corners)', value: 'rounded-none' },
      { label: 'sm (small)', value: 'rounded-sm' },
      { label: 'default', value: 'rounded' },
      { label: 'md (medium)', value: 'rounded-md' },
      { label: 'lg (large)', value: 'rounded-lg' },
      { label: 'xl (extra large)', value: 'rounded-xl' },
      { label: '2xl', value: 'rounded-2xl' },
      { label: '3xl', value: 'rounded-3xl' },
      { label: 'full (pill)', value: 'rounded-full' },
    ],
  },
  {
    label: 'Change Ring Size',
    description: 'Update ring-* classes',
    type: 'select-to',
    options: [
      { label: '0 (none)', value: 'ring-0' },
      { label: '1', value: 'ring-1' },
      { label: '2 (default)', value: 'ring-2' },
      { label: '4', value: 'ring-4' },
      { label: '8', value: 'ring-8' },
    ],
  },
  {
    label: 'Change Shadow',
    description: 'Update shadow-* classes',
    type: 'select-to',
    options: [
      { label: 'none', value: 'shadow-none' },
      { label: 'sm (small)', value: 'shadow-sm' },
      { label: 'default', value: 'shadow' },
      { label: 'md (medium)', value: 'shadow-md' },
      { label: 'lg (large)', value: 'shadow-lg' },
      { label: 'xl (extra large)', value: 'shadow-xl' },
      { label: '2xl', value: 'shadow-2xl' },
    ],
  },
  {
    label: 'Change Text Size',
    description: 'Update text-* size classes',
    type: 'select-to',
    options: [
      { label: 'xs (extra small)', value: 'text-xs' },
      { label: 'sm (small)', value: 'text-sm' },
      { label: 'base (default)', value: 'text-base' },
      { label: 'lg (large)', value: 'text-lg' },
      { label: 'xl', value: 'text-xl' },
      { label: '2xl', value: 'text-2xl' },
    ],
  },
  {
    label: 'Change Padding',
    description: 'Update p-* classes',
    type: 'select-to',
    options: [
      { label: '0 (none)', value: 'p-0' },
      { label: '1', value: 'p-1' },
      { label: '2', value: 'p-2' },
      { label: '3', value: 'p-3' },
      { label: '4', value: 'p-4' },
      { label: '5', value: 'p-5' },
      { label: '6', value: 'p-6' },
      { label: '8', value: 'p-8' },
    ],
  },
  {
    label: 'Remove Class',
    description: 'Remove specific classes',
    type: 'select-from',
    options: [
      { label: 'cursor-pointer', value: 'cursor-pointer' },
      { label: 'cursor-default', value: 'cursor-default' },
      { label: 'transition', value: 'transition' },
      { label: 'transition-all', value: 'transition-all' },
      { label: 'transition-colors', value: 'transition-colors' },
      { label: 'animate-pulse', value: 'animate-pulse' },
      { label: 'animate-spin', value: 'animate-spin' },
      { label: 'outline-none', value: 'outline-none' },
    ],
  },
  {
    label: 'Focus Behavior',
    description: 'Change focus style triggers',
    type: 'simple',
    find: 'focus:',
    replace: 'focus-visible:',
  },
  {
    label: 'Hover Behavior',
    description: 'Change hover style triggers',
    type: 'simple',
    find: 'hover:',
    replace: 'group-hover:',
  },
];

// Regex patterns for matching existing classes
const CLASS_PATTERNS: Record<string, string> = {
  'rounded-none': '\\brounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?\\b',
  'rounded-sm': '\\brounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?\\b',
  'rounded': '\\brounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?\\b',
  'rounded-md': '\\brounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?\\b',
  'rounded-lg': '\\brounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?\\b',
  'rounded-xl': '\\brounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?\\b',
  'rounded-2xl': '\\brounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?\\b',
  'rounded-3xl': '\\brounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?\\b',
  'rounded-full': '\\brounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?\\b',
  'ring-0': '\\bring(-0|-1|-2|-4|-8)?\\b',
  'ring-1': '\\bring(-0|-1|-2|-4|-8)?\\b',
  'ring-2': '\\bring(-0|-1|-2|-4|-8)?\\b',
  'ring-4': '\\bring(-0|-1|-2|-4|-8)?\\b',
  'ring-8': '\\bring(-0|-1|-2|-4|-8)?\\b',
  'shadow-none': '\\bshadow(-none|-sm|-md|-lg|-xl|-2xl)?\\b',
  'shadow-sm': '\\bshadow(-none|-sm|-md|-lg|-xl|-2xl)?\\b',
  'shadow': '\\bshadow(-none|-sm|-md|-lg|-xl|-2xl)?\\b',
  'shadow-md': '\\bshadow(-none|-sm|-md|-lg|-xl|-2xl)?\\b',
  'shadow-lg': '\\bshadow(-none|-sm|-md|-lg|-xl|-2xl)?\\b',
  'shadow-xl': '\\bshadow(-none|-sm|-md|-lg|-xl|-2xl)?\\b',
  'shadow-2xl': '\\bshadow(-none|-sm|-md|-lg|-xl|-2xl)?\\b',
  'text-xs': '\\btext-(xs|sm|base|lg|xl|2xl)\\b',
  'text-sm': '\\btext-(xs|sm|base|lg|xl|2xl)\\b',
  'text-base': '\\btext-(xs|sm|base|lg|xl|2xl)\\b',
  'text-lg': '\\btext-(xs|sm|base|lg|xl|2xl)\\b',
  'text-xl': '\\btext-(xs|sm|base|lg|xl|2xl)\\b',
  'text-2xl': '\\btext-(xs|sm|base|lg|xl|2xl)\\b',
  'p-0': '\\bp-(0|1|2|3|4|5|6|8)\\b',
  'p-1': '\\bp-(0|1|2|3|4|5|6|8)\\b',
  'p-2': '\\bp-(0|1|2|3|4|5|6|8)\\b',
  'p-3': '\\bp-(0|1|2|3|4|5|6|8)\\b',
  'p-4': '\\bp-(0|1|2|3|4|5|6|8)\\b',
  'p-5': '\\bp-(0|1|2|3|4|5|6|8)\\b',
  'p-6': '\\bp-(0|1|2|3|4|5|6|8)\\b',
  'p-8': '\\bp-(0|1|2|3|4|5|6|8)\\b',
};

export function Editor({ selectedCount, onPreview, onCancel }: EditorProps) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [activeField, setActiveField] = useState<Field>('find');
  const [error, setError] = useState<string | null>(null);

  // Menu state
  const [mode, setMode] = useState<Mode>('quick');
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [subOptionIndex, setSubOptionIndex] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<QuickActionCategory | null>(null);

  useInput((input, key) => {
    // Global escape handling
    if (key.escape || input === 'q') {
      if (mode === 'suboptions') {
        setMode('quick');
        setSelectedCategory(null);
        setSubOptionIndex(0);
      } else if (mode === 'manual') {
        setMode('quick');
      } else {
        onCancel();
      }
      return;
    }

    // Quick mode navigation
    if (mode === 'quick') {
      if (key.upArrow) {
        setCategoryIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setCategoryIndex((prev) => Math.min(QUICK_ACTION_CATEGORIES.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        const category = QUICK_ACTION_CATEGORIES[categoryIndex];
        if (category.type === 'simple') {
          // Direct action - no sub-options
          onPreview(category.find!, category.replace!, false);
        } else {
          // Has sub-options
          setSelectedCategory(category);
          setMode('suboptions');
          setSubOptionIndex(0);
        }
        return;
      }
      // 'm' for manual mode
      if (input === 'm') {
        setMode('manual');
        return;
      }
      // Number shortcuts for first 9 categories
      const num = parseInt(input);
      if (num >= 1 && num <= Math.min(9, QUICK_ACTION_CATEGORIES.length)) {
        const category = QUICK_ACTION_CATEGORIES[num - 1];
        if (category.type === 'simple') {
          onPreview(category.find!, category.replace!, false);
        } else {
          setSelectedCategory(category);
          setMode('suboptions');
          setSubOptionIndex(0);
        }
        return;
      }
    }

    // Sub-options mode navigation
    if (mode === 'suboptions' && selectedCategory?.options) {
      if (key.upArrow) {
        setSubOptionIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSubOptionIndex((prev) => Math.min(selectedCategory.options!.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        const option = selectedCategory.options[subOptionIndex];
        if (selectedCategory.type === 'select-from') {
          // Remove class - find the class, replace with empty
          onPreview(`\\s*${option.value}`, '', true);
        } else {
          // select-to - use regex pattern to find existing class and replace
          const pattern = CLASS_PATTERNS[option.value];
          if (pattern) {
            onPreview(pattern, option.value, true);
          } else {
            // Fallback to simple replacement
            onPreview(option.value, option.value, false);
          }
        }
        return;
      }
      // Number shortcuts
      const num = parseInt(input);
      if (num >= 1 && num <= Math.min(9, selectedCategory.options.length)) {
        const option = selectedCategory.options[num - 1];
        if (selectedCategory.type === 'select-from') {
          onPreview(`\\s*${option.value}`, '', true);
        } else {
          const pattern = CLASS_PATTERNS[option.value];
          if (pattern) {
            onPreview(pattern, option.value, true);
          }
        }
        return;
      }
    }

    // Manual mode handling
    if (mode === 'manual') {
      if (key.tab) {
        setActiveField((f) => (f === 'find' ? 'replace' : 'find'));
        return;
      }
      if (input === 'r' && key.ctrl) {
        setIsRegex((r) => !r);
        return;
      }
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

  // Render Quick Action Categories
  const renderQuickMode = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">Quick Actions</Text>
        <Text color="gray"> - Select a category</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {QUICK_ACTION_CATEGORIES.map((category, idx) => {
          const isCurrent = idx === categoryIndex;
          return (
            <Box key={idx}>
              <Text color={isCurrent ? 'cyan' : 'gray'}>{isCurrent ? '> ' : '  '}</Text>
              <Text color={isCurrent ? 'cyan' : 'white'} bold={isCurrent}>
                {idx + 1}. {category.label}
              </Text>
              <Text color="gray"> - {category.description}</Text>
              {category.type !== 'simple' && <Text color="yellow"> [...]</Text>}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">[1-{Math.min(9, QUICK_ACTION_CATEGORIES.length)}] Quick select | [Enter] Select | [m] Manual mode | [Esc] Cancel</Text>
      </Box>
    </Box>
  );

  // Render Sub-options for selected category
  const renderSubOptionsMode = () => {
    if (!selectedCategory?.options) return null;

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">{selectedCategory.label}</Text>
          <Text color="gray"> - {selectedCategory.type === 'select-from' ? 'Select class to remove' : 'Select target value'}</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          {selectedCategory.options.map((option, idx) => {
            const isCurrent = idx === subOptionIndex;
            return (
              <Box key={idx}>
                <Text color={isCurrent ? 'cyan' : 'gray'}>{isCurrent ? '> ' : '  '}</Text>
                <Text color={isCurrent ? 'cyan' : 'white'} bold={isCurrent}>
                  {idx + 1}. {option.value}
                </Text>
                <Text color="gray"> ({option.label})</Text>
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Text color="gray">[Enter] Apply | [1-9] Quick select | [Esc] Back</Text>
        </Box>
      </Box>
    );
  };

  // Render Manual Mode
  const renderManualMode = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">Manual Find & Replace</Text>
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

      <Box marginTop={1}>
        <Text color="gray">
          [Tab] Switch field | [Enter] Preview | [Ctrl+R] Toggle regex | [Esc] Back to quick actions
        </Text>
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Edit Mode</Text>
        <Text color="gray"> - {selectedCount} components selected</Text>
      </Box>

      {mode === 'quick' && renderQuickMode()}
      {mode === 'suboptions' && renderSubOptionsMode()}
      {mode === 'manual' && renderManualMode()}
    </Box>
  );
}
