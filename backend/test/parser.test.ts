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
    assert.equal(resolveProjectParserPath('', root), null);
    assert.equal(resolveProjectParserPath('   ', root), null);
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
    const button = parsed.components.find((c) => c.name === 'Button');
    assert.ok(button);
    assert.equal(button.declarationKind, 'forwardRef');
    assert.equal(button.exported, true);
    assert.equal(typeof button.line, 'number');

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
      variant: {
        default: ['bg-primary', 'text-primary-foreground'],
        destructive: ['bg-destructive', 'text-destructive-foreground'],
        outline: ['border', 'border-input', 'bg-background'],
      },
      size: {
        default: ['h-10', 'px-4', 'py-2'],
        sm: ['h-9', 'rounded-md', 'px-3'],
        icon: ['h-10', 'w-10'],
      },
    });
    assert.deepEqual(cvaDefinition.defaultVariants, {
      variant: 'default',
      size: 'default',
    });
    assert.deepEqual(cvaDefinition.compoundVariants, [
      {
        conditions: { variant: 'outline', size: 'sm' },
        classes: ['border-primary', 'px-2'],
      },
    ]);
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
      density: {
        compact: ['p-3', 'gap-2'],
        comfortable: ['p-6', 'gap-4'],
      },
      tone: {
        neutral: ['border-border'],
        brand: ['border-primary/40'],
      },
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

  it('correctly identifies bottom-of-file re-exports as exported', () => {
    const source = `
function MyComponent() {
  return <div />;
}

export { MyComponent };
    `;
    const parsed = parseComponentSource('test.tsx', source);
    const component = parsed.components.find((c) => c.name === 'MyComponent');
    assert.ok(component, 'Component should be found');
    assert.equal(component.exported, true, 'Component should be marked as exported');
  });

  it('handles multiple variable declarations in a single export statement', () => {
    const source = `
export const ComponentA = () => <div />, ComponentB = () => <span />;
    `;
    const parsed = parseComponentSource('test.tsx', source);
    const compA = parsed.components.find((c) => c.name === 'ComponentA');
    const compB = parsed.components.find((c) => c.name === 'ComponentB');

    assert.ok(compA, 'ComponentA should be found');
    assert.ok(compB, 'ComponentB should be found');
    assert.equal(compA.exported, true, 'ComponentA should be exported');
    assert.equal(compB.exported, true, 'ComponentB should be exported');

    assert.ok(
      parsed.exports.some((e) => e.name === 'ComponentA'),
      'Export ComponentA should be found'
    );
    assert.ok(
      parsed.exports.some((e) => e.name === 'ComponentB'),
      'Export ComponentB should be found'
    );
  });
});
