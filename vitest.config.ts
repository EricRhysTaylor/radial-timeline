import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    
    // Environment - node is fine for utility testing
    environment: 'node',
    
    // Use threads pool instead of forks (better for sandboxed environments)
    pool: 'threads',
    
    // TypeScript support
    globals: true,

    // Many tests drive error paths on purpose, and the code under test logs
    // those errors (Community Share notices, search fallbacks, export
    // failures). Printing them for passing tests buried real failures under
    // ~120 console blocks per run. Console output still prints in full for a
    // failing test, which is the only time it helps.
    silent: 'passed-only',

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/types/**',
        'src/globals.d.ts',
        'src/i18n/locales/**',
        'src/data/**',
      ],
    },
    
    // Tests run in Node; alias `window` to globalThis for popout-safe code
    setupFiles: ['./tests/setup/window-shim.ts'],

    // Mock Obsidian API since we're testing in Node
    alias: {
      obsidian: './tests/mocks/obsidian.ts',
    },
  },
  
  // Resolve TypeScript paths
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});

