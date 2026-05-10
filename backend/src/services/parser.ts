import path from 'node:path';
import fs from 'fs-extra';
import ts from 'typescript';
import type {
  ParsedClassNameAttribute,
  ParsedCnExpression,
  ParsedComponent,
  ParsedComponentFile,
  ParsedExport,
  ParsedImport,
  ParsedJsxElement,
  ParsedVariantDefinition,
  ParserDiagnostic,
} from '../types/index.js';

type JsxOpeningLike = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
type SourceFileWithParseDiagnostics = ts.SourceFile & {
  parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
};

const SUPPORTED_EXTENSIONS = new Set(['.tsx', '.jsx']);

export function resolveProjectParserPath(filePath: string, cwd: string): string | null {
  if (filePath.trim().length === 0) return null;

  const resolvedRoot = path.resolve(cwd);
  const resolvedFile = path.resolve(resolvedRoot, filePath);
  const relativePath = path.relative(resolvedRoot, resolvedFile);
  const extension = path.extname(resolvedFile).toLowerCase();

  if (relativePath === '' || relativePath.startsWith('..')) {
    return null;
  }

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return null;
  }

  return resolvedFile;
}

export async function parseComponentFile(filePath: string): Promise<ParsedComponentFile> {
  const content = await fs.readFile(filePath, 'utf-8');
  return parseComponentSource(filePath, content);
}

export function parseComponentSource(filePath: string, content: string): ParsedComponentFile {
  const extension = path.extname(filePath).toLowerCase();
  const language = extension === '.jsx' ? 'jsx' : 'tsx';
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    language === 'jsx' ? ts.ScriptKind.JSX : ts.ScriptKind.TSX
  );

  return parseComponentSourceFile(filePath, sourceFile, language);
}

export function parseComponentSourceFile(
  filePath: string,
  sourceFile: ts.SourceFile,
  language: ParsedComponentFile['language'] = 'tsx'
): ParsedComponentFile {
  const extension = path.extname(filePath).toLowerCase();
  const imports: ParsedImport[] = [];
  const exports: ParsedExport[] = [];
  const components: ParsedComponent[] = [];
  const jsxElements: ParsedJsxElement[] = [];
  const classNameAttributes: ParsedClassNameAttribute[] = [];
  const cnExpressions: ParsedCnExpression[] = [];
  const variantDefinitions: ParsedVariantDefinition[] = [];
  const diagnostics: ParserDiagnostic[] = [];
  const exportedNames = new Set<string>();

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    diagnostics.push({
      severity: 'warning',
      code: 'UNSUPPORTED_EXTENSION',
      message: `Parser is optimized for TSX/JSX files, received ${extension || 'no extension'}.`,
    });
  }

  // Pre-pass to collect all exported names so that components declared BEFORE their export are correctly identified.
  function preVisit(node: ts.Node): void {
    if (isExported(node)) {
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            exportedNames.add(declaration.name.text);
          }
        }
      } else {
        const name = getDeclarationName(node);
        if (name) exportedNames.add(name);
      }
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        exportedNames.add(element.name.text);
      }
    }
    ts.forEachChild(node, preVisit);
  }
  preVisit(sourceFile);

  // ts internal: parseDiagnostics is undocumented, verified against typescript ^5.3. May break on future TS versions.
  const parseDiagnostics = (sourceFile as SourceFileWithParseDiagnostics).parseDiagnostics ?? [];
  for (const diagnostic of parseDiagnostics) {
    const line =
      typeof diagnostic.start === 'number' ? getLine(sourceFile, diagnostic.start) : undefined;
    diagnostics.push({
      severity: 'error',
      code: 'PARSE_ERROR',
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      line,
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      const parsedImport = parseImport(node);
      if (parsedImport) imports.push(parsedImport);
    }

    collectExport(node, exports, exportedNames, sourceFile);

    components.push(...parseComponentDeclaration(node, exportedNames, sourceFile));

    if (isJsxOpeningLike(node)) {
      jsxElements.push({
        tagName: getJsxTagName(node.tagName),
        line: getLine(sourceFile, node.getStart(sourceFile)),
      });

      const className = parseClassNameAttribute(node, sourceFile);
      if (className) classNameAttributes.push(className);
    }

    if (ts.isCallExpression(node)) {
      const callee = getExpressionName(node.expression);
      if (callee === 'cn') {
        cnExpressions.push({
          line: getLine(sourceFile, node.getStart(sourceFile)),
          raw: node.getText(sourceFile),
          stringLiterals: collectStringLiterals(node.arguments),
        });
      }

      if (callee === 'cva' || callee === 'tv') {
        const variantDefinition = parseVariantDefinition(node, callee, sourceFile);
        if (variantDefinition) variantDefinitions.push(variantDefinition);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (classNameAttributes.some((attribute) => attribute.kind === 'unsupported')) {
    diagnostics.push({
      severity: 'info',
      code: 'UNSUPPORTED_CLASSNAME_EXPRESSION',
      message: 'Some className expressions could not be reduced to static class literals.',
    });
  }

  return {
    path: filePath,
    language,
    imports,
    exports,
    components,
    jsxElements,
    classNameAttributes,
    cnExpressions,
    variantDefinitions,
    diagnostics,
  };
}

function parseImport(node: ts.ImportDeclaration): ParsedImport | null {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return null;

  const importClause = node.importClause;
  const parsed: ParsedImport = {
    moduleSpecifier: node.moduleSpecifier.text,
    namedImports: [],
  };

  if (!importClause) return parsed;

  if (importClause.name) parsed.defaultImport = importClause.name.text;

  const namedBindings = importClause.namedBindings;
  if (namedBindings && ts.isNamespaceImport(namedBindings)) {
    parsed.namespaceImport = namedBindings.name.text;
  }

  if (namedBindings && ts.isNamedImports(namedBindings)) {
    parsed.namedImports = namedBindings.elements.map((element) => element.name.text);
  }

  return parsed;
}

function collectExport(
  node: ts.Node,
  exports: ParsedExport[],
  exportedNames: Set<string>,
  sourceFile: ts.SourceFile
): void {
  if (isExported(node)) {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const name = declaration.name.text;
          exportedNames.add(name);
          exports.push({ name, kind: 'const' });
        }
      }
    } else {
      const name = getDeclarationName(node);
      if (name) {
        exportedNames.add(name);
        exports.push({ name, kind: getExportKind(node) });
      }
    }
  }

  if (ts.isExportAssignment(node)) {
    exports.push({
      name: node.expression.getText(sourceFile),
      kind: 'default',
    });
  }

  if (ts.isExportDeclaration(node)) {
    if (!node.exportClause) {
      exports.push({ name: '*', kind: 're-export' });
      return;
    }

    if (ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        exportedNames.add(element.name.text);
        exports.push({ name: element.name.text, kind: 'named' });
      }
    }
  }
}

function parseComponentDeclaration(
  node: ts.Node,
  exportedNames: Set<string>,
  sourceFile: ts.SourceFile
): ParsedComponent[] {
  if (ts.isFunctionDeclaration(node) && node.name && isPascalCase(node.name.text)) {
    return [
      {
        name: node.name.text,
        declarationKind: 'function',
        exported: isExported(node) || exportedNames.has(node.name.text),
        line: getLine(sourceFile, node.getStart(sourceFile)),
      },
    ];
  }

  if (ts.isClassDeclaration(node) && node.name && isPascalCase(node.name.text)) {
    return [
      {
        name: node.name.text,
        declarationKind: 'class',
        exported: isExported(node) || exportedNames.has(node.name.text),
        line: getLine(sourceFile, node.getStart(sourceFile)),
      },
    ];
  }

  if (ts.isVariableStatement(node)) {
    const result: ParsedComponent[] = [];
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !isPascalCase(declaration.name.text)) continue;
      const initializer = declaration.initializer;
      if (!initializer) continue;

      const declarationKind = getComponentInitializerKind(initializer);
      if (declarationKind === null) continue;

      result.push({
        name: declaration.name.text,
        declarationKind,
        exported: isExported(node) || exportedNames.has(declaration.name.text),
        line: getLine(sourceFile, declaration.getStart(sourceFile)),
      });
    }
    return result;
  }

  return [];
}

function parseClassNameAttribute(
  node: JsxOpeningLike,
  sourceFile: ts.SourceFile
): ParsedClassNameAttribute | null {
  const attribute = node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'className'
  );

  if (!attribute) return null;

  const tagName = getJsxTagName(node.tagName);
  const line = getLine(sourceFile, attribute.getStart(sourceFile));

  if (!attribute.initializer) {
    return {
      tagName,
      line,
      kind: 'unsupported',
      raw: attribute.getText(sourceFile),
      classes: [],
    };
  }

  if (ts.isStringLiteral(attribute.initializer)) {
    return {
      tagName,
      line,
      kind: 'string',
      raw: attribute.initializer.text,
      classes: splitClasses(attribute.initializer.text),
    };
  }

  if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
    const classes = collectStringLiterals([attribute.initializer.expression]).flatMap(splitClasses);

    return {
      tagName,
      line,
      kind: classes.length > 0 ? 'expression' : 'unsupported',
      raw: attribute.initializer.expression.getText(sourceFile),
      classes,
    };
  }

  return {
    tagName,
    line,
    kind: 'unsupported',
    raw: attribute.initializer.getText(sourceFile),
    classes: [],
  };
}

function parseVariantDefinition(
  node: ts.CallExpression,
  callee: 'cva' | 'tv',
  sourceFile: ts.SourceFile
): ParsedVariantDefinition | null {
  const variableName = getAssignedVariableName(node);
  if (!variableName) return null;

  const baseClasses = collectBaseClasses(node, callee);
  const config = getVariantConfigObject(node, callee);

  return {
    name: variableName,
    callee,
    line: getLine(sourceFile, node.getStart(sourceFile)),
    baseClasses,
    variants: config ? parseVariantsObject(config) : {},
    defaultVariants: config ? parseDefaultVariants(config, sourceFile) : {},
    compoundVariants: config ? parseCompoundVariants(config, sourceFile) : [],
    raw: node.getText(sourceFile),
  };
}

function collectBaseClasses(node: ts.CallExpression, callee: 'cva' | 'tv'): string[] {
  if (callee === 'cva') {
    const firstArgument = node.arguments[0];
    return firstArgument ? collectStringLiterals([firstArgument]).flatMap(splitClasses) : [];
  }

  const config = getVariantConfigObject(node, callee);
  const baseProperty = config ? findProperty(config, 'base') : null;
  return baseProperty?.initializer
    ? collectStringLiterals([baseProperty.initializer]).flatMap(splitClasses)
    : [];
}

function getVariantConfigObject(
  node: ts.CallExpression,
  callee: 'cva' | 'tv'
): ts.ObjectLiteralExpression | null {
  // tv extend (second argument) is not supported
  const argument = callee === 'cva' ? node.arguments[1] : node.arguments[0];
  return argument && ts.isObjectLiteralExpression(argument) ? argument : null;
}

function parseVariantsObject(
  config: ts.ObjectLiteralExpression
): Record<string, Record<string, string[]>> {
  const variantsProperty = findProperty(config, 'variants');
  if (
    !variantsProperty?.initializer ||
    !ts.isObjectLiteralExpression(variantsProperty.initializer)
  ) {
    return {};
  }

  const variants: Record<string, Record<string, string[]>> = {};
  for (const property of variantsProperty.initializer.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) {
      continue;
    }

    const axisName = getPropertyName(property.name);
    if (!axisName) continue;

    variants[axisName] = {};
    for (const variantProperty of property.initializer.properties) {
      if (!ts.isPropertyAssignment(variantProperty)) continue;
      const valueName = getPropertyName(variantProperty.name);
      if (!valueName) continue;
      variants[axisName][valueName] = collectStringLiterals([variantProperty.initializer]).flatMap(
        splitClasses
      );
    }
  }

  return variants;
}

function parseCompoundVariants(
  config: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile
): ParsedVariantDefinition['compoundVariants'] {
  const compoundVariantsProperty = findProperty(config, 'compoundVariants');
  if (
    !compoundVariantsProperty?.initializer ||
    !ts.isArrayLiteralExpression(compoundVariantsProperty.initializer)
  ) {
    return [];
  }

  const compoundVariants: ParsedVariantDefinition['compoundVariants'] = [];
  for (const element of compoundVariantsProperty.initializer.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    const conditions: Record<string, string> = {};
    const classes: string[] = [];

    for (const property of element.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = getPropertyName(property.name);
      if (!name) continue;
      if (name === 'class' || name === 'className') {
        classes.push(...collectStringLiterals([property.initializer]).flatMap(splitClasses));
        continue;
      }
      const value = getStaticPropertyValue(property.initializer, sourceFile);
      if (value) conditions[name] = value;
    }

    if (Object.keys(conditions).length > 0 || classes.length > 0) {
      compoundVariants.push({ conditions, classes });
    }
  }

  return compoundVariants;
}

function parseDefaultVariants(
  config: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile
): Record<string, string> {
  const defaultVariantsProperty = findProperty(config, 'defaultVariants');
  if (
    !defaultVariantsProperty?.initializer ||
    !ts.isObjectLiteralExpression(defaultVariantsProperty.initializer)
  ) {
    return {};
  }

  const defaults: Record<string, string> = {};
  for (const property of defaultVariantsProperty.initializer.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = getPropertyName(property.name);
    const value = getStaticPropertyValue(property.initializer, sourceFile);
    if (name && value) defaults[name] = value;
  }

  return defaults;
}

function collectStringLiterals(nodes: readonly ts.Node[]): string[] {
  const values: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      values.push(node.text);
      return;
    }

    ts.forEachChild(node, visit);
  }

  for (const node of nodes) visit(node);
  return values;
}

function getComponentInitializerKind(
  initializer: ts.Expression
): ParsedComponent['declarationKind'] | null {
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) return 'const';

  if (ts.isCallExpression(initializer)) {
    const callee = getExpressionName(initializer.expression);
    if (callee === 'forwardRef') return 'forwardRef';
    if (callee === 'memo') return 'memo';
  }

  return null;
}

function getAssignedVariableName(node: ts.CallExpression): string | null {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent)) return getPropertyName(parent.name);
  return null;
}

function findProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string
): ts.PropertyAssignment | null {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (getPropertyName(property.name) === propertyName) return property;
  }

  return null;
}

function getStaticPropertyValue(node: ts.Expression, sourceFile: ts.SourceFile): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  if (ts.isIdentifier(node)) return node.text;
  return node.getText(sourceFile);
}

function getPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return null;
}

function getExpressionName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return expression.getText();
}

function getDeclarationName(node: ts.Node): string | null {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node)) &&
    node.name
  ) {
    return node.name.text;
  }

  if (ts.isVariableStatement(node)) {
    const declaration = node.declarationList.declarations[0];
    if (declaration && ts.isIdentifier(declaration.name)) return declaration.name.text;
  }

  return null;
}

function getExportKind(node: ts.Node): ParsedExport['kind'] {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isVariableStatement(node)) return 'const';
  return 'named';
}

function isExported(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function isJsxOpeningLike(node: ts.Node): node is JsxOpeningLike {
  return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
}

/**
 * Extracts the literal string name from a JSX tag expression.
 * Used to normalize tag names for component parsing.
 */
function getJsxTagName(tagName: ts.JsxTagNameExpression): string {
  return tagName.getText();
}

function splitClasses(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

function getLine(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function isPascalCase(value: string): boolean {
  return /^[A-Z]/.test(value);
}
