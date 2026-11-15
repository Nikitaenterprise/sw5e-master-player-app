import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Головна: екран майстра або гравця, залежно від ?as=
        index: resolve(import.meta.dirname, 'index.html'),
        // Демо на чотирьох екранах — інструмент приймання власника (F-011)
        demo: resolve(import.meta.dirname, 'demo.html'),
      },
    },
  },
});
