export type WorkbenchArea =
  | 'components'
  | 'registries'
  | 'tokens'
  | 'variants'
  | 'motion'
  | 'pixel-inspector'
  | 'preview'
  | 'diff'
  | 'backups'
  | 'settings';

export interface WorkbenchAreaMeta {
  id: WorkbenchArea;
  label: string;
  shortLabel: string;
  description: string;
}

export const WORKBENCH_AREAS: WorkbenchAreaMeta[] = [
  {
    id: 'components',
    label: 'Components',
    shortLabel: 'Components',
    description: 'Browse, select, inspect, and edit local shadcn/ui components.',
  },
  {
    id: 'registries',
    label: 'Registries',
    shortLabel: 'Registry',
    description: 'Review configured component registry sources and item availability.',
  },
  {
    id: 'tokens',
    label: 'Tokens',
    shortLabel: 'Tokens',
    description: 'Inspect token sets, repeated values, and styling inconsistencies.',
  },
  {
    id: 'variants',
    label: 'Variants',
    shortLabel: 'Variant',
    description: 'Review detected variant systems, axes, and parser diagnostics.',
  },
  {
    id: 'motion',
    label: 'Motion',
    shortLabel: 'Motion',
    description: 'Inspect motion, easing, and duration token readiness.',
  },
  {
    id: 'pixel-inspector',
    label: 'Pixel Inspector',
    shortLabel: 'Inspector',
    description: 'Tune component classes, tokens, variants, and reusable presets.',
  },
  {
    id: 'preview',
    label: 'Preview',
    shortLabel: 'Preview',
    description: 'Preview text and class edits before applying them.',
  },
  {
    id: 'diff',
    label: 'Diff',
    shortLabel: 'Diff',
    description: 'Review active edit previews and backup restore differences.',
  },
  {
    id: 'backups',
    label: 'Backups',
    shortLabel: 'Backups',
    description: 'Browse restore points and recover previous component versions.',
  },
  {
    id: 'settings',
    label: 'Settings',
    shortLabel: 'Config',
    description: 'Review workspace configuration and local studio status.',
  },
];

export function getWorkbenchAreaMeta(area: WorkbenchArea): WorkbenchAreaMeta {
  return WORKBENCH_AREAS.find((item) => item.id === area) ?? WORKBENCH_AREAS[0];
}
