import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  plugins: [react({ jsxImportSource: 'react' })],
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
