// Lint rules for the JavaScript backend (API, worker, tests) and the shared contracts.
// The Angular app has its own TypeScript-aware config in apps/web/eslint.config.js.

import js from '@eslint/js';
import promise from 'eslint-plugin-promise';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';

export default defineConfig([
  globalIgnores(['**/node_modules/', '**/dist/', 'apps/web/', '.playwright-mcp/']),

  {
    files: ['**/*.js'],
    extends: [js.configs.recommended, promise.configs['flat/recommended']],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // Promise chains must end in .catch or be returned/awaited (no unhandled rejections).
      'promise/catch-or-return': ['error', { allowFinally: true }],
      'promise/always-return': 'off',

      // Async code uses async/await, not hand-written Promise constructors.
      'promise/avoid-new': 'error',

      'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
      curly: ['error', 'multi-line'],
      'no-console': 'error',
    },
  },

  // Command-line scripts report to the terminal directly.
  {
    files: ['packages/contracts/scripts/**/*.js', 'apps/server/scripts/**/*.mjs', 'apps/server/src/cli/**/*.js'],
    rules: { 'no-console': 'off' },
  },

  // Browser journeys (Playwright): parts of each script run inside the page.
  {
    files: ['docs/verification/scripts/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
]);
