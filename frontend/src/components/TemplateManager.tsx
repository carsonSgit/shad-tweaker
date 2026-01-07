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
  type: 'select-to' | 'select-from' | 'simple';
  options?: SubOption[];
  // For simple templates
  find?: string;
  replace?: string;
  isRegex?: boolean;
}

// Helper function to generate class patterns
const createClassPattern = (prefix: string, values: string[]): Record<string, string> => {
  const pattern = `\\b${prefix}(-${values.join('|-')})?\\b`;
  return Object.fromEntries(
    values.map(value => [`${prefix}-${value}`, pattern])
  );
};

// Helper for classes without suffix variants
const createSimplePattern = (prefix: string, suffix: string): string => {
  return `\\b${prefix}${suffix}\\b`;
};

// Regex patterns for matching existing classes
const CLASS_PATTERNS: Record<string, string> = {
  // Border Radius
  ...createClassPattern('rounded', ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full']),
  'rounded': '\\brounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?\\b',
  
  // Ring
  ...createClassPattern('ring', ['0', '1', '2', '4', '8']),
  
  // Shadow
  ...createClassPattern('shadow', ['none', 'sm', 'md', 'lg', 'xl', '2xl']),
  'shadow': '\\bshadow(-none|-sm|-md|-lg|-xl|-2xl)?\\b',
  
  // Text Size
  ...createClassPattern('text', ['xs', 'sm', 'base', 'lg', 'xl', '2xl']),
  
  // Gap
  ...createClassPattern('gap', ['0', '1', '2', '3', '4', '6', '8']),
  
  // Padding
  ...createClassPattern('p', ['0', '1', '2', '3', '4', '6', '8', '10', '12', '16', '20', '24']),
  
  // Margin
  ...createClassPattern('m', ['0', '1', '2', '3', '4', '6', '8', '10', '12', '16', '20', '24']),
  
  // Font Weight
  ...createClassPattern('font', ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black']),
  
  // Border Width
  'border-0': '\\bborder(-0|-2|-4|-8)?\\b(?!-)',
  'border': '\\bborder(-0|-2|-4|-8)?\\b(?!-)',
  'border-2': '\\bborder(-0|-2|-4|-8)?\\b(?!-)',
  'border-4': '\\bborder(-0|-2|-4|-8)?\\b(?!-)',
  'border-8': '\\bborder(-0|-2|-4|-8)?\\b(?!-)',
  
  // Opacity
  ...createClassPattern('opacity', ['0', '5', '10', '20', '25', '30', '40', '50', '60', '70', '75', '80', '90', '95', '100']),
  
  // Duration
  ...createClassPattern('duration', ['75', '100', '150', '200', '300', '500', '700', '1000']),
};

const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    id: 'quick-border-radius',
    label: 'Change Border Radius',
    description: 'Update rounded-* classes',
    type: 'select-to',
    options: [
      { label: 'none (sharp corners)', value: 'rounded-none' },
      { label: 'sm (2px)', value: 'rounded-sm' },
      { label: 'default (4px)', value: 'rounded' },
      { label: 'md (6px)', value: 'rounded-md' },
      { label: 'lg (8px)', value: 'rounded-lg' },
      { label: 'xl (12px)', value: 'rounded-xl' },
      { label: '2xl (16px)', value: 'rounded-2xl' },
      { label: '3xl (24px)', value: 'rounded-3xl' },
      { label: 'full (pill/circle)', value: 'rounded-full' },
    ],
  },
  {
    id: 'quick-ring-size',
    label: 'Change Ring Size',
    description: 'Update focus ring width',
    type: 'select-to',
    options: [
      { label: '0 (none)', value: 'ring-0' },
      { label: '1 (1px)', value: 'ring-1' },
      { label: '2 (2px, default)', value: 'ring-2' },
      { label: '4 (4px)', value: 'ring-4' },
      { label: '8 (8px)', value: 'ring-8' },
    ],
  },
  {
    id: 'quick-shadow',
    label: 'Change Shadow',
    description: 'Update shadow-* classes',
    type: 'select-to',
    options: [
      { label: 'none', value: 'shadow-none' },
      { label: 'sm (subtle)', value: 'shadow-sm' },
      { label: 'default', value: 'shadow' },
      { label: 'md (medium)', value: 'shadow-md' },
      { label: 'lg (large)', value: 'shadow-lg' },
      { label: 'xl (extra large)', value: 'shadow-xl' },
      { label: '2xl (huge)', value: 'shadow-2xl' },
    ],
  },
  {
    id: 'quick-text-size',
    label: 'Change Text Size',
    description: 'Update text size classes',
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
    id: 'quick-gap',
    label: 'Change Gap/Spacing',
    description: 'Update gap-* classes',
    type: 'select-to',
    options: [
      { label: '0 (none)', value: 'gap-0' },
      { label: '1 (4px)', value: 'gap-1' },
      { label: '2 (8px)', value: 'gap-2' },
      { label: '3 (12px)', value: 'gap-3' },
      { label: '4 (16px)', value: 'gap-4' },
      { label: '6 (24px)', value: 'gap-6' },
      { label: '8 (32px)', value: 'gap-8' },
    ],
  },
  {
    id: 'quick-padding',
    label: 'Change Padding',
    description: 'Update p-*/px-*/py-* classes',
    type: 'select-to',
    options: [
      { label: '0 (none)', value: 'p-0' },
      { label: '1 (4px)', value: 'p-1' },
      { label: '2 (8px)', value: 'p-2' },
      { label: '3 (12px)', value: 'p-3' },
      { label: '4 (16px)', value: 'p-4' },
      { label: '6 (24px)', value: 'p-6' },
      { label: '8 (32px)', value: 'p-8' },
      { label: '10 (40px)', value: 'p-10' },
      { label: '12 (48px)', value: 'p-12' },
    ],
  },
  {
    id: 'quick-margin',
    label: 'Change Margin',
    description: 'Update m-*/mx-*/my-* classes',
    type: 'select-to',
    options: [
      { label: '0 (none)', value: 'm-0' },
      { label: '1 (4px)', value: 'm-1' },
      { label: '2 (8px)', value: 'm-2' },
      { label: '3 (12px)', value: 'm-3' },
      { label: '4 (16px)', value: 'm-4' },
      { label: '6 (24px)', value: 'm-6' },
      { label: '8 (32px)', value: 'm-8' },
      { label: '10 (40px)', value: 'm-10' },
      { label: '12 (48px)', value: 'm-12' },
    ],
  },
  {
    id: 'quick-font-weight',
    label: 'Change Font Weight',
    description: 'Update font weight classes',
    type: 'select-to',
    options: [
      { label: 'thin (100)', value: 'font-thin' },
      { label: 'extralight (200)', value: 'font-extralight' },
      { label: 'light (300)', value: 'font-light' },
      { label: 'normal (400)', value: 'font-normal' },
      { label: 'medium (500)', value: 'font-medium' },
      { label: 'semibold (600)', value: 'font-semibold' },
      { label: 'bold (700)', value: 'font-bold' },
      { label: 'extrabold (800)', value: 'font-extrabold' },
      { label: 'black (900)', value: 'font-black' },
    ],
  },
  {
    id: 'quick-border-width',
    label: 'Change Border Width',
    description: 'Update border-* width classes',
    type: 'select-to',
    options: [
      { label: '0 (none)', value: 'border-0' },
      { label: 'default (1px)', value: 'border' },
      { label: '2 (2px)', value: 'border-2' },
      { label: '4 (4px)', value: 'border-4' },
      { label: '8 (8px)', value: 'border-8' },
    ],
  },
  {
    id: 'quick-opacity',
    label: 'Change Opacity',
    description: 'Update opacity-* classes',
    type: 'select-to',
    options: [
      { label: '0 (invisible)', value: 'opacity-0' },
      { label: '5', value: 'opacity-5' },
      { label: '10', value: 'opacity-10' },
      { label: '20', value: 'opacity-20' },
      { label: '25', value: 'opacity-25' },
      { label: '50 (half)', value: 'opacity-50' },
      { label: '75', value: 'opacity-75' },
      { label: '90', value: 'opacity-90' },
      { label: '100 (full)', value: 'opacity-100' },
    ],
  },
  {
    id: 'quick-transition-duration',
    label: 'Change Transition Duration',
    description: 'Update duration-* classes',
    type: 'select-to',
    options: [
      { label: '75ms', value: 'duration-75' },
      { label: '100ms', value: 'duration-100' },
      { label: '150ms (default)', value: 'duration-150' },
      { label: '200ms', value: 'duration-200' },
      { label: '300ms', value: 'duration-300' },
      { label: '500ms', value: 'duration-500' },
      { label: '700ms', value: 'duration-700' },
      { label: '1000ms', value: 'duration-1000' },
    ],
  },
  {
    id: 'quick-remove-class',
    label: 'Remove Class',
    description: 'Remove specific Tailwind classes',
    type: 'select-from',
    options: [
      { label: 'Remove pointer cursor', value: 'cursor-pointer' },
      { label: 'Remove default cursor', value: 'cursor-default' },
      { label: 'Remove transition', value: 'transition' },
      { label: 'Remove transition-all', value: 'transition-all' },
      { label: 'Remove transition-colors', value: 'transition-colors' },
      { label: 'Remove animate-pulse', value: 'animate-pulse' },
      { label: 'Remove animate-spin', value: 'animate-spin' },
      { label: 'Remove outline-none', value: 'outline-none' },
      { label: 'Remove pointer-events-none', value: 'pointer-events-none' },
      { label: 'Remove select-none', value: 'select-none' },
      { label: 'Remove all shadows', value: 'shadow(-none|-sm|-md|-lg|-xl|-2xl)?' },
    ],
  },
  {
    id: 'quick-focus-visible',
    label: 'Use focus-visible',
    description: 'Change focus: to focus-visible:',
    type: 'simple',
    find: 'focus:',
    replace: 'focus-visible:',
  },
  {
    id: 'quick-group-hover',
    label: 'Use group-hover',
    description: 'Change hover: to group-hover:',
    type: 'simple',
    find: 'hover:',
    replace: 'group-hover:',
  },
  {
    id: 'quick-peer-focus',
    label: 'Use peer-focus',
    description: 'Change focus: to peer-focus:',
    type: 'simple',
    find: 'focus:',
    replace: 'peer-focus:',
  },
  {
    id: 'quick-add-dark-mode',
    label: 'Add Dark Mode Classes',
    description: 'Duplicate classes with dark: prefix',
    type: 'simple',
    find: 'bg-',
    replace: 'bg- dark:bg-',
  },
  {
    id: 'quick-add-transition',
    label: 'Add Transitions',
    description: 'Add transition-colors to elements',
    type: 'simple',
    find: 'className="',
    replace: 'className="transition-colors ',
  },
  {
    id: 'quick-disable-animations',
    label: 'Disable Animations',
    description: 'Remove all animation classes',
    type: 'simple',
    find: '\\s*animate-\\w+',
    replace: '',
    isRegex: true,
  },
];

// Helper components for common UI patterns
const LoadingSpinner = ({ message }: { message: string }) => (
  <Box>
    <Text color="green"><Spinner type="dots" /></Text>
    <Text> {message}</Text>
  </Box>
);

const ErrorMessage = ({ message }: { message: string | null }) => 
  message ? (
    <Box marginBottom={1}>
      <Text color="red">{message}</Text>
    </Box>
  ) : null;

const HelpText = ({ text }: { text: string }) => (
  <Box marginTop={1}>
    <Text color="gray">{text}</Text>
  </Box>
);

export function TemplateManager({ onApplyTemplate, onBack, selectedPaths = [], onDirectApply }: TemplateManagerProps) {
  // Template and UI state
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  const [cursor, setCursor] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // Quick template state
  const [selectedQuickTemplate, setSelectedQuickTemplate] = useState<QuickTemplate | null>(null);
  const [subOptionCursor, setSubOptionCursor] = useState(0);

  // Preview/confirm state
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [pendingRule, setPendingRule] = useState<TemplateRule | null>(null);

  // Component selection state
  const [internalSelectedPaths, setInternalSelectedPaths] = useState<Set<string>>(new Set());
  const [componentCursor, setComponentCursor] = useState(0);
  const [availableComponents, setAvailableComponents] = useState<Array<{ name: string; path: string }>>([]);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newFind, setNewFind] = useState('');
  const [newReplace, setNewReplace] = useState('');
  const [activeField, setActiveField] = useState<'name' | 'find' | 'replace'>('name');

  const canDirectApply = selectedPaths.length > 0 && onDirectApply;

  // Combined list: Quick Templates + User Templates
  const totalQuickTemplates = QUICK_TEMPLATES.length;
  const allItems = [...QUICK_TEMPLATES.map(qt => ({ type: 'quick' as const, item: qt })),
                    ...templates.map(t => ({ type: 'user' as const, item: t }))];

  useEffect(() => {
    fetchTemplates();
    fetchComponents();
  }, []);

  const fetchComponents = async () => {
    const result = await api.getComponents();
    if (result.success && result.data) {
      setAvailableComponents(result.data.components.map((c: any) => ({
        name: c.name,
        path: c.path
      })));
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

  const fetchPreviewForRule = async (rule: TemplateRule) => {
    const pathsToUse = Array.from(internalSelectedPaths.size > 0 ? internalSelectedPaths : new Set(selectedPaths));
    
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
          const existing = allPreviews.find(p => p.path === preview.path);
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
      // Simple action - go directly to component selection
      const rule: TemplateRule = {
        find: qt.find!,
        replace: qt.replace!,
        isRegex: qt.isRegex || false,
      };
      setSelectedQuickTemplate(qt);
      setPendingRule(rule);
      setMode('select-components');
      setComponentCursor(0);
      
      // If components were pre-selected, use those
      if (selectedPaths.length > 0) {
        setInternalSelectedPaths(new Set(selectedPaths));
      }
    } else {
      // Has sub-options - show them
      setSelectedQuickTemplate(qt);
      setSubOptionCursor(0);
      setMode('suboptions');
    }
  };

  const handleSubOptionSelect = (option: SubOption) => {
    if (!selectedQuickTemplate) return;

    let rule: TemplateRule;

    if (selectedQuickTemplate.type === 'select-from') {
      // Remove class
      rule = {
        find: `\\s*${option.value}`,
        replace: '',
        isRegex: true,
      };
    } else {
      // select-to - replace existing class with new one
      const pattern = CLASS_PATTERNS[option.value];
      rule = {
        find: pattern || option.value,
        replace: option.value,
        isRegex: !!pattern,
      };
    }

    // Store the rule and move to component selection
    setPendingRule(rule);
    setMode('select-components');
    setComponentCursor(0);
    
    // If components were pre-selected, use those
    if (selectedPaths.length > 0) {
      setInternalSelectedPaths(new Set(selectedPaths));
    }
  };

  useInput((input, key) => {
    // Component selection mode
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
        // Toggle selection
        const component = availableComponents[componentCursor];
        if (component) {
          setInternalSelectedPaths(prev => {
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
        // Select all
        setInternalSelectedPaths(new Set(availableComponents.map(c => c.path)));
        return;
      }
      if (input === 'n') {
        // Deselect all
        setInternalSelectedPaths(new Set());
        return;
      }
      if (key.return || input === 'c') {
        // Confirm and proceed to preview
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

    // Sub-options mode
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
        setSubOptionCursor((c) => Math.min(selectedQuickTemplate.options!.length - 1, c + 1));
        return;
      }
      if (key.return) {
        handleSubOptionSelect(selectedQuickTemplate.options[subOptionCursor]);
        return;
      }
      // Number shortcuts
      const num = parseInt(input);
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
    // Number shortcuts for quick templates
    const num = parseInt(input);
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
    const pathsToUse = Array.from(internalSelectedPaths.size > 0 ? internalSelectedPaths : new Set(selectedPaths));

    setApplying(true);

    // If we have a pending rule (from quick template), apply it directly
    if (pendingRule) {
      const result = await api.applyEdit(pathsToUse, pendingRule.find, pendingRule.replace, pendingRule.isRegex);
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
          onDirectApply(`Applied "${selectedTemplate.name}" to ${result.data.modified.length} files`);
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

  // Sub-options mode for Quick Templates
  if (mode === 'suboptions' && selectedQuickTemplate?.options) {
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">{selectedQuickTemplate.label}</Text>
          <Text color="gray"> - Select an option</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          {selectedQuickTemplate.options.map((option, idx) => {
            const isCurrent = idx === subOptionCursor;
            return (
              <Box key={idx}>
                <Text color={isCurrent ? 'cyan' : 'gray'}>{isCurrent ? '> ' : '  '}</Text>
                <Text color={isCurrent ? 'cyan' : 'white'} bold={isCurrent}>
                  {idx + 1}. {option.value}
                </Text>
                <Text color="gray"> - {option.label}</Text>
              </Box>
            );
          })}
        </Box>

        <HelpText text="[1-9] Quick select | [Enter] Next: Select Components | [Esc] Back" />
      </Box>
    );
  }

  // Component selection mode
  if (mode === 'select-components') {
    const visibleCount = 10;
    const startIdx = Math.max(0, Math.min(componentCursor - 4, availableComponents.length - visibleCount));
    const visibleComponents = availableComponents.slice(startIdx, startIdx + visibleCount);

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {selectedQuickTemplate?.label || 'Action'}
          </Text>
          <Text color="gray"> - Select components to modify</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="gray">
            {internalSelectedPaths.size} / {availableComponents.length} components selected
          </Text>
        </Box>

        <ErrorMessage message={error} />

        <Box flexDirection="column" marginBottom={1}>
          {startIdx > 0 && (
            <Text color="gray">  ↑ {startIdx} more...</Text>
          )}

          {visibleComponents.map((component, idx) => {
            const actualIdx = startIdx + idx;
            const isSelected = internalSelectedPaths.has(component.path);
            const isCursor = actualIdx === componentCursor;

            return (
              <Box key={component.path}>
                <Text color={isCursor ? 'cyan' : undefined}>
                  {isCursor ? '>' : ' '}
                </Text>
                <Text color={isSelected ? 'green' : 'gray'}>
                  [{isSelected ? 'x' : ' '}]
                </Text>
                <Text color={isCursor ? 'cyan' : 'white'} bold={isCursor}>
                  {' '}{component.name}
                </Text>
              </Box>
            );
          })}

          {startIdx + visibleCount < availableComponents.length && (
            <Text color="gray">
              {'  '}↓ {availableComponents.length - startIdx - visibleCount} more...
            </Text>
          )}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Box borderStyle="single" paddingX={2} paddingY={0} marginBottom={1}>
            <Text bold color={internalSelectedPaths.size > 0 ? 'green' : 'gray'}>
              {internalSelectedPaths.size > 0 
                ? `[c/Enter] Confirm & Preview (${internalSelectedPaths.size} selected)`
                : '[c/Enter] Confirm & Preview (select at least 1)'}
            </Text>
          </Box>
          
          <HelpText text="[Space] Toggle | [a] Select All | [n] Deselect All | [Esc/q] Back" />
        </Box>
      </Box>
    );
  }

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
          <Text bold>Preview Changes</Text>
          <Box marginY={1}>
            <Text color="yellow">No changes found for the selected components.</Text>
          </Box>
          <HelpText text="[q/Esc] Go back" />
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
          <Text bold>Apply: </Text>
          <Text bold color="cyan">{templateName}</Text>
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

        <ErrorMessage message={error} />

        <Box flexDirection="column" borderStyle="single" paddingX={1}>
          {scrollOffset > 0 && (
            <Text color="gray">... {scrollOffset} more above</Text>
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
            <Text color="gray">... {changedGroups.length - scrollOffset - visibleGroups} more below</Text>
          )}
        </Box>

        <HelpText text="[Left/Right] Switch file | [Up/Down] Scroll | [y/Enter] Apply | [q/Esc] Cancel" />
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

        <HelpText text="[Tab] Next field | [Enter] Save | [Esc] Cancel" />
      </Box>
    );
  }

  if (mode === 'view' && selectedTemplate) {
    if (loadingPreview) {
      return <LoadingSpinner message="Generating preview..." />;
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

        <HelpText text={
          canDirectApply 
            ? `[a] Preview & apply (${selectedPaths.length} files) | [d] Delete | [q/Esc] Back`
            : '[a] Load into editor | [d] Delete | [q/Esc] Back'
        } />
      </Box>
    );
  }

  // Main list view
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Template Manager</Text>
        {canDirectApply && (
          <Text color="green"> ({selectedPaths.length} components selected)</Text>
        )}
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}

      {/* Quick Templates Section */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="yellow">Quick Actions:</Text>
        {QUICK_TEMPLATES.map((qt, idx) => {
          const isCurrent = idx === cursor;
          return (
            <Box key={qt.id}>
              <Text color={isCurrent ? 'cyan' : 'gray'}>{isCurrent ? '> ' : '  '}</Text>
              <Text color={isCurrent ? 'cyan' : 'white'} bold={isCurrent}>
                {idx + 1}. {qt.label}
              </Text>
              <Text color="gray"> - {qt.description}</Text>
              {qt.type !== 'simple' && <Text color="yellow"> [...]</Text>}
            </Box>
          );
        })}
      </Box>

      {/* User Templates Section */}
      <Box marginBottom={1} flexDirection="column">
        <Text bold color="yellow">Saved Templates:</Text>
        {templates.length === 0 ? (
          <Text color="gray" dimColor>  No saved templates. Press [n] to create one.</Text>
        ) : (
          templates.map((template, idx) => {
            const listIdx = totalQuickTemplates + idx;
            const isCurrent = listIdx === cursor;
            return (
              <Box key={template.id}>
                <Text color={isCurrent ? 'cyan' : 'gray'}>{isCurrent ? '> ' : '  '}</Text>
                <Text color={isCurrent ? 'cyan' : 'white'} bold={isCurrent}>
                  {template.name}
                </Text>
                <Text color="gray"> ({template.rules.length} rules)</Text>
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <HelpText text={`[1-${Math.min(9, totalQuickTemplates)}] Quick select | [Enter] Select | [n] New template | [Esc] Back`} />
      </Box>
    </Box>
  );
}
