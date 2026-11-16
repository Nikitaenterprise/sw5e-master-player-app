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
        // Main page: GM screen or player screen, depending on ?as=
        index: resolve(import.meta.dirname, 'index.html'),
        // Four-screen demo — the owner's acceptance tool (F-011)
        demo: resolve(import.meta.dirname, 'demo.html'),
      },
    },
  },
});
