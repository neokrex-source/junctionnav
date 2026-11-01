import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { serviceWorker } from './scripts/sw-plugin';

// `npm run dev:https` serves over HTTPS on your LAN so a phone can use GPS.
export default defineConfig(({ mode }) => ({
  // Relative asset paths, so the build works at any address, including a GitHub Pages
  // project site (https://<user>.github.io/<repo>/).
  base: './',
  plugins: [serviceWorker(), ...(mode === 'https' ? [basicSsl()] : [])],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        lab: resolve(__dirname, 'lab.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
