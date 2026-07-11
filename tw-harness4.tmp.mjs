import path from 'node:path';
import fs from 'node:fs';
import { createServer } from 'vite';
import tailwindcss from '@tailwindcss/vite';
const root = path.resolve('samples');
const cssPath = path.join(root, '.shadcn-tweaker', 'preview-styles.css');
const variants = {
  'auto': '@import "tailwindcss";',
  'source-parent': '@import "tailwindcss" source("../");',
  'at-source-rel': '@import "tailwindcss" source(none);\n@source "../components";',
  'at-source-abs': `@import "tailwindcss" source(none);\n@source "${root.replaceAll('\\', '/')}/components";`,
};
for (const [name, content] of Object.entries(variants)) {
  fs.writeFileSync(cssPath, content + '\n');
  const server = await createServer({ appType: 'custom', root, logLevel: 'silent', plugins: [tailwindcss()], server: { middlewareMode: true } });
  try {
    const result = await server.transformRequest('/.shadcn-tweaker/preview-styles.css?direct');
    const code = result?.code ?? '';
    console.log(name, '→ length', code.length, 'hits', (code.match(/\.rounded-full|\.inline-flex/g) ?? []).length);
  } catch (e) {
    console.log(name, '→ FAILED', e.message.slice(0, 120));
  }
  await server.close();
}
process.exit(0);
