import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { serviceWorker } from './scripts/sw-plugin';

// `npm run dev:https` serves over HTTPS on your LAN so a phone can use GPS.
// `npm run build:android` builds the web app for the Android app (mode "android", .env.android):
// no service worker (the APK already holds every file) and no lab page.
export default defineConfig(({ mode }) => ({
  // Relative asset paths, so the build works at any address, including a GitHub Pages
  // project site (https://<user>.github.io/<repo>/).
  base: './',
  plugins: [...(mode === 'android' ? [] : [serviceWorker()]), ...(mode === 'https' ? [basicSsl()] : [])],
  build: {
    target: 'es2022',
    outDir: mode === 'android' ? 'dist-android' : 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input:
        mode === 'android'
          ? { main: resolve(__dirname, 'index.html') }
          : {
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
