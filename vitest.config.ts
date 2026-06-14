import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    env: {
      MINIMAX_API_KEY: 'test-sk-mock-key-for-vitest',
      MINIMAX_KEY_QUOTA: '10',
      MINIMAX_API_KEY_2: 'test-sk-mock-key-2-for-vitest',
      MINIMAX_KEY_2_QUOTA: '5',
    },
  },
});
