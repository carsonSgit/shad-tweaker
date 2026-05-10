import { createPatch } from 'diff';
import ts from 'typescript';
import type {
  ComponentLibraryDetail,
  ParsedVariantDefinition,
  ParserDiagnostic,
  VariantAxis,
  VariantComponentDetail,
  VariantComponentSummary,
  VariantDefinitionDetail,
  VariantGenerationPreview,
  VariantPreviewOperation,
  VariantValue,
} from '../types/index.js';
import { getComponentLibraryDetail, listComponentLibrary } from './componentLibrary.js';
import { parseComponentSource } from './parser.js';

export class VariantBuilderValidationError extends Error {
  readonly code = 'VARIANT_BUILDER_VALIDATION_ERROR';
}

export class VariantBuilderUnsupportedError extends Error {
  readonly code = 'VARIANT_BUILDER_UNSUPPORTED';
}

interface ManualVariantCandidate {
  name: string;
  line: number;
  axes: VariantAxis[];
  raw: string;
}

interface VariantPreviewRequest {
  componentPath: string;
  targetDefinition: string;
  operation: VariantPreviewOperation;
}

export async function listVariantComponents(cwd: string): Promise<VariantComponentSummary[]> {
  const components = await listComponentLibrary(cwd);
  return Promise.all(
    components.map(async (component) =>
      summarizeDetail(await getComponentLibraryDetail(cwd, component.path))
    )
  );
}

export async function getVariantComponentDetail(
  cwd: string,
  identifier: string
): Promise<VariantComponentDetail> {
  return detailFromComponent(await getComponentLibraryDetail(cwd, identifier));
}

export async function previewVariantGeneration(
  cwd: string,
  request: VariantPreviewRequest
): Promise<VariantGenerationPreview> {
  const component = await getComponentLibraryDetail(cwd, request.componentPath);
  const detail = detailFromComponent(component);
  const definition = detail.definitions.find(
    (candidate) => candidate.name === request.targetDefinition
  );

  if (!definition) {
    throw new VariantBuilderValidationError('Target variant definition was not found.');
  }
  if (definition.system !== 'cva' && definition.system !== 'tv') {
    throw new VariantBuilderUnsupportedError(
      'Only cva and tailwind-variants definitions support previews.'
    );
  }
  if (!definition.raw) {
    throw new VariantBuilderUnsupportedError('Target variant definition is missing raw source.');
  }

  validateOperation(definition, request.operation);

  const nextRaw = applyOperationToRawDefinition(definition.raw, request.operation);
  const after = replaceOnce(component.content, definition.raw, nextRaw);
  if (after === component.content) {
    throw new VariantBuilderUnsupportedError(
      'Could not locate target variant definition in source.'
    );
  }

  return {
    componentPath: component.path,
    targetDefinition: definition.name,
    operation: request.operation,
    before: component.content,
    after,
    diff: createPatch(component.path, component.content, after, 'before', 'after'),
    changes: 1,
  };
}

function summarizeDetail(component: ComponentLibraryDetail): VariantComponentSummary {
  const detail = detailFromComponent(component);
  return {
    name: detail.name,
    path: detail.path,
    variantCount: detail.variantCount,
    systems: detail.systems,
    axes: detail.axes,
  };
}

function detailFromComponent(component: ComponentLibraryDetail): VariantComponentDetail {
  const parsed = parseComponentSource(component.path, component.content);
  const parserDefinitions = parsed.variantDefinitions.map(toDefinitionDetail);
  const manualDefinitions = detectManualVariantDefinitions(component.path, component.content);
  const definitions = mergeDefinitions(parserDefinitions, manualDefinitions);
  const unsupportedDiagnostics = detectUnsupportedVariantDiagnostics(component.content);
  const diagnostics = [...parsed.diagnostics, ...unsupportedDiagnostics];
  const systems = unique(definitions.map((definition) => definition.system));
  const axes = unique(
    definitions.flatMap((definition) => definition.axes.map((axis) => axis.name))
  );

  return {
    name: component.name,
    path: component.path,
    variantCount: definitions.filter((definition) => definition.system !== 'unsupported').length,
    systems,
    axes,
    definitions,
    diagnostics,
  };
}

function toDefinitionDetail(definition: ParsedVariantDefinition): VariantDefinitionDetail {
  return {
    name: definition.name,
    system: definition.callee,
    line: definition.line,
    baseClasses: definition.baseClasses,
    axes: Object.entries(definition.variants).map(([name, values]) => ({
      name,
      defaultValue: definition.defaultVariants[name],
      values: Object.entries(values).map(([valueName, classes]) => ({
        name: valueName,
        classes,
      })),
    })),
    compoundVariants: definition.compoundVariants,
    raw: definition.raw,
    diagnostics: [],
  };
}

function mergeDefinitions(
  parserDefinitions: VariantDefinitionDetail[],
  manualDefinitions: VariantDefinitionDetail[]
): VariantDefinitionDetail[] {
  const parserNames = new Set(parserDefinitions.map((definition) => definition.name));
  return [
    ...parserDefinitions,
    ...manualDefinitions.filter((definition) => !parserNames.has(definition.name)),
  ];
}

function detectManualVariantDefinitions(
  filePath: string,
  content: string
): VariantDefinitionDetail[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const candidates: ManualVariantCandidate[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const name = node.name.text;
      if (looksLikeVariantName(name)) {
        const axes = parseManualAxes(node.initializer);
        if (axes.length > 0) {
          candidates.push({
            name,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            axes,
            raw: node.initializer.getText(sourceFile),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return candidates.map((candidate) => ({
    name: candidate.name,
    system: 'manual',
    line: candidate.line,
    baseClasses: [],
    axes: candidate.axes,
    compoundVariants: [],
    raw: candidate.raw,
    diagnostics: [],
  }));
}

function parseManualAxes(objectLiteral: ts.ObjectLiteralExpression): VariantAxis[] {
  const properties = objectLiteral.properties.filter(ts.isPropertyAssignment);
  if (properties.length === 0) return [];

  if (properties.every((property) => isStaticClassExpression(property.initializer))) {
    return [
      {
        name: 'variant',
        values: properties.flatMap((property) => {
          const name = getPropertyName(property.name);
          return name ? [{ name, classes: collectStringClasses(property.initializer) }] : [];
        }),
      },
    ];
  }

  const axes: VariantAxis[] = [];
  for (const property of properties) {
    const axisName = getPropertyName(property.name);
    if (!axisName || !ts.isObjectLiteralExpression(property.initializer)) continue;
    const valueProperties = property.initializer.properties.filter(ts.isPropertyAssignment);
    if (
      !valueProperties.every((valueProperty) => isStaticClassExpression(valueProperty.initializer))
    ) {
      continue;
    }
    axes.push({
      name: axisName,
      values: valueProperties.flatMap((valueProperty) => {
        const name = getPropertyName(valueProperty.name);
        return name ? [{ name, classes: collectStringClasses(valueProperty.initializer) }] : [];
      }),
    });
  }

  return axes;
}

function detectUnsupportedVariantDiagnostics(content: string): ParserDiagnostic[] {
  if (!/\b(?:variant|size|tone|density)\b[^?;{]*\?/.test(content)) return [];
  return [
    {
      severity: 'info',
      code: 'UNSUPPORTED_VARIANT_EXPRESSION',
      message:
        'Conditional variant-like expressions were detected but not converted into variant axes.',
    },
  ];
}

function validateOperation(
  definition: VariantDefinitionDetail,
  operation: VariantPreviewOperation
): void {
  if (operation.type === 'add-axis') {
    const axisName = operation.axis.name.trim();
    if (!axisName || definition.axes.some((axis) => axis.name === axisName)) {
      throw new VariantBuilderValidationError('Variant axis is missing or already exists.');
    }
    validateValues(operation.axis.values);
    return;
  }

  const axis = definition.axes.find((candidate) => candidate.name === operation.axisName);
  if (!axis) throw new VariantBuilderValidationError('Variant axis was not found.');

  if (operation.type === 'add-value') {
    if (axis.values.some((value) => value.name === operation.value.name)) {
      throw new VariantBuilderValidationError('Variant value already exists.');
    }
    validateValues([operation.value]);
    return;
  }

  if (!axis.values.some((value) => value.name === operation.valueName)) {
    throw new VariantBuilderValidationError('Default variant value was not found.');
  }
}

function validateValues(values: VariantValue[]): void {
  if (values.length === 0)
    throw new VariantBuilderValidationError('At least one variant value is required.');
  for (const value of values) {
    if (!value.name.trim())
      throw new VariantBuilderValidationError('Variant value name is required.');
    if (value.classes.length === 0)
      throw new VariantBuilderValidationError('Variant value classes are required.');
  }
}

function applyOperationToRawDefinition(raw: string, operation: VariantPreviewOperation): string {
  if (operation.type === 'add-axis')
    return addAxisToRawDefinition(raw, operation.axis, operation.defaultValue);
  if (operation.type === 'add-value')
    return addValueToRawDefinition(raw, operation.axisName, operation.value);
  return setDefaultInRawDefinition(raw, operation.axisName, operation.valueName);
}

function addAxisToRawDefinition(raw: string, axis: VariantAxis, defaultValue?: string): string {
  const axisBlock = `${axis.name}: {\n${axis.values
    .map((value) => `        ${value.name}: '${value.classes.join(' ')}',`)
    .join('\n')}\n      },`;
  const withAxis = raw.replace(/variants:\s*{\s*/, (match) => `${match}\n      ${axisBlock}\n`);
  const selectedDefault = defaultValue ?? axis.defaultValue;
  if (!selectedDefault) return withAxis;
  if (/defaultVariants:\s*{/.test(withAxis)) {
    return withAxis.replace(
      /defaultVariants:\s*{\s*/,
      (match) => `${match}\n      ${axis.name}: '${selectedDefault}',`
    );
  }
  return withAxis.replace(
    /}\s*\)?\s*;?\s*$/,
    `,\n    defaultVariants: {\n      ${axis.name}: '${selectedDefault}',\n    },\n  }\n)`
  );
}

function addValueToRawDefinition(raw: string, axisName: string, value: VariantValue): string {
  const axisPattern = new RegExp(`(${escapeRegExp(axisName)}\\s*:\\s*{)`);
  return raw.replace(axisPattern, `$1\n        ${value.name}: '${value.classes.join(' ')}',`);
}

function setDefaultInRawDefinition(raw: string, axisName: string, valueName: string): string {
  const defaultAxisPattern = new RegExp(`(${escapeRegExp(axisName)}\\s*:\\s*)['"][^'"]+['"]`);
  if (defaultAxisPattern.test(raw)) return raw.replace(defaultAxisPattern, `$1'${valueName}'`);
  if (/defaultVariants:\s*{/.test(raw)) {
    return raw.replace(
      /defaultVariants:\s*{\s*/,
      (match) => `${match}\n      ${axisName}: '${valueName}',`
    );
  }
  return raw.replace(
    /}\s*\)?\s*;?\s*$/,
    `,\n    defaultVariants: {\n      ${axisName}: '${valueName}',\n    },\n  }\n)`
  );
}

function replaceOnce(content: string, search: string, replacement: string): string {
  const index = content.indexOf(search);
  if (index === -1) return content;
  return `${content.slice(0, index)}${replacement}${content.slice(index + search.length)}`;
}

function looksLikeVariantName(name: string): boolean {
  return /variant|style|styles|classes/i.test(name);
}

function isStaticClassExpression(node: ts.Expression): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function collectStringClasses(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.split(/\s+/).filter(Boolean);
  }
  return [];
}

function getPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
