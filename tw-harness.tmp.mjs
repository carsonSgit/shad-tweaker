import path from 'node:path';
import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const root = path.resolve('samples');

async function attempt(name, cssId, cssContent) {
  const plugin = {
    name: 'virtual-css',
    enforce: 'pre',
    resolveId(id) {
      if (id.startsWith('/__preview/styles.css') || id.startsWith(cssId)) {
        const query = id.includes('?') ? `?${id.split('?')[1]}` : '';
        return cssId + query;
      }
    },
    load(id) {
      if (id.startsWith(cssId)) return cssContent;
    },
  };
  const server = await createServer({
    appType: 'custom',
    root,
    logLevel: 'silent',
    plugins: [tailwindcss(), plugin],
    server: { middlewareMode: true },
  });
  try {
    const result = await server.transformRequest('/__preview/styles.css?direct');
    const code = result?.code ?? '';
    const hits = (code.match(/\.rounded-full|\.inline-flex|\.bg-primary/g) ?? []).length;
    console.log(name, '→ length', code.length, 'utility hits', hits);
  } catch (e) {
    console.log(name, '→ FAILED:', e.message.slice(0, 200));
  }
  await server.close();
}

const theme = '\n:root { --primary: black; }\n@theme inline { --color-primary: var(--primary); }\n';

await attempt(
  'A: source(none) + @source abs',
  '/__preview/styles.css',
  `@import "tailwindcss" source(none);\n@source ${JSON.stringify(root)};${theme}`
);
await attempt(
  'B: id inside root, auto detection',
  path.join(root, '__preview_styles.css'),
  `@import "tailwindcss";${theme}`
);
await attempt(
  'C: id inside root + explicit @source "."',
  path.join(root, '__preview_styles.css'),
  `@import "tailwindcss" source(none);\n@source "./";${theme}`
);
process.exit(0);
