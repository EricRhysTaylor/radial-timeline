// Obsidian guideline lint (eslint-plugin-obsidianmd) — STEP 3: report-only.
//
// This config is intentionally NOT wired as a blocking gate yet. It runs via
// `npm run lint:obsidian:report` (always exit 0) and as a report lane in
// run-gates.mjs. Once the blast radius is understood (step 4), individual
// rules can be promoted to errors and the overlapping custom regex checks
// retired per docs/engineering/audits/eslint-rule-mapping.md.
//
// Type-aware rules require parserOptions.project; tsconfig includes
// src/**/*.ts and excludes tests, so linting is scoped to non-test src files.
import tsparser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';
import { DEFAULT_ACRONYMS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js';

// Radial Timeline product vocabulary for obsidianmd/ui/sentence-case.
// `brands` REPLACES the plugin defaults, so the defaults are merged back in.
// Multi-word phrases go in brands (canonical casing is enforced wherever the
// phrase appears); single words that are feature names or frontmatter
// fields/values go in ignoreWords (capitalized occurrences are accepted,
// lowercase occurrences stay untouched).
const RT_BRANDS = [
  ...DEFAULT_BRANDS,
  'Radial Timeline',
  'Saga Timeline',
  'Inquiry Log',
  'Book Manager',
  'Book Details',
  'Book Pages',
  'Book profile',
  'Publishing Setup',
  'Pending Edits',
  'Progress Stage',
  'Author Progress Report',
  'Main Plot',
  'Goals & Sessions',
  'Early Access',
  'Google Fonts',
  'Export folder',
  'Brief + Log',
  'Clear chapter',
  'My Share',
];

const RT_ACRONYMS = [...DEFAULT_ACRONYMS, 'RT', 'APR', 'POV', 'BETA'];

// Feature names, note/frontmatter field names, and field values that are
// intentionally capitalized mid-sentence in UI strings.
const RT_IGNORE_WORDS = [
  'Inquiry', 'Gossamer', 'Chronologue', 'Narrative', 'Planetary', 'Omnibus',
  'Pandoc', 'Kickstarter', 'Patreon', 'Earth',
  'Pro', 'Core', 'Books', 'Publish', 'Settings',
  'Zero', 'Status', 'Complete', 'Due', 'When', 'Matter', 'Working',
  'StoryLine', 'PDFs', 'IDs',
  'Community',
];

// Whole strings the rule should skip: URL/model-id/date/color placeholders,
// keyboard shortcuts, stylized SVG labels, and sentence fragments.
// eslint.obsidian.enforced.config.mjs imports RT_SENTENCE_CASE_OPTIONS so the
// report lane and the enforced ratchet lane agree on the vocabulary.
const RT_IGNORE_REGEX = [
  '^https?://',
  '^e\\.g\\.',
  '^YYYY-MM-DD',
  '^#[0-9a-fA-F]{3,8}$',
  '^XXXX-XXXX-XXXX-XXXX$',
  '^llama3$',
  '⌘V',
  '^"Working"$',
  '^← Prev$',
  '^↑ SHIFT$',
  '^0 TRACES$',
  'Year \\d+',
  '^advanced workflows',
  'StoryLine',
];

export const RT_SENTENCE_CASE_OPTIONS = {
  enforceCamelCaseLower: true,
  brands: RT_BRANDS,
  acronyms: RT_ACRONYMS,
  ignoreWords: RT_IGNORE_WORDS,
  ignoreRegex: RT_IGNORE_REGEX,
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
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'obsidianmd/ui/sentence-case': ['error', RT_SENTENCE_CASE_OPTIONS],
    },
  },
]);
