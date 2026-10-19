import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  plugins: [
    react({ jsxImportSource: 'react' }),
    tailwindcss(),
    {
      name: 'production-isolation',
      apply: 'build',
      generateBundle(_, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk') continue;
          for (const id of Object.keys(output.modules)) {
            if (
              /[/\\](?:src[/\\]app[/\\]dev|tests[/\\]fixtures)[/\\]|[/\\]src[/\\]lib[/\\]transport[/\\](?:fixture|scouting-fixture|review-fixture|harness)\.ts/.test(
                id,
              )
            ) {
              this.error(`Development module included in production: ${id}`);
            }
          }
        }
      },
    },
  ],
  clearScreen: false,
  server: {
    host: 'localhost',
    port: Number(process.env.RIFTMIND_DEV_PORT || 1420),
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/target/**', '**/.riftmind-dev/**'] },
    proxy: process.env.RIFTMIND_HARNESS_PORT
      ? {
          '/bridge': {
            target: `http://127.0.0.1:${process.env.RIFTMIND_HARNESS_PORT}`,
            ws: true,
            rewrite: (path) => path.replace(/^\/bridge/, ''),
          },
        }
      : undefined,
  },
});
