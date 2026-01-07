import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { THEME, SYMBOLS } from '../App.js';

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
  icon: string;
  type: 'select-from' | 'select-to' | 'simple';
  options?: SubOption[];
  // For simple actions (no sub-options)
  find?: string;
  replace?: string;
  isRegex?: boolean;
}

const QUICK_ACTION_CATEGORIES: QuickActionCategory[] = [
  {
    label: 'Border Radius',
    description: 'Update rounded-* classes',
    icon: '',
    type: 'select-to',
    options: [
      { label: 'none (sharp)', value: 'rounded-none' },
      { label: 'sm (2px)', value: 'rounded-sm' },
      { label: 'default (4px)', value: 'rounded' },
      { label: 'md (6px)', value: 'rounded-md' },
      { label: 'lg (8px)', value: 'rounded-lg' },
      { label: 'xl (12px)', value: 'rounded-xl' },
      { label: '2xl (16px)', value: 'rounded-2xl' },
      { label: '3xl (24px)', value: 'rounded-3xl' },
      { label: 'full (pill)', value: 'rounded-full' },
    ],
  },
  {
    label: 'Ring Size',
    description: 'Focus ring width',
    icon: '',
    type: 'select-to',
    options: [
      { label: '0 (none)', value: 'ring-0' },
      { label: '1 (1px)', value: 'ring-1' },
      { label: '2 (2px)', value: 'ring-2' },
      { label: '4 (4px)', value: 'ring-4' },
      { label: '8 (8px)', value: 'ring-8' },
    ],
  },
  {
    label: 'Shadow',
    description: 'Update shadow depth',
    icon: '',
    type: 'select-to',
    options: [
      { label: 'none', value: 'shadow-none' },
      { label: 'sm (subtle)', value: 'shadow-sm' },
      { label: 'default', value: 'shadow' },
      { label: 'md (medium)', value: 'shadow-md' },
      { label: 'lg (large)', value: 'shadow-lg' },
      { label: 'xl (huge)', value: 'shadow-xl' },
      { label: '2xl', value: 'shadow-2xl' },
    ],
  },
  {
    label: 'Text Size',
    description: 'Typography scale',
    icon: '',
    type: 'select-to',
    options: [
      { label: 'xs (12px)', value: 'text-xs' },
      { label: 'sm (14px)', value: 'text-sm' },
      { label: 'base (16px)', value: 'text-base' },
      { label: 'lg (18px)', value: 'text-lg' },
      { label: 'xl (20px)', value: 'text-xl' },
      { label: '2xl (24px)', value: 'text-2xl' },
    ],
  },
  {
    label: 'Padding',
    description: 'Internal spacing',
    icon: '',
    type: 'select-to',
    options: [
      { label: '0 (none)', value: 'p-0' },
      { label: '1 (4px)', value: 'p-1' },
      { label: '2 (8px)', value: 'p-2' },
      { label: '3 (12px)', value: 'p-3' },
      { label: '4 (16px)', value: 'p-4' },
      { label: '5 (20px)', value: 'p-5' },
      { label: '6 (24px)', value: 'p-6' },
      { label: '8 (32px)', value: 'p-8' },
    ],
  },
  {
    label: 'Remove Class',
    description: 'Delete specific classes',
    icon: '',
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
    label: 'Focus to Focus-Visible',
    description: 'Better keyboard UX',
    icon: '',
    type: 'simple',
    find: 'focus:',
    replace: 'focus-visible:',
  },
  {
    label: 'Hover to Group-Hover',
    description: 'Parent-based hover',
    icon: '',
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
        <Text bold color={THEME.highlight}>{SYMBOLS.diamond} Quick Actions</Text>
        <Text color={THEME.muted}> ─ Select a modification</Text>
      </Box>

      <Box 
        flexDirection="column" 
        borderStyle="single" 
        borderColor={THEME.muted}
        paddingX={1}
        marginBottom={1}
      >
        {QUICK_ACTION_CATEGORIES.map((category, idx) => {
          const isCurrent = idx === categoryIndex;
          return (
            <Box key={idx}>
              <Box width={3}>
                <Text color={isCurrent ? THEME.primary : THEME.muted}>
                  {isCurrent ? SYMBOLS.arrow : ' '}
                </Text>
              </Box>
              <Box width={3}>
                <Text color={THEME.muted}>{idx + 1}.</Text>
              </Box>
              <Box width={24}>
                <Text color={isCurrent ? THEME.secondary : THEME.highlight} bold={isCurrent}>
                  {category.label}
                </Text>
              </Box>
              <Text color={THEME.muted}>{category.description}</Text>
              {category.type !== 'simple' && (
                <Text color={THEME.accent}> {SYMBOLS.arrow}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box justifyContent="center">
        <Text color={THEME.muted}>
          <Text color={THEME.secondary}>1-{Math.min(9, QUICK_ACTION_CATEGORIES.length)}</Text> Quick │{' '}
          <Text color={THEME.secondary}>↵</Text> Select │{' '}
          <Text color={THEME.secondary}>m</Text> Manual mode │{' '}
          <Text color={THEME.secondary}>Esc</Text> Cancel
        </Text>
      </Box>
    </Box>
  );

  // Render Sub-options for selected category
  const renderSubOptionsMode = () => {
    if (!selectedCategory?.options) return null;

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text>{selectedCategory.icon} </Text>
          <Text bold color={THEME.secondary}>{selectedCategory.label}</Text>
          <Text color={THEME.muted}> ─ {selectedCategory.type === 'select-from' ? 'Select to remove' : 'Select target value'}</Text>
        </Box>

        <Box 
          flexDirection="column" 
          borderStyle="single" 
          borderColor={THEME.secondary}
          paddingX={1}
          marginBottom={1}
        >
          {selectedCategory.options.map((option, idx) => {
            const isCurrent = idx === subOptionIndex;
            return (
              <Box key={idx}>
                <Box width={3}>
                  <Text color={isCurrent ? THEME.primary : THEME.muted}>
                    {isCurrent ? SYMBOLS.arrow : ' '}
                  </Text>
                </Box>
                <Box width={3}>
                  <Text color={THEME.muted}>{idx + 1}.</Text>
                </Box>
                <Box width={18}>
                  <Text color={isCurrent ? THEME.accent : THEME.highlight} bold={isCurrent}>
                    {option.value}
                  </Text>
                </Box>
                <Text color={THEME.muted}>({option.label})</Text>
              </Box>
            );
          })}
        </Box>

        <Box justifyContent="center">
          <Text color={THEME.muted}>
            <Text color={THEME.secondary}>↵</Text> Apply │{' '}
            <Text color={THEME.secondary}>1-9</Text> Quick │{' '}
            <Text color={THEME.secondary}>Esc</Text> Back
          </Text>
        </Box>
      </Box>
    );
  };

  // Render Manual Mode
  const renderManualMode = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={THEME.highlight}>{SYMBOLS.arrow} Manual Find & Replace</Text>
      </Box>

      {error && (
        <Box marginBottom={1} borderStyle="round" borderColor={THEME.error} paddingX={2}>
          <Text color={THEME.error}>{SYMBOLS.cross} {error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Box marginBottom={1}>
          <Box width={10}>
            <Text color={activeField === 'find' ? THEME.secondary : THEME.muted}>
              Find:
            </Text>
          </Box>
          <Box 
            borderStyle={activeField === 'find' ? 'round' : 'single'} 
            borderColor={activeField === 'find' ? THEME.secondary : THEME.muted}
            paddingX={1} 
            width={40}
          >
            {activeField === 'find' ? (
              <TextInput
                value={find}
                onChange={setFind}
                onSubmit={() => setActiveField('replace')}
              />
            ) : (
              <Text color={find ? THEME.highlight : THEME.muted}>{find || '(empty)'}</Text>
            )}
          </Box>
        </Box>

        <Box marginBottom={1}>
          <Box width={10}>
            <Text color={activeField === 'replace' ? THEME.secondary : THEME.muted}>
              Replace:
            </Text>
          </Box>
          <Box 
            borderStyle={activeField === 'replace' ? 'round' : 'single'} 
            borderColor={activeField === 'replace' ? THEME.secondary : THEME.muted}
            paddingX={1} 
            width={40}
          >
            {activeField === 'replace' ? (
              <TextInput
                value={replace}
                onChange={setReplace}
                onSubmit={handleSubmit}
              />
            ) : (
              <Text color={replace ? THEME.highlight : THEME.muted}>
                {replace || '(empty - will delete)'}
              </Text>
            )}
          </Box>
        </Box>

        <Box>
          <Box width={10} />
          <Text color={isRegex ? THEME.success : THEME.muted}>
            {isRegex ? SYMBOLS.check : SYMBOLS.circle} Regex mode
          </Text>
          <Text color={THEME.muted}> (Ctrl+R)</Text>
        </Box>
      </Box>

      <Box justifyContent="center">
        <Text color={THEME.muted}>
          <Text color={THEME.secondary}>Tab</Text> Switch │{' '}
          <Text color={THEME.secondary}>↵</Text> Preview │{' '}
          <Text color={THEME.secondary}>Ctrl+R</Text> Regex │{' '}
          <Text color={THEME.secondary}>Esc</Text> Back
        </Text>
      </Box>
    </Box>
  );

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1} borderStyle="round" borderColor={THEME.primary} paddingX={2}>
        <Text color={THEME.primary}>{SYMBOLS.diamond} Edit Mode</Text>
        <Text color={THEME.muted}> │ </Text>
        <Text color={THEME.accent}>{selectedCount}</Text>
        <Text color={THEME.muted}> components selected</Text>
      </Box>

      {mode === 'quick' && renderQuickMode()}
      {mode === 'suboptions' && renderSubOptionsMode()}
      {mode === 'manual' && renderManualMode()}
    </Box>
  );
}
