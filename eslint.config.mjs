import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Boundaries the layout exists to enforce (SPEC 3, SPEC 15). */
const NO_NODE_OR_ELECTRON = ['electron', 'electron/*', 'node:*', 'fs', 'path', 'os', 'crypto'];

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '*.tsbuildinfo'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Named exports only (SPEC 15).',
        },
      ],
    },
  },
  {
    // shared/ must run in a browser: no Node, no Electron, nothing from main.
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...NO_NODE_OR_ELECTRON, '**/main/**', '**/hud/**', '**/preload/**'],
              message: 'shared/ imports nothing outside shared/.',
            },
          ],
        },
      ],
    },
  },
  {
    // The reducer is pure: shared/ only.
    files: ['src/main/pipeline/reducer.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                ...NO_NODE_OR_ELECTRON,
                '@anthropic-ai/*',
                'electron-store',
                '../ai/**',
                '../capture/**',
                '../hotkeys/**',
                '../ipc/**',
                '../secrets/**',
                '../settings/**',
                '../trigger/**',
                '../window/**',
                '../log',
                './runner',
                './cache',
              ],
              message: 'pipeline/reducer.ts imports nothing outside shared/ (SPEC 2.4).',
            },
          ],
        },
      ],
    },
  },
  {
    // The HUD renders state. It has no Node, no Electron, no main.
    files: ['src/hud/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...NO_NODE_OR_ELECTRON, '**/main/**'],
              message: 'hud/ imports nothing from main/ (SPEC 15).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['*.config.ts', '*.config.mjs', '**/*.d.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
