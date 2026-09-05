#!/usr/bin/env node
import { execSync } from 'node:child_process';

function safe(command) {
  try {
    return execSync(command, { cwd: process.cwd(), stdio: 'pipe', encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function parseLines(value) {
  return value.split('\n').map(line => line.trim()).filter(Boolean);
}

function detectBaseRef() {
  const explicit = process.argv.find(arg => arg.startsWith('--base='));
  if (explicit) return explicit.slice('--base='.length);
  return safe('git describe --tags --abbrev=0') || 'HEAD~1';
}

function categorize(file) {
  if (/^(manifest\.json|src\/manifest\.json|package\.json|versions\.json)$/.test(file)) return 'Release metadata';
  if (/^README\.md$|^docs\//.test(file)) return 'Docs and disclosures';
  if (/^src\/ai\//.test(file)) return 'AI runtime';
  if (/^src\/api\//.test(file)) return 'Provider integrations';
  if (/^src\/settings\//.test(file)) return 'Settings';
  if (/^src\/modals\//.test(file)) return 'Modals';
  if (/^src\/styles\//.test(file)) return 'Styles';
  if (/^src\/publishing\//.test(file) || /^src\/utils\/exportFormats/.test(file)) return 'Publishing/export';
  if (/^src\/view\//.test(file)) return 'Timeline/view interactions';
  if (/^scripts\//.test(file)) return 'Build/release scripts';
  if (/^tests\//.test(file) || /\.test\.ts$/.test(file)) return 'Tests';
  if (/^src\//.test(file)) return 'Core runtime';
  return 'Other';
}

function unique(values) {
  return [...new Set(values)];
}

const baseRef = detectBaseRef();
const changed = parseLines(safe(`git diff --name-only ${baseRef}..HEAD`));
const statusFiles = parseLines(safe('git status --short')).map(line => line.replace(/^\s*[A-Z?]{1,2}\s+/, '').trim());
const files = unique([...changed, ...statusFiles]).filter(Boolean);
const surfaces = unique(files.map(categorize));

console.log('Release Eyeball Check');
console.log(`Base ref: ${baseRef}`);
console.log('');

console.log('Touched surfaces:');
if (surfaces.length === 0) {
  console.log('- None detected.');
} else {
  surfaces.forEach(surface => console.log(`- ${surface}`));
}
console.log('');

console.log('Touched files:');
if (files.length === 0) {
  console.log('- None detected.');
} else {
  files.forEach(file => console.log(`- ${file}`));
}
console.log('');

console.log('Personal eyeball checks before release:');
console.log('- Open the main timeline view and verify the last touched visual surface still reads cleanly.');
console.log('- Open every touched settings section and modal once, then confirm cancel/save/close behavior.');
console.log('- If styles changed, verify no clipped text, overlap, or broken spacing at normal desktop scale.');
console.log('- If publishing/export changed, manually open one generated artifact and test file/folder reveal.');
console.log('- If AI surfaces changed, turn AI Off and confirm the UI behaves like AI is actually unavailable.');
console.log('- Re-read README disclosures and confirm they still match the shipped behavior.');
