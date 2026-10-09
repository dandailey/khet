import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [viteSingleFile()],
  worker: { format: 'iife' },
  build: {
    outDir: 'dist',
    cssCodeSplit: false,
    minify: 'terser',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined
      }
    }
  },
  server: {
    port: 3001,
    open: true
  }
})
