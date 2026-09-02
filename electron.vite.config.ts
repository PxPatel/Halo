import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // A single entry on purpose: sandboxed preloads cannot require a
      // shared chunk, and rollup would emit one for a second entry.
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          hud: resolve(__dirname, 'src/hud/index.html'),
          capture: resolve(__dirname, 'src/capture-renderer/index.html'),
        },
      },
    },
  },
});
