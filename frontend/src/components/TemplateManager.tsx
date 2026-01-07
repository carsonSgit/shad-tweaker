import * as Diff from 'diff';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { useEffect, useState } from 'react';
import { SYMBOLS, THEME } from '../App.js';
import * as api from '../api/client.js';
import type { Preview, Template, TemplateRule } from '../types/index.js';

interface TemplateManagerProps {
  onApplyTemplate: (rules: TemplateRule[]) => void;
  onBack: () => void;
  selectedPaths?: string[];
  onDirectApply?: (message: string) => void;
}

type Mode = 'list' | 'suboptions' | 'create' | 'view' | 'select-components' | 'confirm';

// ============================================
// Built-in Quick Templates with Sub-options
// ============================================

interface SubOption {
  label: string;
  value: string;
}

interface QuickTemplate {
  id: string;
  label: string;
  description: string;
  icon: string;
  type: 'select-to' | 'select-from' | 'simple';
  options?: SubOption[];
  find?: string;
  replace?: string;
  isRegex?: boolean;
}

// Helper function to generate class patterns
const createClassPattern = (prefix: string, values: string[]): Record<string, string> => {
  const pattern = `\\b${prefix}(-${values.join('|-')})?\\b`;
  return Object.fromEntries(values.map((value) => [`${prefix}-${value}`, pattern]));
};

// Regex patterns for matching existing classes
const CLASS_PATTERNS: Record<string, string> = {
  ...createClassPattern('rounded', ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full']),
  rounded: '\\brounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?\\b',
  ...createClassPattern('ring', ['0', '1', '2', '4', '8']),
  ...createClassPattern('shadow', ['none', 'sm', 'md', 'lg', 'xl', '2xl']),
  shadow: '\\bshadow(-none|-sm|-md|-lg|-xl|-2xl)?\\b',
  ...createClassPattern('text', ['xs', 'sm', 'base', 'lg', 'xl', '2xl']),
  ...createClassPattern('gap', ['0', '1', '2', '3', '4', '6', '8']),
  ...createClassPattern('p', ['0', '1', '2', '3', '4', '6', '8', '10', '12', '16', '20', '24']),
  ...createClassPattern('m', ['0', '1', '2', '3', '4', '6', '8', '10', '12', '16', '20', '24']),
  ...createClassPattern('font', [
    'thin',
    'extralight',
    'light',
    'normal',
    'medium',
    'semibold',
    'bold',
    'extrabold',
    'black',
  ]),
  'border-0': '\\bborder(-0|-2|-4|-8)?\\b(?!-)',
  border: '\\bborder(-0|-2|-4|-8)?\\b(?!-)',
  'border-2': '\\bborder(-0|-2|-4|-8)?\\b(?!-)',
  'border-4': '\\bborder(-0|-2|-4|-8)?\\b(?!-)',
  'border-8': '\\bborder(-0|-2|-4|-8)?\\b(?!-)',
  ...createClassPattern('opacity', [
    '0',
    '5',
    '10',
    '20',
    '25',
    '30',
    '40',
    '50',
    '60',
    '70',
    '75',
    '80',
    '90',
    '95',
    '100',
  ]),
  ...createClassPattern('duration', ['75', '100', '150', '200', '300', '500', '700', '1000']),
};

const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    id: 'quick-border-radius',
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
    id: 'quick-ring-size',
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
    id: 'quick-shadow',
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
    id: 'quick-text-size',
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
    id: 'quick-padding',
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
      { label: '6 (24px)', value: 'p-6' },
      { label: '8 (32px)', value: 'p-8' },
    ],
  },
  {
    id: 'quick-font-weight',
    label: 'Font Weight',
    description: 'Text boldness',
    icon: '',
    type: 'select-to',
    options: [
      { label: 'thin (100)', value: 'font-thin' },
      { label: 'light (300)', value: 'font-light' },
      { label: 'normal (400)', value: 'font-normal' },
      { label: 'medium (500)', value: 'font-medium' },
      { label: 'semibold (600)', value: 'font-semibold' },
      { label: 'bold (700)', value: 'font-bold' },
      { label: 'extrabold (800)', value: 'font-extrabold' },
    ],
  },
  {
    id: 'quick-remove-class',
    label: 'Remove Class',
    description: 'Delete specific classes',
    icon: '',
    type: 'select-from',
    options: [
      { label: 'Remove pointer cursor', value: 'cursor-pointer' },
      { label: 'Remove default cursor', value: 'cursor-default' },
      { label: 'Remove transition', value: 'transition' },
      { label: 'Remove transition-all', value: 'transition-all' },
      { label: 'Remove animate-pulse', value: 'animate-pulse' },
      { label: 'Remove outline-none', value: 'outline-none' },
    ],
  },
  {
    id: 'quick-focus-visible',
    label: 'Focus to Focus-Visible',
    description: 'Better keyboard UX',
    icon: '',
    type: 'simple',
    find: 'focus:',
    replace: 'focus-visible:',
  },
];

// Helper components
const LoadingSpinner = ({ message }: { message: string }) => (
  <Box borderStyle="round" borderColor={THEME.secondary} paddingX={2} paddingY={1}>
    <Text color={THEME.success}>
      <Spinner type="dots" />
    </Text>
    <Text> {message}</Text>
  </Box>
);

const ErrorMessage = ({ message }: { message: string | null }) =>
  message ? (
    <Box marginBottom={1} borderStyle="round" borderColor={THEME.error} paddingX={2}>
      <Text color={THEME.error}>
        {SYMBOLS.cross} {message}
      </Text>
    </Box>
  ) : null;

export function TemplateManager({
  onApplyTemplate,
  onBack,
  selectedPaths = [],
  onDirectApply,
}: TemplateManagerProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  const [cursor, setCursor] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  const [selectedQuickTemplate, setSelectedQuickTemplate] = useState<QuickTemplate | null>(null);
  const [subOptionCursor, setSubOptionCursor] = useState(0);

  const [previews, setPreviews] = useState<Preview[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [pendingRule, setPendingRule] = useState<TemplateRule | null>(null);

  const [internalSelectedPaths, setInternalSelectedPaths] = useState<Set<string>>(new Set());
  const [componentCursor, setComponentCursor] = useState(0);
  const [availableComponents, setAvailableComponents] = useState<
    Array<{ name: string; path: string }>
  >([]);

  const [newName, setNewName] = useState('');
  const [newFind, setNewFind] = useState('');
  const [newReplace, setNewReplace] = useState('');
  const [activeField, setActiveField] = useState<'name' | 'find' | 'replace'>('name');

  const canDirectApply = selectedPaths.length > 0 && onDirectApply;
  const totalQuickTemplates = QUICK_TEMPLATES.length;
  const allItems = [
    ...QUICK_TEMPLATES.map((qt) => ({ type: 'quick' as const, item: qt })),
    ...templates.map((t) => ({ type: 'user' as const, item: t })),
  ];

  const fetchComponents = async () => {
    const result = await api.getComponents();
    if (result.success && result.data) {
      setAvailableComponents(
        result.data.components.map((c: unknown) => {
          const comp = c as { name: string; path: string };
          return {
            name: comp.name,
            path: comp.path,
          };
        })
      );
    }
  };

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

  useEffect(() => {
    fetchTemplates();
    fetchComponents();
  }, []);

  const fetchPreviewForRule = async (rule: TemplateRule) => {
    const pathsToUse = Array.from(
      internalSelectedPaths.size > 0 ? internalSelectedPaths : new Set(selectedPaths)
    );

    if (pathsToUse.length === 0) {
      setError('No components selected');
      return;
    }

    setLoadingPreview(true);
    setError(null);
    setPendingRule(rule);

    const result = await api.previewEdit(pathsToUse, rule.find, rule.replace, rule.isRegex);

    if (result.success && result.data) {
      setPreviews(result.data.previews);
      setPreviewIdx(0);
      setScrollOffset(0);
      setMode('confirm');
    } else {
      setError(result.error?.message || 'Failed to generate preview');
    }
    setLoadingPreview(false);
  };

  const fetchPreview = async (template: Template) => {
    setLoadingPreview(true);
    setError(null);

    const allPreviews: Preview[] = [];

    for (const rule of template.rules) {
      const result = await api.previewEdit(selectedPaths, rule.find, rule.replace, rule.isRegex);
      if (result.success && result.data) {
        for (const preview of result.data.previews) {
          const existing = allPreviews.find((p) => p.path === preview.path);
          if (existing) {
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

  const handleQuickTemplateSelect = (qt: QuickTemplate) => {
    if (qt.type === 'simple') {
      const rule: TemplateRule = {
        find: qt.find!,
        replace: qt.replace!,
        isRegex: qt.isRegex || false,
      };
      setSelectedQuickTemplate(qt);
      setPendingRule(rule);
      setMode('select-components');
      setComponentCursor(0);

      if (selectedPaths.length > 0) {
        setInternalSelectedPaths(new Set(selectedPaths));
      }
    } else {
      setSelectedQuickTemplate(qt);
      setSubOptionCursor(0);
      setMode('suboptions');
    }
  };

  const handleSubOptionSelect = (option: SubOption) => {
    if (!selectedQuickTemplate) return;

    let rule: TemplateRule;

    if (selectedQuickTemplate.type === 'select-from') {
      rule = {
        find: `\\s*${option.value}`,
        replace: '',
        isRegex: true,
      };
    } else {
      const pattern = CLASS_PATTERNS[option.value];
      rule = {
        find: pattern || option.value,
        replace: option.value,
        isRegex: !!pattern,
      };
    }

    setPendingRule(rule);
    setMode('select-components');
    setComponentCursor(0);

    if (selectedPaths.length > 0) {
      setInternalSelectedPaths(new Set(selectedPaths));
    }
  };

  useInput((input, key) => {
    if (mode === 'select-components') {
      if (key.escape || input === 'q') {
        setMode('list');
        setSelectedQuickTemplate(null);
        setPendingRule(null);
        setInternalSelectedPaths(new Set());
        return;
      }
      if (key.upArrow) {
        setComponentCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setComponentCursor((c) => Math.min(availableComponents.length - 1, c + 1));
        return;
      }
      if (input === ' ') {
        const component = availableComponents[componentCursor];
        if (component) {
          setInternalSelectedPaths((prev) => {
            const next = new Set(prev);
            if (next.has(component.path)) {
              next.delete(component.path);
            } else {
              next.add(component.path);
            }
            return next;
          });
        }
        return;
      }
      if (input === 'a') {
        setInternalSelectedPaths(new Set(availableComponents.map((c) => c.path)));
        return;
      }
      if (input === 'n') {
        setInternalSelectedPaths(new Set());
        return;
      }
      if (key.return || input === 'c') {
        if (internalSelectedPaths.size === 0) {
          setError('Please select at least one component');
          return;
        }
        if (pendingRule) {
          fetchPreviewForRule(pendingRule);
        }
        return;
      }
      return;
    }

    if (mode === 'suboptions' && selectedQuickTemplate?.options) {
      if (key.escape || input === 'q') {
        setMode('list');
        setSelectedQuickTemplate(null);
        return;
      }
      if (key.upArrow) {
        setSubOptionCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow) {
        setSubOptionCursor((c) => Math.min(selectedQuickTemplate.options?.length - 1, c + 1));
        return;
      }
      if (key.return) {
        handleSubOptionSelect(selectedQuickTemplate.options[subOptionCursor]);
        return;
      }
      const num = parseInt(input, 10);
      if (num >= 1 && num <= Math.min(9, selectedQuickTemplate.options.length)) {
        handleSubOptionSelect(selectedQuickTemplate.options[num - 1]);
        return;
      }
      return;
    }

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
        setMode('list');
        setPreviews([]);
        setSelectedQuickTemplate(null);
        setPendingRule(null);
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
      setCursor((c) => Math.min(allItems.length - 1, c + 1));
    } else if (key.return) {
      const selected = allItems[cursor];
      if (selected) {
        if (selected.type === 'quick') {
          handleQuickTemplateSelect(selected.item as QuickTemplate);
        } else {
          setSelectedTemplate(selected.item as Template);
          setMode('view');
        }
      }
    } else if (input === 'n') {
      setMode('create');
      setNewName('');
      setNewFind('');
      setNewReplace('');
      setActiveField('name');
    }
    const num = parseInt(input, 10);
    if (num >= 1 && num <= Math.min(9, totalQuickTemplates)) {
      handleQuickTemplateSelect(QUICK_TEMPLATES[num - 1]);
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
    const pathsToUse = Array.from(
      internalSelectedPaths.size > 0 ? internalSelectedPaths : new Set(selectedPaths)
    );

    setApplying(true);

    if (pendingRule) {
      const result = await api.applyEdit(
        pathsToUse,
        pendingRule.find,
        pendingRule.replace,
        pendingRule.isRegex
      );
      setApplying(false);

      if (result.success && result.data) {
        const label = selectedQuickTemplate?.label || 'Quick action';
        if (onDirectApply) {
          onDirectApply(`Applied "${label}" to ${result.data.modified.length} files`);
        } else {
          setMode('list');
        }
      } else {
        setError(result.error?.message || 'Failed to apply changes');
        setMode('list');
      }
    } else if (selectedTemplate) {
      const result = await api.applyTemplate(selectedTemplate.id, pathsToUse);
      setApplying(false);

      if (result.success && result.data) {
        if (onDirectApply) {
          onDirectApply(
            `Applied "${selectedTemplate.name}" to ${result.data.modified.length} files`
          );
        } else {
          setMode('view');
        }
      } else {
        setError(result.error?.message || 'Failed to apply template');
        setMode('view');
      }
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading templates..." />;
  }

  // Sub-options mode
  if (mode === 'suboptions' && selectedQuickTemplate?.options) {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text>{selectedQuickTemplate.icon} </Text>
          <Text bold color={THEME.secondary}>
            {selectedQuickTemplate.label}
          </Text>
          <Text color={THEME.muted}> ─ Select target value</Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={THEME.secondary}
          paddingX={1}
          marginBottom={1}
        >
          {selectedQuickTemplate.options.map((option, idx) => {
            const isCurrent = idx === subOptionCursor;
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
            <Text color={THEME.secondary}>1-9</Text> Quick │ <Text color={THEME.secondary}>↵</Text>{' '}
            Next: Select Components │ <Text color={THEME.secondary}>Esc</Text> Back
          </Text>
        </Box>
      </Box>
    );
  }

  // Component selection mode
  if (mode === 'select-components') {
    const visibleCount = 8;
    const startIdx = Math.max(
      0,
      Math.min(componentCursor - 3, availableComponents.length - visibleCount)
    );
    const visibleComponents = availableComponents.slice(startIdx, startIdx + visibleCount);

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text>{SYMBOLS.diamond} </Text>
          <Text bold color={THEME.secondary}>
            {selectedQuickTemplate?.label || 'Action'}
          </Text>
          <Text color={THEME.muted}> ─ Select components</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color={internalSelectedPaths.size > 0 ? THEME.success : THEME.muted}>
            {SYMBOLS.check} {internalSelectedPaths.size}
          </Text>
          <Text color={THEME.muted}> / {availableComponents.length} selected</Text>
        </Box>

        <ErrorMessage message={error} />

        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={THEME.muted}
          paddingX={1}
          marginBottom={1}
        >
          {startIdx > 0 && (
            <Box justifyContent="center">
              <Text color={THEME.muted}>↑ {startIdx} more</Text>
            </Box>
          )}

          {visibleComponents.map((component, idx) => {
            const actualIdx = startIdx + idx;
            const isSelected = internalSelectedPaths.has(component.path);
            const isCursor = actualIdx === componentCursor;

            return (
              <Box key={component.path}>
                <Box width={3}>
                  <Text color={isCursor ? THEME.primary : THEME.muted}>
                    {isCursor ? SYMBOLS.arrow : ' '}
                  </Text>
                </Box>
                <Box width={4}>
                  <Text color={isSelected ? THEME.success : THEME.muted}>
                    {isSelected ? SYMBOLS.check : SYMBOLS.circle}
                  </Text>
                </Box>
                <Text
                  color={isCursor ? THEME.secondary : isSelected ? THEME.success : THEME.highlight}
                  bold={isCursor}
                >
                  {component.name}
                </Text>
              </Box>
            );
          })}

          {startIdx + visibleCount < availableComponents.length && (
            <Box justifyContent="center">
              <Text color={THEME.muted}>
                ↓ {availableComponents.length - startIdx - visibleCount} more
              </Text>
            </Box>
          )}
        </Box>

        {/* Confirm Button */}
        <Box
          borderStyle="round"
          borderColor={internalSelectedPaths.size > 0 ? THEME.success : THEME.muted}
          paddingX={2}
          justifyContent="center"
          marginBottom={1}
        >
          {internalSelectedPaths.size > 0 ? (
            <Text color={THEME.success}>
              Press <Text bold>c</Text> or <Text bold>↵</Text> to preview (
              {internalSelectedPaths.size} selected)
            </Text>
          ) : (
            <Text color={THEME.muted}>Select at least 1 component</Text>
          )}
        </Box>

        <Box justifyContent="center">
          <Text color={THEME.muted}>
            <Text color={THEME.secondary}>Space</Text> Toggle │{' '}
            <Text color={THEME.secondary}>a</Text> All │ <Text color={THEME.secondary}>n</Text> None
            │ <Text color={THEME.secondary}>Esc</Text> Back
          </Text>
        </Box>
      </Box>
    );
  }

  // Confirm mode
  if (mode === 'confirm') {
    if (loadingPreview) {
      return <LoadingSpinner message="Generating preview..." />;
    }

    if (applying) {
      return <LoadingSpinner message="Applying changes..." />;
    }

    if (previews.length === 0) {
      return (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color={THEME.highlight}>
              {SYMBOLS.diamond} Preview Changes
            </Text>
          </Box>
          <Box borderStyle="round" borderColor={THEME.accent} paddingX={2} paddingY={1}>
            <Text color={THEME.accent}>
              {SYMBOLS.diamond} No changes found for the selected components
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color={THEME.muted}>Press </Text>
            <Text color={THEME.secondary}>q/Esc</Text>
            <Text color={THEME.muted}> to go back</Text>
          </Box>
        </Box>
      );
    }

    const preview = previews[previewIdx];
    const totalChanges = previews.reduce((sum, p) => sum + p.changes, 0);
    const templateName = selectedQuickTemplate?.label || selectedTemplate?.name || 'Changes';

    const lineDiff = Diff.diffLines(preview.before, preview.after);
    const changedGroups: Array<{ removed: string[]; added: string[]; lineNum: number }> = [];
    let lineNum = 1;
    let currentGroup: { removed: string[]; added: string[]; lineNum: number } | null = null;

    for (const part of lineDiff) {
      if (part.added || part.removed) {
        if (!currentGroup) {
          currentGroup = { removed: [], added: [], lineNum };
        }
        const lines = part.value.split('\n').filter((l) => l.length > 0);
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
          <Text bold color={THEME.highlight}>
            {SYMBOLS.diamond} Apply:{' '}
          </Text>
          <Text bold color={THEME.secondary}>
            {templateName}
          </Text>
        </Box>

        <Box marginBottom={1} justifyContent="space-between">
          <Box>
            <Text color={THEME.secondary}>{previewIdx + 1}</Text>
            <Text color={THEME.muted}>/{previews.length} files</Text>
          </Box>
          <Box>
            <Text color={THEME.success}>+{totalChanges}</Text>
            <Text color={THEME.muted}> changes</Text>
          </Box>
        </Box>

        <Box marginBottom={1}>
          <Text color={THEME.accent}>
            {SYMBOLS.arrow} {preview.path.split(/[/\\]/).pop()}
          </Text>
        </Box>

        <ErrorMessage message={error} />

        <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
          {scrollOffset > 0 && (
            <Box justifyContent="center">
              <Text color={THEME.muted}>↑ {scrollOffset} more</Text>
            </Box>
          )}

          {displayGroups.length === 0 ? (
            <Text color={THEME.accent}>No visible changes</Text>
          ) : (
            displayGroups.map((group, idx) => (
              <Box key={idx} flexDirection="column" marginBottom={1}>
                <Text color={THEME.muted}>Line {group.lineNum}:</Text>
                {group.removed.map((line, i) => (
                  <Box key={`r${i}`}>
                    <Text color={THEME.error}>- {line.trim().slice(0, 55)}</Text>
                    {line.trim().length > 55 && <Text color={THEME.muted}>...</Text>}
                  </Box>
                ))}
                {group.added.map((line, i) => (
                  <Box key={`a${i}`}>
                    <Text color={THEME.success}>+ {line.trim().slice(0, 55)}</Text>
                    {line.trim().length > 55 && <Text color={THEME.muted}>...</Text>}
                  </Box>
                ))}
              </Box>
            ))
          )}

          {scrollOffset + visibleGroups < changedGroups.length && (
            <Box justifyContent="center">
              <Text color={THEME.muted}>
                ↓ {changedGroups.length - scrollOffset - visibleGroups} more
              </Text>
            </Box>
          )}
        </Box>

        <Box
          marginTop={1}
          borderStyle="round"
          borderColor={THEME.success}
          paddingX={2}
          justifyContent="center"
        >
          <Text color={THEME.success}>
            Press <Text bold>y</Text> or <Text bold>↵</Text> to apply
          </Text>
        </Box>

        <Box marginTop={1} justifyContent="center">
          <Text color={THEME.muted}>
            <Text color={THEME.secondary}>←/→</Text> File │ <Text color={THEME.secondary}>↑/↓</Text>{' '}
            Scroll │ <Text color={THEME.secondary}>Esc</Text> Cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // Create mode
  if (mode === 'create') {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color={THEME.highlight}>
            {SYMBOLS.diamond} Create New Template
          </Text>
        </Box>

        <ErrorMessage message={error} />

        <Box flexDirection="column" marginBottom={1}>
          <Box marginBottom={1}>
            <Box width={10}>
              <Text color={activeField === 'name' ? THEME.secondary : THEME.muted}>Name:</Text>
            </Box>
            <Box
              borderStyle={activeField === 'name' ? 'round' : 'single'}
              borderColor={activeField === 'name' ? THEME.secondary : THEME.muted}
              paddingX={1}
              width={35}
            >
              {activeField === 'name' ? (
                <TextInput
                  value={newName}
                  onChange={setNewName}
                  onSubmit={() => setActiveField('find')}
                />
              ) : (
                <Text color={newName ? THEME.highlight : THEME.muted}>{newName || '(empty)'}</Text>
              )}
            </Box>
          </Box>

          <Box marginBottom={1}>
            <Box width={10}>
              <Text color={activeField === 'find' ? THEME.secondary : THEME.muted}>Find:</Text>
            </Box>
            <Box
              borderStyle={activeField === 'find' ? 'round' : 'single'}
              borderColor={activeField === 'find' ? THEME.secondary : THEME.muted}
              paddingX={1}
              width={35}
            >
              {activeField === 'find' ? (
                <TextInput
                  value={newFind}
                  onChange={setNewFind}
                  onSubmit={() => setActiveField('replace')}
                />
              ) : (
                <Text color={newFind ? THEME.highlight : THEME.muted}>{newFind || '(empty)'}</Text>
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
              width={35}
            >
              {activeField === 'replace' ? (
                <TextInput
                  value={newReplace}
                  onChange={setNewReplace}
                  onSubmit={handleCreateSubmit}
                />
              ) : (
                <Text color={newReplace ? THEME.highlight : THEME.muted}>
                  {newReplace || '(empty)'}
                </Text>
              )}
            </Box>
          </Box>
        </Box>

        <Box justifyContent="center">
          <Text color={THEME.muted}>
            <Text color={THEME.secondary}>Tab</Text> Next │ <Text color={THEME.secondary}>↵</Text>{' '}
            Save │ <Text color={THEME.secondary}>Esc</Text> Cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // View mode
  if (mode === 'view' && selectedTemplate) {
    if (loadingPreview) {
      return <LoadingSpinner message="Generating preview..." />;
    }

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color={THEME.secondary}>
            {SYMBOLS.diamond} {selectedTemplate.name}
          </Text>
        </Box>
        <Text color={THEME.muted}>
          Created: {new Date(selectedTemplate.created).toLocaleString()}
        </Text>

        <Box marginY={1} flexDirection="column">
          <Text bold color={THEME.highlight}>
            Rules:
          </Text>
          {selectedTemplate.rules.map((rule, idx) => (
            <Box key={idx} flexDirection="column" marginLeft={2} marginTop={0}>
              <Box>
                <Text color={THEME.muted}>Find: </Text>
                <Text color={THEME.accent}>{rule.find}</Text>
              </Box>
              <Box>
                <Text color={THEME.muted}>Replace: </Text>
                <Text color={THEME.success}>{rule.replace || '(delete)'}</Text>
              </Box>
              {rule.isRegex && <Text color={THEME.muted}>(regex)</Text>}
            </Box>
          ))}
        </Box>

        <ErrorMessage message={error} />

        <Box justifyContent="center">
          <Text color={THEME.muted}>
            {canDirectApply ? (
              <>
                <Text color={THEME.secondary}>a</Text> Apply ({selectedPaths.length} files) │{' '}
              </>
            ) : (
              <>
                <Text color={THEME.secondary}>a</Text> Load │{' '}
              </>
            )}
            <Text color={THEME.secondary}>d</Text> Delete │{' '}
            <Text color={THEME.secondary}>q/Esc</Text> Back
          </Text>
        </Box>
      </Box>
    );
  }

  // Main list view
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={THEME.highlight}>
          {SYMBOLS.diamond} Template Manager
        </Text>
        {canDirectApply && (
          <Text color={THEME.success}> ({selectedPaths.length} components selected)</Text>
        )}
      </Box>

      <ErrorMessage message={error} />

      {/* Quick Templates Section */}
      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={0}>
          <Text color={THEME.accent}>{SYMBOLS.arrow} Quick Actions</Text>
        </Box>
        <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
          {QUICK_TEMPLATES.map((qt, idx) => {
            const isCurrent = idx === cursor;
            return (
              <Box key={qt.id}>
                <Box width={3}>
                  <Text color={isCurrent ? THEME.primary : THEME.muted}>
                    {isCurrent ? SYMBOLS.arrow : ' '}
                  </Text>
                </Box>
                <Box width={3}>
                  <Text color={THEME.muted}>{idx + 1}.</Text>
                </Box>
                <Box width={22}>
                  <Text color={isCurrent ? THEME.secondary : THEME.highlight} bold={isCurrent}>
                    {qt.label}
                  </Text>
                </Box>
                <Text color={THEME.muted}>{qt.description}</Text>
                {qt.type !== 'simple' && <Text color={THEME.accent}> {SYMBOLS.arrow}</Text>}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* User Templates Section */}
      <Box marginBottom={1} flexDirection="column">
        <Box marginBottom={0}>
          <Text color={THEME.accent}>{SYMBOLS.arrow} Saved Templates</Text>
        </Box>
        <Box flexDirection="column" borderStyle="single" borderColor={THEME.muted} paddingX={1}>
          {templates.length === 0 ? (
            <Text color={THEME.muted}>
              No saved templates. Press <Text color={THEME.secondary}>n</Text> to create one.
            </Text>
          ) : (
            templates.map((template, idx) => {
              const listIdx = totalQuickTemplates + idx;
              const isCurrent = listIdx === cursor;
              return (
                <Box key={template.id}>
                  <Box width={3}>
                    <Text color={isCurrent ? THEME.primary : THEME.muted}>
                      {isCurrent ? SYMBOLS.arrow : ' '}
                    </Text>
                  </Box>
                  <Text color={isCurrent ? THEME.secondary : THEME.highlight} bold={isCurrent}>
                    {template.name}
                  </Text>
                  <Text color={THEME.muted}> ({template.rules.length} rules)</Text>
                </Box>
              );
            })
          )}
        </Box>
      </Box>

      <Box justifyContent="center">
        <Text color={THEME.muted}>
          <Text color={THEME.secondary}>1-{Math.min(9, totalQuickTemplates)}</Text> Quick │{' '}
          <Text color={THEME.secondary}>↵</Text> Select │ <Text color={THEME.secondary}>n</Text> New
          │ <Text color={THEME.secondary}>Esc</Text> Back
        </Text>
      </Box>
    </Box>
  );
}
