#!/usr/bin/env node
/**
 * CSS Quality Checker
 * Scans styles.css for duplicate selectors and empty rulesets
 * Scans src/styles/*.css for !important declarations
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cssPath = join(process.cwd(), 'styles.css');
const srcStylesDir = join(process.cwd(), 'src', 'styles');
const quiet = process.argv.includes('--quiet');

// ========================================
// Check 1: !important declarations in source CSS
// ========================================
function checkImportantDeclarations() {
  const violations = [];
  
  try {
    const cssFiles = readdirSync(srcStylesDir).filter(f => f.endsWith('.css'));
    
    for (const file of cssFiles) {
      const filePath = join(srcStylesDir, file);
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      lines.forEach((line, idx) => {
        if (line.includes('!important')) {
          violations.push({
            file,
            line: idx + 1,
            content: line.trim()
          });
        }
      });
    }
  } catch (error) {
    // src/styles may not exist in some setups - skip silently
  }
  
  return violations;
}

const importantViolations = checkImportantDeclarations();

function reportImportantViolations() {
  console.log(`\x1b[31m❌ Found ${importantViolations.length} !important declaration(s) in source CSS:\x1b[0m\n`);
  importantViolations.forEach(({ file, line, content }) => {
    console.log(`  \x1b[33m${file}:${line}\x1b[0m`);
    console.log(`    ${content}`);
    console.log('');
  });
  console.log('\x1b[33m💡 Fix: Use proper CSS specificity instead of !important:\x1b[0m');
  console.log('   - Increase selector specificity: .rt-settings-root .setting-item { }');
  console.log('   - Use data attributes for mode states: [data-mode="active"] .element { }');
  console.log('   - Order rules correctly: base → state → hover (later wins)');
  console.log('   - See docs/engineering/standards/modal-styling.md for patterns\n');
}

// ========================================
// Check 2: Duplicate selectors and empty rulesets
// ========================================
// styles.css is a build artifact: absent on a fresh checkout until the first
// esbuild run. Pre-build invocations skip the artifact check explicitly; the
// post-build invocation in the build chain enforces it on fresh output.
if (!existsSync(cssPath)) {
  if (importantViolations.length > 0) {
    reportImportantViolations();
    process.exit(1);
  }
  console.log('⚠️  styles.css not built yet — skipping duplicate/empty-ruleset check (source !important check passed; the post-build check enforces the artifact).');
  process.exit(0);
}

try {
  const css = readFileSync(cssPath, 'utf-8');
  
  // Simple CSS parser - finds selectors, line numbers, and rule content
  const lines = css.split('\n');
  const selectors = new Map(); // selector -> array of line numbers
  const emptyRules = []; // array of {selector, line}
  
  let currentSelector = '';
  let currentSelectorLine = 0;
  let inComment = false;
  let braceDepth = 0;
  let ruleContent = '';
  
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    const lineNum = idx + 1;
    
    // Handle multi-line comments
    if (trimmed.includes('/*')) inComment = true;
    if (inComment) {
      if (trimmed.includes('*/')) inComment = false;
      return;
    }
    
    // Skip empty lines and single-line comments
    if (!trimmed || trimmed.startsWith('//')) return;
    
    // Track brace depth
    const openBraces = (line.match(/{/g) || []).length;
    const closeBraces = (line.match(/}/g) || []).length;
    
    // If we're at depth 0 and see a selector (line with { but not starting with @)
    if (braceDepth === 0 && trimmed.includes('{') && !trimmed.startsWith('@')) {
      // Extract selector (everything before {)
      const selector = trimmed.split('{')[0].trim();
      if (selector) {
        currentSelector = selector;
        currentSelectorLine = lineNum;
        ruleContent = '';
        
        if (!selectors.has(selector)) {
          selectors.set(selector, []);
        }
        selectors.get(selector).push(lineNum);
      }
    }
    
    // Collect rule content (between braces)
    if (braceDepth > 0 && !trimmed.includes('{')) {
      ruleContent += trimmed;
    }
    
    // Check for empty ruleset when closing brace
    if (braceDepth === 1 && closeBraces > 0 && currentSelector) {
      // Remove comments from rule content
      const contentWithoutComments = ruleContent.replace(/\/\*.*?\*\//g, '').trim();
      if (!contentWithoutComments || contentWithoutComments === '') {
        emptyRules.push({ selector: currentSelector, line: currentSelectorLine });
      }
      currentSelector = '';
      ruleContent = '';
    }
    
    braceDepth += openBraces - closeBraces;
    if (braceDepth < 0) braceDepth = 0;
  });
  
  // Find duplicates
  const duplicates = [];
  for (const [selector, lineNumbers] of selectors.entries()) {
    if (lineNumbers.length > 1) {
      duplicates.push({ selector, lines: lineNumbers });
    }
  }
  
  // Report results
  let hasIssues = false;
  
  // Check for !important violations first
  if (importantViolations.length > 0) {
    reportImportantViolations();
    hasIssues = true;
  }
  
  if (duplicates.length > 0) {
    console.log(`⚠️  Found ${duplicates.length} duplicate CSS selector(s):\n`);
    duplicates.forEach(({ selector, lines }) => {
      console.log(`  ${selector}`);
      console.log(`    Defined at lines: ${lines.join(', ')}`);
      console.log('');
    });
    console.log('💡 Tip: Consolidate duplicate rules to avoid conflicts.\n');
    hasIssues = true;
  }
  
  if (emptyRules.length > 0) {
    console.log(`⚠️  Found ${emptyRules.length} empty CSS ruleset(s):\n`);
    emptyRules.forEach(({ selector, line }) => {
      console.log(`  ${selector}`);
      console.log(`    Line ${line}`);
      console.log('');
    });
    console.log('💡 Tip: Remove empty rulesets or add properties.\n');
    hasIssues = true;
  }
  
  if (!hasIssues) {
    if (!quiet) {
      console.log('✅ No CSS quality issues found (no duplicates, empty rulesets, or !important).');
    }
    process.exit(0);
  } else {
    process.exit(1);
  }
  
} catch (error) {
  console.error('Error reading styles.css:', error.message);
  process.exit(1);
}

