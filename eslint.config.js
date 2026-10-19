import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'target/**',
      'src-tauri/target/**',
      'src/generated/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        matchMedia: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        location: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Bun: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
