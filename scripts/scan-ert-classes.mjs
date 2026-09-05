#!/usr/bin/env node

/**
 * ERT_CLASSES Usage Scanner
 * 
 * Scans the codebase to find which ERT_CLASSES values are used vs unused.
 * 
 * Usage:
 *   node scripts/scan-ert-classes.mjs [--json] [--verbose]
 * 
 * Options:
 *   --json     Output results as JSON
 *   --verbose  Show file locations for each used class
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const CLASSES_FILE = path.join(projectRoot, 'src', 'ui', 'classes.ts');
const SRC_DIR = path.join(projectRoot, 'src');
const STYLES_DIR = path.join(projectRoot, 'src', 'styles');

// File extensions to scan
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const STYLE_EXTENSIONS = ['.css'];
const ALL_EXTENSIONS = [...CODE_EXTENSIONS, ...STYLE_EXTENSIONS];

// Files/directories to skip
const SKIP_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'release',
  'classes.ts', // Skip the source file itself
];

// ─────────────────────────────────────────────────────────────────────────────
// Parse ERT_CLASSES from source file
// ─────────────────────────────────────────────────────────────────────────────

function parseErtClasses(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const classes = new Map(); // key -> class value
  
  // Match lines like: KEY: 'value', or KEY: "value",
  const regex = /^\s*(\w+):\s*['"]([^'"]+)['"]/gm;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    const [, key, value] = match;
    // Only include lines within ERT_CLASSES object (before ERT_DATA)
    const matchIndex = match.index;
    const ertClassesStart = content.indexOf('export const ERT_CLASSES');
    const ertClassesEnd = content.indexOf('} as const;', ertClassesStart);
    
    if (matchIndex > ertClassesStart && matchIndex < ertClassesEnd) {
      classes.set(key, value);
    }
  }
  
  return classes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collect all files to scan
// ─────────────────────────────────────────────────────────────────────────────

function collectFiles(dir, extensions) {
  const files = [];
  
  function walk(currentDir) {
    if (!fs.existsSync(currentDir)) return;
    
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      // Skip patterns
      if (SKIP_PATTERNS.some(pattern => entry.name === pattern || fullPath.includes(pattern))) {
        continue;
      }
      
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
  
  walk(dir);
  return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan files for class usage
// ─────────────────────────────────────────────────────────────────────────────

function scanForClassUsage(files, classKey, classValue) {
  const usages = [];
  
  // Escape special regex characters in class value
  const escapedValue = classValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Patterns to match:
  // 1. Direct string usage: 'ert-row', "ert-row"
  // 2. Template literal: `ert-row` or `${...}ert-row`
  // 3. CSS selector: .ert-row { or .ert-row, or .ert-row:
  // 4. Part of larger class string: 'ert-row ert-stack'
  // 5. ERT_CLASSES.KEY_NAME reference (TypeScript)
  const stringPatterns = [
    // In strings (JS/TS)
    new RegExp(`['"\`]([^'"\`]*\\b${escapedValue}\\b[^'"\`]*)['"\`]`, 'g'),
    // CSS selectors
    new RegExp(`\\.${escapedValue}(?:[\\s,:{\\[]|$)`, 'g'),
  ];
  
  // Pattern to detect ERT_CLASSES.KEY usage
  const keyPattern = new RegExp(`ERT_CLASSES\\.${classKey}\\b`, 'g');
  
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const isCss = filePath.endsWith('.css');
      
      // Skip the classes.ts file itself for actual usage detection
      if (filePath.endsWith('classes.ts')) continue;
      
      lines.forEach((line, lineIndex) => {
        let matched = false;
        
        // Check for ERT_CLASSES.KEY pattern first (most specific)
        if (!isCss) {
          keyPattern.lastIndex = 0;
          if (keyPattern.test(line)) {
            matched = true;
          }
        }
        
        // Check string/CSS patterns
        if (!matched) {
          const patternSet = isCss ? [stringPatterns[1]] : stringPatterns;
          for (const pattern of patternSet) {
            pattern.lastIndex = 0;
            if (pattern.test(line)) {
              matched = true;
              break;
            }
          }
        }
        
        if (matched) {
          usages.push({
            file: path.relative(projectRoot, filePath),
            line: lineIndex + 1,
            content: line.trim().substring(0, 100),
          });
        }
      });
    } catch (error) {
      console.error(`Error reading ${filePath}:`, error.message);
    }
  }
  
  return usages;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main execution
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const verbose = args.includes('--verbose');
  
  // Parse ERT_CLASSES
  console.log('📦 Parsing ERT_CLASSES from', path.relative(projectRoot, CLASSES_FILE));
  const ertClasses = parseErtClasses(CLASSES_FILE);
  console.log(`   Found ${ertClasses.size} class definitions\n`);
  
  // Collect files to scan
  const codeFiles = collectFiles(SRC_DIR, CODE_EXTENSIONS);
  const styleFiles = collectFiles(STYLES_DIR, STYLE_EXTENSIONS);
  const allFiles = [...codeFiles, ...styleFiles];
  console.log(`🔍 Scanning ${allFiles.length} files (${codeFiles.length} code, ${styleFiles.length} CSS)\n`);
  
  // Scan for each class
  const results = {
    used: [],
    unused: [],
    summary: {
      total: ertClasses.size,
      used: 0,
      unused: 0,
    },
  };
  
  for (const [key, value] of ertClasses) {
    const usages = scanForClassUsage(allFiles, key, value);
    
    if (usages.length > 0) {
      results.used.push({
        key,
        value,
        count: usages.length,
        locations: verbose ? usages : undefined,
      });
    } else {
      results.unused.push({ key, value });
    }
  }
  
  results.summary.used = results.used.length;
  results.summary.unused = results.unused.length;
  
  // Sort results
  results.used.sort((a, b) => b.count - a.count);
  results.unused.sort((a, b) => a.key.localeCompare(b.key));
  
  // Output
  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  
  // Pretty print
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                      ERT_CLASSES USAGE REPORT');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  
  console.log(`📊 Summary: ${results.summary.used}/${results.summary.total} classes used (${results.summary.unused} unused)\n`);
  
  console.log('───────────────────────────────────────────────────────────────────');
  console.log(`✅ USED CLASSES (${results.used.length})`);
  console.log('───────────────────────────────────────────────────────────────────');
  
  for (const { key, value, count, locations } of results.used) {
    console.log(`  ${key.padEnd(30)} "${value}" (${count} usages)`);
    if (verbose && locations) {
      for (const loc of locations.slice(0, 3)) {
        console.log(`    └─ ${loc.file}:${loc.line}`);
      }
      if (locations.length > 3) {
        console.log(`    └─ ... and ${locations.length - 3} more`);
      }
    }
  }
  
  console.log('\n───────────────────────────────────────────────────────────────────');
  console.log(`⚠️  UNUSED CLASSES (${results.unused.length})`);
  console.log('───────────────────────────────────────────────────────────────────');
  
  if (results.unused.length === 0) {
    console.log('  (none - all classes are in use!)');
  } else {
    for (const { key, value } of results.unused) {
      console.log(`  ${key.padEnd(30)} "${value}"`);
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════════');
  
  // Exit with code based on unused count (for CI integration)
  if (results.unused.length > 0) {
    console.log(`\n💡 Consider removing ${results.unused.length} unused ERT_CLASSES entries.`);
    console.log('   Run with --verbose for detailed usage locations.');
  }
}

main();
