#!/usr/bin/env node
/**
 * Translation Coverage Checker
 * 
 * Compares language files to English (source of truth) and reports:
 * - Missing translation keys
 * - Translation coverage percentage
 * 
 * Usage: node scripts/check-translations.mjs [--verbose]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, '../src/i18n/locales');

// ANSI colors for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

const verbose = process.argv.includes('--verbose');

/**
 * Extract all string keys from an object using dot notation
 */
function extractKeys(obj, prefix = '') {
    const keys = [];
    
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        
        if (typeof value === 'string') {
            keys.push(fullKey);
        } else if (typeof value === 'object' && value !== null) {
            keys.push(...extractKeys(value, fullKey));
        }
    }
    
    return keys;
}

/**
 * Check if a key exists in an object (dot notation)
 */
function hasKey(obj, keyPath) {
    const parts = keyPath.split('.');
    let current = obj;
    
    for (const part of parts) {
        if (current && typeof current === 'object' && part in current) {
            current = current[part];
        } else {
            return false;
        }
    }
    
    return typeof current === 'string';
}

/**
 * Parse TypeScript locale file to extract the object
 * This is a simple approach - extracts the exported const object
 */
function parseLocaleFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Find the exported object (handles both `export const xx = { ... }` patterns)
    const match = content.match(/export const \w+[^=]*=\s*(\{[\s\S]*\})\s*(?:as const)?;?\s*$/m);
    
    if (!match) {
        throw new Error(`Could not parse locale file: ${filePath}`);
    }
    
    // Convert TypeScript object literal to valid JSON
    let objStr = match[1];
    
    // Remove trailing `as const`
    objStr = objStr.replace(/\s*as const\s*$/, '');
    
    // Remove comments
    objStr = objStr.replace(/\/\/.*$/gm, '');
    objStr = objStr.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Add quotes around unquoted keys
    objStr = objStr.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    
    // Replace single quotes with double quotes (for string values)
    objStr = objStr.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');
    
    // Remove trailing commas (not valid JSON)
    objStr = objStr.replace(/,(\s*[}\]])/g, '$1');
    
    try {
        return JSON.parse(objStr);
    } catch (e) {
        // Fallback: try evaluating as JS (less safe, but works for complex cases)
        console.warn(`${colors.yellow}Warning: Could not parse as JSON, falling back to eval${colors.reset}`);
        // This is a dev script, so eval is acceptable here
        return eval(`(${match[1].replace(/\s*as const\s*$/, '')})`);
    }
}

async function main() {
    console.log(`\n${colors.bright}📊 Translation Coverage Report${colors.reset}\n`);
    console.log(`${colors.dim}Locales directory: ${localesDir}${colors.reset}\n`);
    
    // Get all locale files
    const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.ts'));
    
    if (!files.includes('en.ts')) {
        console.error(`${colors.red}Error: en.ts (source of truth) not found!${colors.reset}`);
        process.exit(1);
    }
    
    // Parse English as the reference
    const enPath = path.join(localesDir, 'en.ts');
    const enObj = parseLocaleFile(enPath);
    const enKeys = extractKeys(enObj);
    
    console.log(`${colors.cyan}English (en.ts)${colors.reset}: ${enKeys.length} translation keys (source of truth)\n`);
    
    // Check each other locale
    const otherLocales = files.filter(f => f !== 'en.ts');
    
    if (otherLocales.length === 0) {
        console.log(`${colors.dim}No other locales found yet.${colors.reset}\n`);
        return;
    }
    
    console.log(`${colors.bright}Coverage by Language:${colors.reset}\n`);
    
    for (const file of otherLocales) {
        const langCode = file.replace('.ts', '');
        const filePath = path.join(localesDir, file);
        
        try {
            const localeObj = parseLocaleFile(filePath);
            const localeKeys = extractKeys(localeObj);
            
            // Find missing keys
            const missingKeys = enKeys.filter(key => !hasKey(localeObj, key));
            const translatedCount = enKeys.length - missingKeys.length;
            const percentage = ((translatedCount / enKeys.length) * 100).toFixed(1);
            
            // Color code the percentage
            let percentColor = colors.red;
            if (percentage >= 80) percentColor = colors.green;
            else if (percentage >= 50) percentColor = colors.yellow;
            
            console.log(`  ${colors.cyan}${langCode}${colors.reset}: ${percentColor}${percentage}%${colors.reset} (${translatedCount}/${enKeys.length} keys)`);
            
            if (verbose && missingKeys.length > 0) {
                console.log(`${colors.dim}    Missing keys:${colors.reset}`);
                for (const key of missingKeys.slice(0, 20)) {
                    console.log(`${colors.dim}      - ${key}${colors.reset}`);
                }
                if (missingKeys.length > 20) {
                    console.log(`${colors.dim}      ... and ${missingKeys.length - 20} more${colors.reset}`);
                }
                console.log();
            }
        } catch (e) {
            console.log(`  ${colors.cyan}${langCode}${colors.reset}: ${colors.red}Error parsing file${colors.reset}`);
            if (verbose) {
                console.log(`${colors.dim}    ${e.message}${colors.reset}`);
            }
        }
    }
    
    console.log(`\n${colors.dim}Run with --verbose to see missing keys${colors.reset}\n`);
}

main().catch(console.error);






































