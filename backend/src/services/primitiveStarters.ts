import type {
  PrimitiveStarterProvider,
  PrimitiveStarterTemplate,
} from '../types/index.js';

export const PRIMITIVE_STARTER_TEMPLATES: PrimitiveStarterTemplate[] = [
  {
    id: 'blank-component',
    provider: 'blank',
    name: 'Blank component',
    description: 'A minimal wrapper component with cn-ready className merging.',
    defaultComponentName: 'PrimitiveWrapper',
    supportsParts: false,
    supportsCva: true,
  },
  {
    id: 'radix-dialog',
    provider: 'radix',
    name: 'Radix Dialog',
    description: 'A multi-part dialog wrapper around @radix-ui/react-dialog primitives.',
    defaultComponentName: 'Dialog',
    supportsParts: true,
    supportsCva: true,
  },
  {
    id: 'base-ui-dialog',
    provider: 'base-ui',
    name: 'Base UI Dialog',
    description: 'A multi-part dialog wrapper around @base-ui-components/react/dialog primitives.',
    defaultComponentName: 'Dialog',
    supportsParts: true,
    supportsCva: true,
  },
];

export function listPrimitiveStarterTemplates(): PrimitiveStarterTemplate[] {
  return PRIMITIVE_STARTER_TEMPLATES;
}

export function findPrimitiveStarterTemplate(
  provider: PrimitiveStarterProvider,
  templateId?: string
): PrimitiveStarterTemplate | null {
  const templates = PRIMITIVE_STARTER_TEMPLATES.filter(
    (template) => template.provider === provider
  );

  if (templateId) {
    return templates.find((template) => template.id === templateId) ?? null;
  }

  return templates[0] ?? null;
}
