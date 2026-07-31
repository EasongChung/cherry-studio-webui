import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    target: 'es2022',
    // pptx-renderer is intentionally lazily loaded (≈1.4MB) only when the user
    // previews a .pptx workspace file; raise the warning ceiling accordingly.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Split slow-moving framework libs into cacheable chunks; docx/pptx
        // previews are loaded lazily via dynamic import in main.ts.
        manualChunks: {
          'vue-vendor': ['vue', 'pinia'],
          'markdown-vendor': ['markdown-it', 'highlight.js']
        }
      }
    }
  }
})
