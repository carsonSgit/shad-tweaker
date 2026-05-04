import path from 'node:path';
import fs from 'fs-extra';
import type {
  PrimitiveStarterGeneratedFile,
  PrimitiveStarterProvider,
  PrimitiveStarterRequest,
  PrimitiveStarterResult,
  PrimitiveStarterTemplate,
} from '../types/index.js';
import { isSafeProjectRelativePath } from '../utils/paths.js';
import { loadWorkspaceManifest } from './workspace.js';

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

function toPascalCase(value: string): string {
  return value
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function toKebabCase(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-');
}

function normalizeComponentName(value: string | undefined, fallback: string): string | null {
  const name = toPascalCase(value ?? fallback);
  if (!name || !/^[A-Z][a-zA-Z0-9]*$/.test(name)) return null;
  return name;
}

function resolveTargetPath(
  cwd: string,
  componentDirectory: string,
  componentName: string,
  targetPath?: string
): string | null {
  const relativePath = targetPath ?? `${toKebabCase(componentName)}.tsx`;
  if (!relativePath || !isSafeProjectRelativePath(relativePath)) return null;

  return path.resolve(cwd, componentDirectory, relativePath);
}

function variantName(componentName: string): string {
  return `${componentName.charAt(0).toLowerCase()}${componentName.slice(1)}Variants`;
}

function cvaImport(includeCva: boolean): string {
  return includeCva ? "import { cva, type VariantProps } from 'class-variance-authority';\n" : '';
}

function cvaDefinition(componentName: string, baseClasses: string, includeCva: boolean): string {
  if (!includeCva) return '';

  return `
const ${variantName(componentName)} = cva('${baseClasses}', {
  variants: {
    tone: {
      default: '',
      muted: 'bg-muted text-muted-foreground',
    },
  },
  defaultVariants: {
    tone: 'default',
  },
});
`;
}

function cvaPropType(componentName: string, includeCva: boolean): string {
  return includeCva ? ` & VariantProps<typeof ${variantName(componentName)}>` : '';
}

function cvaDestructure(includeCva: boolean): string {
  return includeCva ? 'tone,\n  ' : '';
}

function cnExpression(componentName: string, baseClasses: string, includeCva: boolean): string {
  return includeCva
    ? `cn(${variantName(componentName)}({ tone }), className)`
    : `cn('${baseClasses}', className)`;
}

function blankStarterContent(componentName: string, includeCva: boolean): string {
  const baseClasses = 'rounded-md border bg-background p-4 text-foreground shadow-sm';
  return `import * as React from 'react';
${cvaImport(includeCva)}import { cn } from '@/lib/utils';
${cvaDefinition(componentName, baseClasses, includeCva)}
export type ${componentName}Props = React.HTMLAttributes<HTMLDivElement>${cvaPropType(componentName, includeCva)};

export function ${componentName}({
  className,
  ${cvaDestructure(includeCva)}...props
}: ${componentName}Props) {
  return (
    <div
      data-slot="${toKebabCase(componentName)}"
      className={${cnExpression(componentName, baseClasses, includeCva)}}
      {...props}
    />
  );
}
`;
}

function radixDialogStarterContent(componentName: string, includeCva: boolean): string {
  const contentName = `${componentName}Content`;
  const contentClasses =
    'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 text-foreground shadow-lg';
  return `import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
${cvaImport(includeCva)}import { cn } from '@/lib/utils';

const ${componentName}Root = DialogPrimitive.Root;
const ${componentName}Trigger = DialogPrimitive.Trigger;
const ${componentName}Portal = DialogPrimitive.Portal;
const ${componentName}Close = DialogPrimitive.Close;
${cvaDefinition(contentName, contentClasses, includeCva)}

function ${componentName}Overlay({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="${toKebabCase(componentName)}-overlay"
      className={cn('fixed inset-0 z-50 bg-black/50', className)}
      {...props}
    />
  );
}

function ${componentName}Content({
  className,
  children,
  ${cvaDestructure(includeCva)}...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>${cvaPropType(contentName, includeCva)}) {
  return (
    <${componentName}Portal>
      <${componentName}Overlay />
      <DialogPrimitive.Content
        data-slot="${toKebabCase(componentName)}-content"
        className={${cnExpression(contentName, contentClasses, includeCva)}}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </${componentName}Portal>
  );
}

function ${componentName}Header({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="${toKebabCase(componentName)}-header"
      className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function ${componentName}Footer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="${toKebabCase(componentName)}-footer"
      className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
      {...props}
    />
  );
}

function ${componentName}Title({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="${toKebabCase(componentName)}-title"
      className={cn('font-semibold text-lg leading-none tracking-normal', className)}
      {...props}
    />
  );
}

function ${componentName}Description({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="${toKebabCase(componentName)}-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  ${componentName}Root,
  ${componentName}Trigger,
  ${componentName}Portal,
  ${componentName}Close,
  ${componentName}Overlay,
  ${componentName}Content,
  ${componentName}Header,
  ${componentName}Footer,
  ${componentName}Title,
  ${componentName}Description,
};
`;
}

function baseUiDialogStarterContent(componentName: string, includeCva: boolean): string {
  const popupName = `${componentName}Popup`;
  const popupClasses =
    'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 text-foreground shadow-lg';
  return `import * as React from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { X } from 'lucide-react';
${cvaImport(includeCva)}import { cn } from '@/lib/utils';

const ${componentName}Root = Dialog.Root;
const ${componentName}Trigger = Dialog.Trigger;
const ${componentName}Portal = Dialog.Portal;
const ${componentName}Close = Dialog.Close;
${cvaDefinition(popupName, popupClasses, includeCva)}

function ${componentName}Backdrop({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Backdrop>) {
  return (
    <Dialog.Backdrop
      data-slot="${toKebabCase(componentName)}-backdrop"
      className={cn('fixed inset-0 z-50 bg-black/50', className)}
      {...props}
    />
  );
}

function ${componentName}Popup({
  className,
  children,
  ${cvaDestructure(includeCva)}...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Popup>${cvaPropType(popupName, includeCva)}) {
  return (
    <${componentName}Portal>
      <${componentName}Backdrop />
      <Dialog.Popup
        data-slot="${toKebabCase(componentName)}-popup"
        className={${cnExpression(popupName, popupClasses, includeCva)}}
        {...props}
      >
        {children}
        <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Dialog.Close>
      </Dialog.Popup>
    </${componentName}Portal>
  );
}

function ${componentName}Header({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="${toKebabCase(componentName)}-header"
      className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function ${componentName}Footer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="${toKebabCase(componentName)}-footer"
      className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
      {...props}
    />
  );
}

function ${componentName}Title({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Title>) {
  return (
    <Dialog.Title
      data-slot="${toKebabCase(componentName)}-title"
      className={cn('font-semibold text-lg leading-none tracking-normal', className)}
      {...props}
    />
  );
}

function ${componentName}Description({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Description>) {
  return (
    <Dialog.Description
      data-slot="${toKebabCase(componentName)}-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  ${componentName}Root,
  ${componentName}Trigger,
  ${componentName}Portal,
  ${componentName}Close,
  ${componentName}Backdrop,
  ${componentName}Popup,
  ${componentName}Header,
  ${componentName}Footer,
  ${componentName}Title,
  ${componentName}Description,
};
`;
}

function generateFiles(
  template: PrimitiveStarterTemplate,
  componentName: string,
  targetPath: string,
  includeCva: boolean
): PrimitiveStarterGeneratedFile[] {
  const content =
    template.provider === 'radix'
      ? radixDialogStarterContent(componentName, includeCva)
      : template.provider === 'base-ui'
        ? baseUiDialogStarterContent(componentName, includeCva)
        : blankStarterContent(componentName, includeCva);

  return [
    {
      path: targetPath,
      content,
    },
  ];
}

export async function generatePrimitiveStarter(
  request: PrimitiveStarterRequest,
  cwd: string
): Promise<PrimitiveStarterResult> {
  const template = findPrimitiveStarterTemplate(request.provider, request.templateId);
  if (!template) {
    throw new Error('Primitive starter template not found.');
  }

  const manifest = await loadWorkspaceManifest(cwd);
  const componentName = normalizeComponentName(
    request.componentName,
    template.defaultComponentName
  );
  if (!componentName) {
    throw new Error('componentName must produce a valid PascalCase component name.');
  }

  const targetPath = resolveTargetPath(
    cwd,
    manifest.config.componentDirectory,
    componentName,
    request.targetPath
  );
  if (!targetPath) {
    throw new Error('targetPath must be a safe project-relative path.');
  }

  const files = generateFiles(template, componentName, targetPath, request.includeCva === true);
  const conflicts: string[] = [];

  for (const file of files) {
    if (await fs.pathExists(file.path)) {
      conflicts.push(file.path);
    }
  }

  return {
    template,
    componentName,
    files,
    conflicts,
  };
}
