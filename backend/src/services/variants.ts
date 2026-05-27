import { createPatch, diffLines } from 'diff';
import fs from 'fs-extra';
import path from 'node:path';
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
import { createBackup } from './backup.js';
import { getComponentLibraryDetail, listComponentLibrary } from './componentLibrary.js';
import { parseComponentSourceFile } from './parser.js';

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
  return components.map((component) => component.variants);
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
  const after = replaceRawAtParsedRange(component.content, definition, nextRaw);
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
    changes: countChangedLines(component.content, after),
  };
}

export async function applyVariantGeneration(
  cwd: string,
  request: VariantPreviewRequest
): Promise<{ preview: VariantGenerationPreview; modified: string[]; backupId?: string }> {
  const preview = await previewVariantGeneration(cwd, request);
  const absolutePath = path.resolve(cwd, preview.componentPath);
  const backup = await createBackup([absolutePath]);
  await fs.writeFile(absolutePath, preview.after, 'utf-8');
  return {
    preview,
    modified: [absolutePath],
    backupId: backup.id,
  };
}

function detailFromComponent(component: ComponentLibraryDetail): VariantComponentDetail {
  const sourceFile = createVariantSourceFile(component.path, component.content);
  const parsed = parseComponentSourceFile(component.path, sourceFile);
  const parserDefinitions = parsed.variantDefinitions.map(toDefinitionDetail);
  const manualDefinitions = detectManualVariantDefinitions(sourceFile);
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
    rawStart: definition.rawStart,
    rawEnd: definition.rawEnd,
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

function detectManualVariantDefinitions(sourceFile: ts.SourceFile): VariantDefinitionDetail[] {
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

  if (properties.every((property) => isNonEmptyStaticClassExpression(property.initializer))) {
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
      valueProperties.length === 0 ||
      !valueProperties.every((valueProperty) =>
        isNonEmptyStaticClassExpression(valueProperty.initializer)
      )
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
  if (
    !/className\s*=\s*{[\s\S]*?\b[a-zA-Z_$][\w$]*\s*(?:===|!==|==|!=)\s*[^?;{]+\?[\s\S]*?}/.test(
      content
    )
  )
    return [];
  return [
    {
      severity: 'info',
      code: 'UNSUPPORTED_VARIANT_EXPRESSION',
      message:
        'Conditional expressions were detected and may include variant-like classes that could not be converted into variant axes.',
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

  if (operation.type !== 'add-value' && operation.type !== 'set-default') {
    throw new VariantBuilderValidationError('Unsupported preview operation type.');
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
  const indent = detectVariantIndent(raw);
  const axisBlock = `${formatObjectKey(axis.name)}: {\n${axis.values
    .map(
      (value) =>
        `${indent.valueValue}${formatObjectKey(value.name)}: '${escapeSingleQuotedLiteral(
          value.classes.join(' ')
        )}',`
    )
    .join('\n')}\n${indent.value}}`;
  const variantsBlock = findObjectBlock(raw, 'variants');
  if (!variantsBlock) return raw;
  const withAxis = insertPropertyIntoObjectBlock(raw, variantsBlock, axisBlock, indent.value);
  const selectedDefault = defaultValue ?? axis.defaultValue;
  if (!selectedDefault) return withAxis;
  const defaultVariantsBlock = findObjectBlock(withAxis, 'defaultVariants');
  if (defaultVariantsBlock) {
    return insertPropertyIntoObjectBlock(
      withAxis,
      defaultVariantsBlock,
      `${formatObjectKey(axis.name)}: '${escapeSingleQuotedLiteral(selectedDefault)}'`,
      indent.value
    );
  }
  return replaceRawDefinitionFallback(
    withAxis,
    /}\s*\)\s*;?\s*$/,
    `,\n${indent.config}defaultVariants: {\n${indent.value}${formatObjectKey(
      axis.name
    )}: '${escapeSingleQuotedLiteral(selectedDefault)}',\n${indent.config}},\n${indent.close}}\n)`
  );
}

function addValueToRawDefinition(raw: string, axisName: string, value: VariantValue): string {
  const indent = detectVariantIndent(raw);
  const axisBlock = findObjectBlock(raw, axisName);
  if (!axisBlock) return raw;
  return insertPropertyIntoObjectBlock(
    raw,
    axisBlock,
    `${formatObjectKey(value.name)}: '${escapeSingleQuotedLiteral(value.classes.join(' '))}'`,
    indent.valueValue
  );
}

function setDefaultInRawDefinition(raw: string, axisName: string, valueName: string): string {
  const indent = detectVariantIndent(raw);
  const defaultVariantsBlock = findObjectBlock(raw, 'defaultVariants');
  if (defaultVariantsBlock) {
    const defaultAxisPattern = new RegExp(
      `(${escapeObjectKeyRegExp(axisName)}\\s*:\\s*)['"][^'"]+['"]`
    );
    const block = raw.slice(defaultVariantsBlock.start, defaultVariantsBlock.end);
    if (defaultAxisPattern.test(block)) {
      const updatedBlock = block.replace(
        defaultAxisPattern,
        `$1'${escapeSingleQuotedLiteral(valueName)}'`
      );
      return `${raw.slice(0, defaultVariantsBlock.start)}${updatedBlock}${raw.slice(
        defaultVariantsBlock.end
      )}`;
    }
  }
  if (/defaultVariants:\s*{/.test(raw)) {
    return raw.replace(
      /defaultVariants:\s*{\s*/,
      (match) =>
        `${match}\n${indent.value}${formatObjectKey(axisName)}: '${escapeSingleQuotedLiteral(
          valueName
        )}',`
    );
  }
  return replaceRawDefinitionFallback(
    raw,
    /}\s*\)\s*;?\s*$/,
    `,\n${indent.config}defaultVariants: {\n${indent.value}${formatObjectKey(
      axisName
    )}: '${escapeSingleQuotedLiteral(valueName)}',\n${indent.config}},\n${indent.close}}\n)`
  );
}

function createVariantSourceFile(filePath: string, content: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TSX
  );
}

function countChangedLines(before: string, after: string): number {
  let changes = 0;
  let pendingRemoved = 0;

  for (const part of diffLines(before, after)) {
    if (part.removed) {
      pendingRemoved += countDiffPartLines(part.value);
      continue;
    }
    if (part.added) {
      changes += Math.max(pendingRemoved, countDiffPartLines(part.value));
      pendingRemoved = 0;
      continue;
    }
    changes += pendingRemoved;
    pendingRemoved = 0;
  }
  changes += pendingRemoved;

  return changes;
}

function countDiffPartLines(value: string): number {
  if (value.length === 0) return 0;
  const lines = value.split(/\r?\n/);
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

function detectVariantIndent(raw: string): {
  config: string;
  value: string;
  valueValue: string;
  close: string;
} {
  const variantsLine = raw.match(/(^[ \t]*)variants:\s*{/m);
  const config = variantsLine?.[1] ?? '    ';
  const unit = detectIndentUnit(raw) ?? '  ';
  return {
    config,
    value: `${config}${unit}`,
    valueValue: `${config}${unit}${unit}`,
    close: config.slice(0, Math.max(0, config.length - unit.length)),
  };
}

function detectIndentUnit(raw: string): string | null {
  const indents = [...raw.matchAll(/^\s*\S/gm)].map((match) => match[0].slice(0, -1));
  const sorted = [...new Set(indents)].sort((a, b) => a.length - b.length);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startsWith(sorted[index - 1])) {
      const unit = sorted[index].slice(sorted[index - 1].length);
      if (unit.length > 0) return unit;
    }
  }
  return null;
}

function formatObjectKey(value: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(value) ? value : `'${escapeSingleQuotedLiteral(value)}'`;
}

function escapeSingleQuotedLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function replaceRawAtParsedRange(
  content: string,
  definition: VariantDefinitionDetail,
  replacement: string
): string {
  if (definition.rawStart === undefined || definition.rawEnd === undefined || !definition.raw) {
    return content;
  }
  if (content.slice(definition.rawStart, definition.rawEnd) !== definition.raw) {
    return content;
  }
  return `${content.slice(0, definition.rawStart)}${replacement}${content.slice(
    definition.rawEnd
  )}`;
}

function replaceRawDefinitionFallback(raw: string, pattern: RegExp, replacement: string): string {
  const nextRaw = raw.replace(pattern, replacement);
  if (nextRaw === raw) {
    throw new VariantBuilderUnsupportedError(
      'Could not insert defaultVariants into target variant definition.'
    );
  }
  return nextRaw;
}

function insertPropertyIntoObjectBlock(
  raw: string,
  block: { start: number; end: number },
  property: string,
  indent: string
): string {
  const openBrace = raw.indexOf('{', block.start);
  const closeBrace = block.end - 1;
  const inner = raw.slice(openBrace + 1, closeBrace);
  const trimmedInner = inner.trim();

  if (!trimmedInner) {
    return `${raw.slice(0, openBrace + 1)}\n${indent}${property},\n${raw.slice(closeBrace)}`;
  }

  if (!inner.includes('\n')) {
    const trailingWhitespace = inner.match(/\s*$/)?.[0] ?? '';
    const insertionPrefix = trimmedInner.endsWith(',') ? '' : ',';
    return `${raw.slice(0, closeBrace - trailingWhitespace.length)}${insertionPrefix} ${property}${trailingWhitespace}${raw.slice(closeBrace)}`;
  }

  const trailingWhitespace = inner.match(/\s*$/)?.[0] ?? '';
  const insertionPrefix = trimmedInner.endsWith(',') ? '' : ',';
  return `${raw.slice(0, closeBrace - trailingWhitespace.length)}${insertionPrefix}\n${indent}${property},${trailingWhitespace}${raw.slice(closeBrace)}`;
}

function looksLikeVariantName(name: string): boolean {
  if (/^(?:allClasses|classes|classesMap|globalStyles|styles)$/i.test(name)) return false;
  return /(?:^variant|Variants?$|Styles?$|^classesBy|ClassesBy)/.test(name);
}

function isStaticClassExpression(node: ts.Expression): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function isNonEmptyStaticClassExpression(node: ts.Expression): boolean {
  return isStaticClassExpression(node) && collectStringClasses(node).length > 0;
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

function escapeObjectKeyRegExp(value: string): string {
  const escaped = escapeRegExp(value);
  if (/^[A-Za-z_$][\w$]*$/.test(value)) return `(?:${escaped}|['"]${escaped}['"])`;
  return `['"]${escaped}['"]`;
}

function findObjectBlock(raw: string, propertyName: string): { start: number; end: number } | null {
  const match = new RegExp(`${escapeRegExp(propertyName)}\\s*:\\s*{`).exec(raw);
  if (!match) return null;
  const start = match.index;
  const openBrace = raw.indexOf('{', start);
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  for (let index = openBrace; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1 };
    }
  }

  return null;
}
