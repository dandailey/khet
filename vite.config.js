import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    },
    // Generate a single HTML file with inline CSS and JS
    outDir: 'dist',
    assetsInlineLimit: 100000000, // Inline everything
    cssCodeSplit: false,
    minify: 'terser'
  },
  server: {
    port: 3000,
    open: true
  }
})
