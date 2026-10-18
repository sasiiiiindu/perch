/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { pwa } from './build/pwa.ts';

export default defineConfig({
  // Deployed as a GitHub Pages project site at https://sasiiiiindu.github.io/perch/,
  // so every built asset URL needs the /perch/ prefix. The dev server uses it
  // too, so local URLs match production: http://localhost:5173/perch/
  base: '/perch/',
  // Icons, manifest and offline service worker (build only).
  plugins: [pwa()],
  test: {
    include: ['tests/**/*.test.ts'],
    // Show console output from passing tests too: tests/pitch.test.ts prints
    // its worst-case error table at the end of the run.
    silent: false,
  },
});
