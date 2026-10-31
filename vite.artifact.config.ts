import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Self-contained build for hosted preview pages: demo network, simulated GPS, no network calls.
export default defineConfig({
  mode: 'artifact',
  plugins: [viteSingleFile()],
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: 'dist-artifact',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: resolve(__dirname, 'index.html') },
  },
});
