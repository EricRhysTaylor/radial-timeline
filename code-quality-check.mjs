#!/usr/bin/env node

/**
 * Script to check for Obsidian.md guideline violations and TypeScript best practices
 * This script scans JavaScript and TypeScript files for:
 * 1. innerHTML, outerHTML, and inline CSS usage (Obsidian guidelines)
 * 2. Usage of 'any' type in TypeScript files (TypeScript best practices)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// The patterns to check for in the code
const PATTERNS = [
  { pattern: /\.innerHTML\s*=/g, message: 'innerHTML assignment' },
  { pattern: /\.outerHTML\s*=/g, message: 'outerHTML assignment' },
  { pattern: /style\s*=\s*["']{/g, message: 'inline style object assignment' },
  { pattern: /\.style\.(backgroundColor|color|fontSize|fontWeight|margin|padding|border|width|height|display|position)\s*=/g, message: 'inline CSS property assignment' },
  { pattern: /style\s*=\s*["'][^"']+["']/g, message: 'inline style attribute' },
  { pattern: /document\.createElement.*style\s*=/g, message: 'inline style during element creation' },
  { pattern: /getLeaf\([^)]*\)\.openFile\(/g, message: 'direct getLeaf().openFile() call - use workspace.openLinkText() instead' },
];

// Allowlist for specific patterns that are known to be safe
// Format: array of strings that if found in the line, will exempt the match
const ALLOWLIST = [
  '// SAFE: innerHTML used for',  // Special comment to mark safe usage
  '// SAFE: inline style used for', // Special comment for inline styles
  '// SAFE: Modal sizing',        // Modal sizing via modalEl (Obsidian pattern)
  '// SAFE: any type used for',   // Special comment for allowed 'any' types
  '// SAFE: openFile used for',  // Special comment for allowed openFile usage
  'document.createElementNS',     // Safe SVG creation pattern
  'createSvgElement',             // Our safe SVG helper
  '.DOMParser',                   // Using DOM parser is safe
  'parser.parseFromString',       // Parsing from string with DOMParser is safe
  'eslint-disable-line',          // Explicitly disabled by lint
  'code-quality-check',           // References to this script itself
  'this script itself',           // Documentation about this script
  '// Allowlist:',                // Allow comments about the allowlist
  '/styles.css',                  // Reference to the styles.css file
  'classList.add',                // Using classList is the recommended approach
  'classList.remove',             // Using classList is the recommended approach
  'classList.toggle',             // Using classList is the recommended approach
];

// TypeScript "any" type check pattern
const ANY_TYPE_PATTERN = { pattern: /: any\b/g, message: 'TypeScript "any" type' };

// List of allowed 'any' type usage contexts (e.g., log functions)
const ALLOWED_ANY_CONTEXTS = [
  'log(message: string, data?: any)',
  'console.log',
  'console.error',
  'obsidian-augment.ts', // Type augmentation file matches Obsidian's official API
];

// Scope enforcement for settings.css: selectors that touch Obsidian settings classes must live under .rt-settings-root
const SETTINGS_SCOPE_TOKENS = [
  '.setting-item',
  '.setting-item-control',
  '.setting-item-info',
  '.setting-item-name',
  '.setting-item-description',
  '.setting-item-heading',
  '.documentation-container',
  '.clickable-icon',
];

// CSS class naming pattern - must start with rt- or radial-timeline-
// Matches: addClass('class-name'), removeClass('class-name'), toggleClass('class-name'), cls: 'class-name'
const CSS_CLASS_PATTERN = { 
  pattern: /(?:addClass|removeClass|toggleClass|cls:\s*)[\(\s]['"]([a-z][a-z0-9-]*)['"][\)\s,]/gi, 
  message: 'CSS class without rt- or radial-timeline- prefix' 
};

// Allowed class names that don't need the rt- prefix (Obsidian core classes, etc.)
const ALLOWED_CLASS_NAMES = [
  // Obsidian core classes
  'setting-item',
  'setting-item-control',
  'setting-item-info',
  'setting-item-name',
  'setting-item-description',
  'setting-input-error',    // Obsidian native form validation class
  'setting-input-success',  // Obsidian native form validation class
  'modal',
  'modal-container',
  'modal-content',
  'modal-close-button',
  'workspace-leaf',
  'view-header',
  'view-content',
  // External library classes
  'cm-',  // CodeMirror prefix
  'mod-styled-scrollbar',  // Obsidian built-in scrollbar styling
];

// Check if a CSS class name is allowed (has proper prefix or is in exception list)
function isAllowedClassName(className) {
  // Check if it starts with ert- (primary UI namespace)
  if (className.startsWith('ert-')) {
    return true;
  }
  
  // Allow state modifier classes: is-* and has-*
  if (className.startsWith('is-') || className.startsWith('has-')) {
    return true;
  }
  
  // Legacy: still allow rt- and radial-timeline- for backwards compatibility
  if (className.startsWith('rt-') || className.startsWith('radial-timeline-')) {
    return true;
  }
  
  // Check if it's in the allowed list
  return ALLOWED_CLASS_NAMES.some(allowed => {
    if (allowed.endsWith('-')) {
      // Prefix match (e.g., 'cm-' matches 'cm-editor')
      return className.startsWith(allowed);
    }
    // Exact match
    return className === allowed;
  });
}

// Check if a line with a match should be ignored because it's in the allowlist
function isInAllowlist(line, pattern, filePath = '') {
  if (ALLOWLIST.some(allowedPattern => line.includes(allowedPattern))) {
    return true;
  }
  
  // Special handling for 'any' type in allowed contexts
  if (pattern === ANY_TYPE_PATTERN.pattern) {
    return ALLOWED_ANY_CONTEXTS.some(context => line.includes(context) || filePath.includes(context));
  }
  
  return false;
}

// Process a single file
function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let hasViolations = false;
    let violations = [];
    
    // For TypeScript files, also check for 'any' type usage
    const isTypeScript = filePath.endsWith('.ts');
    const isSettingsCss = filePath.endsWith(path.join('src', 'styles', 'settings.css')) || filePath.includes('src/styles/settings.css');
    
    lines.forEach((line, lineNumber) => {
      // Check Obsidian guidelines patterns
      PATTERNS.forEach(({ pattern, message }) => {
        if (pattern.test(line) && !isInAllowlist(line, pattern, filePath)) {
          hasViolations = true;
          violations.push({
            line: lineNumber + 1,
            content: line.trim(),
            message
          });
        }
      });
      
      // Check TypeScript 'any' types for TS files
      if (isTypeScript) {
        const { pattern, message } = ANY_TYPE_PATTERN;
        if (pattern.test(line) && !isInAllowlist(line, pattern, filePath)) {
          hasViolations = true;
          violations.push({
            line: lineNumber + 1,
            content: line.trim(),
            message
          });
        }
      }
      
      // Check CSS class naming for TypeScript files (not CSS files)
      if (isTypeScript && !isInAllowlist(line, CSS_CLASS_PATTERN.pattern, filePath)) {
        const { pattern, message } = CSS_CLASS_PATTERN;
        let match;
        // Reset lastIndex for global regex
        pattern.lastIndex = 0;
        while ((match = pattern.exec(line)) !== null) {
          const className = match[1];
          if (!isAllowedClassName(className)) {
            hasViolations = true;
            violations.push({
              line: lineNumber + 1,
              content: line.trim(),
              message: `${message}: '${className}' should be prefixed (ert-/rt-/radial-timeline-)`
            });
          }
        }
      }
    });

    if (hasViolations) {
      console.error(`\x1b[31mViolations found in ${filePath}:\x1b[0m`);
      violations.forEach(v => {
        console.error(`  Line ${v.line}: ${v.message} - ${v.content}`);
      });
      return false;
    }

    // Additional check: enforce .rt-settings-root scoping in settings.css
    if (isSettingsCss) {
      const scopeViolations = [];
      lines.forEach((line, lineNumber) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('@') || !trimmed.includes('{')) return;
        const lower = trimmed.toLowerCase();
        const touchesSettings = SETTINGS_SCOPE_TOKENS.some(token => lower.includes(token));
        if (touchesSettings && !lower.includes('.rt-settings-root')) {
          scopeViolations.push({
            line: lineNumber + 1,
            content: trimmed,
            message: 'settings.css selectors touching Obsidian settings classes must be scoped under .rt-settings-root'
          });
        }
      });

      if (scopeViolations.length > 0) {
        console.error(`\x1b[31mViolations found in ${filePath}:\x1b[0m`);
        scopeViolations.forEach(v => {
          console.error(`  Line ${v.line}: ${v.message} - ${v.content}`);
        });
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    return false;
  }
}

// Process files passed as arguments
function collectAllFiles() {
  const root = process.cwd();
  const srcDir = path.join(root, 'src');
  const results = [];

  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.name.endsWith('.ts')) {
        results.push(fullPath);
      }
    }
  };

  walk(srcDir);

  const keyCssFiles = [
    path.join(root, 'src', 'styles', 'settings.css'),
    path.join(root, 'src', 'styles', 'rt-ui.css'),
    path.join(root, 'src', 'styles', 'modal.css'),
    path.join(root, 'src', 'styles', 'inquiry.css'),
  ];

  keyCssFiles.forEach((filePath) => {
    if (fs.existsSync(filePath)) {
      results.push(filePath);
    }
  });

  return Array.from(new Set(results));
}

function main() {
  const args = process.argv.slice(2);
  const quiet = args.includes('--quiet');
  const useAll = args.includes('--all');
  const files = useAll ? collectAllFiles() : args.filter(arg => !arg.startsWith('--'));
  
  if (files.length === 0) {
    console.error('No files specified');
    process.exit(1);
  }

  let allFilesPass = true;
  for (const file of files) {
    const passes = processFile(file);
    allFilesPass = allFilesPass && passes;
  }

  if (!allFilesPass) {
    console.error('\n\x1b[31mViolations found. Commit aborted.\x1b[0m');
    console.error('\x1b[33mYou must fix these violations before committing.\x1b[0m');
    console.error('\n\x1b[33mFor safe DOM manipulation:\x1b[0m');
    console.error('  - Use element.textContent instead of innerHTML for text content');
    console.error('  - Use document.createElement and appendChild for DOM manipulation');
    console.error('  - For SVG elements, use document.createElementNS with the correct namespace');
    
    console.error('\n\x1b[33mFor CSS styling:\x1b[0m');
    console.error('  - Keep all CSS in styles.css file, not inline in JavaScript/TypeScript');
    console.error('  - Use classList methods to add/remove classes instead of manipulating className');
    console.error('  - Define styles in CSS classes and apply them with classList.add()');
    console.error('  - If dynamic styling is necessary, create CSS classes with CSS variables');
    
    console.error('\n\x1b[33mFor TypeScript best practices:\x1b[0m');
    console.error('  - Avoid using the "any" type - use specific types or unknown instead');
    console.error('  - If you must use "any", add a comment explaining why: // SAFE: any type used for <reason>');
    
    console.error('\n\x1b[33mFor CSS class naming:\x1b[0m');
    console.error('  - Component base classes MUST start with "ert-" (primary UI namespace)');
    console.error('  - State modifier classes may use "is-*" or "has-*" (e.g., is-active, has-error)');
    console.error('  - Legacy "rt-" and "radial-timeline-" prefixes are still allowed');
    console.error('  - Example: addClass(\'ert-settings-row\') or addClass(\'is-active\')');
    console.error('  - This prevents conflicts with Obsidian core styles and other plugins');
    
    console.error('\n\x1b[33mFor opening files:\x1b[0m');
    console.error('  - Use workspace.openLinkText(filePath, \'\', false) instead of getLeaf().openFile()');
    console.error('  - openLinkText() automatically prevents duplicate tabs (recommended by Obsidian)');
    console.error('  - If you must use openFile(), add a comment: // SAFE: openFile used for <reason>');
    
    console.error('\n\x1b[33mIf you believe this is a false positive, add a SAFE comment ON THE SAME LINE:\x1b[0m');
    console.error('  textPath.innerHTML = html; // SAFE: innerHTML used for <reason>');
    console.error('  el.style.width = "100px"; // SAFE: inline style used for <reason>');
    console.error('  modalEl.style.width = "660px"; // SAFE: Modal sizing via inline styles (Obsidian pattern)');
    console.error('  data: any // SAFE: any type used for <reason>');
    console.error('  .openFile(file) // SAFE: openFile used for <reason>');
    console.error('\n📖 See docs/engineering/standards/code-standards.md for detailed guidelines and best practices.\n');
    process.exit(1);
  }

  if (!quiet) {
    console.log('\x1b[32m✅ Code quality check passed!\x1b[0m');
    console.log('📖 See docs/engineering/standards/code-standards.md for full guidelines.');
  }
}

main(); 
