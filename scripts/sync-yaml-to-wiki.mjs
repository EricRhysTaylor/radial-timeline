#!/usr/bin/env node
/**
 * Extracts YAML examples from a source markdown file and syncs to wiki
 * Usage: node scripts/sync-yaml-to-wiki.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_FILE = path.join(__dirname, '../docs/reference/yaml-reference.md');
const WIKI_FILE = path.join(__dirname, '../docs/wiki/YAML-Reference.md');

try {
  // Read source file
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`❌ Source file not found: ${SOURCE_FILE}`);
    console.log('💡 Create docs/reference/yaml-reference.md first');
    process.exit(1);
  }

  const content = fs.readFileSync(SOURCE_FILE, 'utf-8');

  // Ensure wiki directory exists
  const wikiDir = path.dirname(WIKI_FILE);
  if (!fs.existsSync(wikiDir)) {
    fs.mkdirSync(wikiDir, { recursive: true });
  }

  // Add wiki-specific header
  const wikiContent = `# YAML Field Reference

> **Note:** This page is auto-generated from [\`docs/reference/yaml-reference.md\`](../reference/yaml-reference.md)
> Last synced: ${new Date().toISOString()}

---

${content}`;

  // Write to wiki
  fs.writeFileSync(WIKI_FILE, wikiContent, 'utf-8');

  console.log('✅ YAML reference synced to wiki');
  console.log(`   Source: ${SOURCE_FILE}`);
  console.log(`   Wiki:   ${WIKI_FILE}`);

} catch (error) {
  console.error('❌ Error syncing YAML reference:', error.message);
  process.exit(1);
}
