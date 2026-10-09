import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';

// No extra dependency: inline the final JS and CSS after Vite has bundled them.
function singleFile(): Plugin {
  return {
    name: 'play-single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') throw new Error('Missing play HTML');
      let source = String(html.source);
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') {
          if (!output.isEntry || output.imports.length || output.dynamicImports.length) {
            throw new Error(`Unexpected external JS chunk: ${name}`);
          }
          const tag = /<script\b[^>]*src="[^"]+"[^>]*><\/script>/;
          if (!tag.test(source)) throw new Error('Missing entry script tag');
          source = source.replace(tag, () => `<script type="module">${output.code.replace(/<\/script/gi, '<\\/script')}</script>`);
          delete bundle[name];
        } else if (name.endsWith('.css')) {
          source = source.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/, () => `<style>${String(output.source)}</style>`);
          delete bundle[name];
        } else if (name !== 'index.html') {
          throw new Error(`Unexpected external asset: ${name}`);
        }
      }
      html.source = source;
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [singleFile()],
  worker: { format: 'iife' },
  build: {
    outDir: 'dist', emptyOutDir: true, cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
