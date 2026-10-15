import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const alias = {
  '@zaliel/core': resolve(__dirname, '../../packages/core/src/index.ts'),
  '@zaliel/renderer': resolve(__dirname, '../../packages/renderer/src/index.ts'),
  '@zaliel/editor': resolve(__dirname, '../../packages/editor/src/index.ts'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ include: ['electron-updater'] })],
    resolve: { alias },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
