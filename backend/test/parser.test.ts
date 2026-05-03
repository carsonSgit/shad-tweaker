import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  parseComponentFile,
  parseComponentSource,
  resolveProjectParserPath,
} from '../src/services/parser.js';

const fixtureRoot = path.join(process.cwd(), 'test', 'fixtures', 'parser');

describe('component parser service', () => {
  it('resolves only TSX/JSX files inside the project root', () => {
    const root = path.resolve('project-root');

    assert.equal(
      resolveProjectParserPath('components/ui/button.tsx', root),
      path.join(root, 'components', 'ui', 'button.tsx')
    );
    assert.equal(resolveProjectParserPath('../outside.tsx', root), null);
    assert.equal(resolveProjectParserPath(path.resolve('outside.tsx'), root), null);
    assert.equal(resolveProjectParserPath('components/ui/button.ts', root), null);
  });

  it('extracts imports, exports, components, className, cn, and cva definitions', async () => {
    const parsed = await parseComponentFile(path.join(fixtureRoot, 'button.tsx'));

    assert.equal(parsed.language, 'tsx');
    assert.deepEqual(
      new Set(parsed.imports.map((item) => item.moduleSpecifier)),
      new Set(['react', '@radix-ui/react-slot', 'class-variance-authority', '@/lib/utils'])
    );

    assert.ok(parsed.exports.some((item) => item.name === 'Button' && item.kind === 'const'));
    assert.ok(
      parsed.exports.some((item) => item.name === 'buttonVariants' && item.kind === 'named')
    );
    assert.deepEqual(parsed.components, [
      {
        name: 'Button',
        declarationKind: 'forwardRef',
        exported: true,
        line: 34,
      },
    ]);

    const cnExpression = parsed.cnExpressions[0];
    assert.ok(cnExpression);
    assert.equal(cnExpression.stringLiterals.includes('cursor-pointer'), true);

    const className = parsed.classNameAttributes[0];
    assert.ok(className);
    assert.equal(className.tagName, 'Comp');
    assert.equal(className.kind, 'expression');
    assert.equal(className.classes.includes('cursor-pointer'), true);

    const cvaDefinition = parsed.variantDefinitions[0];
    assert.ok(cvaDefinition);
    assert.equal(cvaDefinition.name, 'buttonVariants');
    assert.equal(cvaDefinition.callee, 'cva');
    assert.equal(cvaDefinition.baseClasses.includes('inline-flex'), true);
    assert.deepEqual(cvaDefinition.variants, {
      variant: ['default', 'destructive', 'outline'],
      size: ['default', 'sm', 'icon'],
    });
    assert.deepEqual(cvaDefinition.defaultVariants, {
      variant: 'default',
      size: 'default',
    });
  });

  it('extracts tailwind-variants definitions and unsupported dynamic className diagnostics', async () => {
    const parsed = await parseComponentFile(path.join(fixtureRoot, 'card.tsx'));

    assert.ok(parsed.exports.some((item) => item.name === 'Card' && item.kind === 'function'));
    assert.ok(parsed.components.some((item) => item.name === 'Card' && item.exported));

    const tvDefinition = parsed.variantDefinitions[0];
    assert.ok(tvDefinition);
    assert.equal(tvDefinition.name, 'card');
    assert.equal(tvDefinition.callee, 'tv');
    assert.equal(tvDefinition.baseClasses.includes('rounded-lg'), true);
    assert.deepEqual(tvDefinition.variants, {
      density: ['compact', 'comfortable'],
      tone: ['neutral', 'brand'],
    });
    assert.deepEqual(tvDefinition.defaultVariants, {
      density: 'comfortable',
      tone: 'neutral',
    });

    const dynamicClass = parsed.classNameAttributes.find((item) => item.raw === 'dynamicClass');
    assert.ok(dynamicClass);
    assert.equal(dynamicClass.kind, 'unsupported');
    assert.ok(
      parsed.diagnostics.some(
        (diagnostic) => diagnostic.code === 'UNSUPPORTED_CLASSNAME_EXPRESSION'
      )
    );

    const staticClass = parsed.classNameAttributes.find(
      (item) => item.raw === 'flex items-center gap-2'
    );
    assert.ok(staticClass);
    assert.equal(staticClass.kind, 'string');
    assert.deepEqual(staticClass.classes, ['flex', 'items-center', 'gap-2']);
  });

  it('reports malformed source without throwing', () => {
    const parsed = parseComponentSource(
      'broken.tsx',
      "export function Broken() { return <div className='p-2'></span>; }"
    );

    assert.ok(parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
    assert.ok(parsed.jsxElements.some((element) => element.tagName === 'div'));
  });
});
