import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the junction lab as one self-contained HTML file (no network needed).
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist-lab',
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'lab.html') },
  },
});
