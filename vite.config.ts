/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Show console output from passing tests too: tests/pitch.test.ts prints
    // its worst-case error table at the end of the run.
    silent: false,
  },
});
