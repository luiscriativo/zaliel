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
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts'), ponte: resolve(__dirname, 'src/main/ponte.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      // Não apaga os chunks da build anterior: uma janela aberta ainda carrega os pedaços
      // sob demanda (ícones, importação) pelos nomes antigos. O `dist` limpa `out/` antes.
      emptyOutDir: false,
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
