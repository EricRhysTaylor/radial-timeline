// Enforced Obsidian lint subset.
//
// The full eslint-plugin-obsidianmd recommended preset remains report-only in
// eslint.config.mjs because it currently surfaces thousands of findings. This
// config promotes only the confirmed, high-signal replacement rules from the
// rule-mapping audit. scripts/lint-obsidian-enforced.mjs compares these counts
// to scripts/eslint-obsidian-enforced-baseline.json so existing debt is frozen
// without turning every gate red.
import tsparser from '@typescript-eslint/parser';
import tseslint from '@typescript-eslint/eslint-plugin';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { RT_SENTENCE_CASE_OPTIONS } from './eslint.config.mjs';

export const ENFORCED_OBSIDIAN_RULES = [
  'obsidianmd/no-static-styles-assignment',
  'obsidianmd/prefer-window-timers',
  'obsidianmd/ui/sentence-case',
  '@typescript-eslint/no-unnecessary-type-assertion',
  '@typescript-eslint/no-floating-promises',
];

// Rules that take options; everything else is plain 'error'.
const RULE_OPTIONS = {
  'obsidianmd/ui/sentence-case': ['error', RT_SENTENCE_CASE_OPTIONS],
};

export default defineConfig([
  {
    ignores: [
      'release/**',
      'dist/**',
      'main.js',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'scripts/**',
      'tests/**',
      'src/**/*.test.ts',
    ],
  },
  {
    files: ['src/**/*.ts'],
    plugins: {
      obsidianmd,
      '@typescript-eslint': tseslint,
    },
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: Object.fromEntries(ENFORCED_OBSIDIAN_RULES.map(rule => [rule, RULE_OPTIONS[rule] ?? 'error'])),
  },
]);
