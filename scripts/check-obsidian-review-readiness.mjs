#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const ALLOWED_FILESYSTEM_ADAPTER_FILES = new Set([
  'src/modals/AuthorProgressModal.ts',
  'src/modals/ManuscriptOptionsModal.ts',
  'src/utils/exportFormats.ts'
]);

const ALLOWED_PROCESS_PLATFORM_FILES = new Set([
  'src/utils/exportFormats.ts'
]);

// Reviewed exception: localhost-only model-list probe needs AbortController +
// bounded body reads, which requestUrl cannot do (the "Load Servers" crash fix).
const ALLOWED_RUNTIME_FETCH_FILES = new Set([
  'src/ai/localLlm/transport.ts'
]);

const TELEMETRY_PATTERNS = [
  /\bmixpanel\b/,
  /\bposthog\b/,
  /\bamplitude\b/,
  /\bplausible\b/,
  /\bgoogle-analytics\b/,
  /\bsegment\.io\b/,
  /\banalytics\.track\b/,
  /\bga\s*\(/
];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function getAllFiles(dir) {
  const fullDir = path.join(ROOT, dir);
  if (!fs.existsSync(fullDir)) return [];
  const out = [];
  const stack = [fullDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(next);
      else out.push(path.relative(ROOT, next));
    }
  }
  return out;
}

function collectMatches(files, pattern) {
  const matches = [];
  for (const relativePath of files) {
    const lines = readText(relativePath).split('\n');
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        matches.push({ file: relativePath, line: index + 1, text: line.trim() });
      }
    });
  }
  return matches;
}

function ensure(condition, message, failures) {
  if (!condition) failures.push(message);
}

function includesAll(text, needles) {
  return needles.every(needle => text.includes(needle));
}

const failures = [];

const rootManifest = readJson('manifest.json');
const srcManifest = readJson('src/manifest.json');
const packageJson = readJson('package.json');
const readme = readText('README.md');
const privacyDoc = readText('docs/privacy-and-security.md');
const eyeballDoc = readText('docs/releases/pre-release-eyeball-checklist.md');

ensure(rootManifest.isDesktopOnly === true, 'Root manifest must set `isDesktopOnly` to true.', failures);
ensure(srcManifest.isDesktopOnly === true, 'Source manifest must set `isDesktopOnly` to true.', failures);
ensure(rootManifest.version === srcManifest.version, 'Root and source manifest versions must stay in sync.', failures);
ensure(rootManifest.minAppVersion === srcManifest.minAppVersion, 'Root and source manifest minAppVersion must stay in sync.', failures);

const versions = readJson('versions.json');
ensure(
  versions[rootManifest.version] === rootManifest.minAppVersion,
  `versions.json must map ${rootManifest.version} to minAppVersion ${rootManifest.minAppVersion} ` +
    `(found ${versions[rootManifest.version] ?? 'no entry'}). Hand-editing minAppVersion after a version ` +
    `bump drifts versions.json out of sync — update it to match the shipped manifest.`,
  failures
);

ensure(typeof packageJson.scripts?.lint === 'string', 'package.json must expose `npm run lint`.', failures);
ensure(typeof packageJson.scripts?.['review:obsidian'] === 'string', 'package.json must expose `npm run review:obsidian`.', failures);
ensure(typeof packageJson.scripts?.['release:eyeball'] === 'string', 'package.json must expose `npm run release:eyeball`.', failures);

ensure(includesAll(readme, [
  '## Desktop & Platform Support',
  '## Privacy & Security',
  '## External Services & Network Access'
]), 'README must include desktop, privacy, and network disclosure sections.', failures);

ensure(includesAll(privacyDoc, [
  'AI Off',
  'Social Connections',
  'No telemetry'
]), 'Privacy/security doc must cover AI Off, Social Connections, and no-telemetry posture.', failures);

ensure(eyeballDoc.includes('## Always check'), 'Pre-release eyeball checklist must include always-check guidance.', failures);

const srcFiles = getAllFiles('src').filter(file => /\.(ts|tsx|js|mjs)$/.test(file));
const runtimeFetchHits = collectMatches(srcFiles, /\bfetch\s*\(/).filter(hit => !ALLOWED_RUNTIME_FETCH_FILES.has(hit.file));
ensure(runtimeFetchHits.length === 0,
  `App runtime must not use raw fetch(). Found: ${runtimeFetchHits.map(hit => `${hit.file}:${hit.line}`).join(', ') || 'none'}`,
  failures);

const processPlatformHits = collectMatches(srcFiles, /process\.platform/).filter(hit => !ALLOWED_PROCESS_PLATFORM_FILES.has(hit.file));
ensure(processPlatformHits.length === 0,
  `App runtime should prefer Obsidian Platform over process.platform. Found: ${processPlatformHits.map(hit => `${hit.file}:${hit.line}`).join(', ') || 'none'}`,
  failures);

const fileSystemAdapterHits = collectMatches(srcFiles, /FileSystemAdapter/).filter(hit => !ALLOWED_FILESYSTEM_ADAPTER_FILES.has(hit.file));
ensure(fileSystemAdapterHits.length === 0,
  `FileSystemAdapter usage must stay in the reviewed desktop-only allowlist. Found: ${fileSystemAdapterHits.map(hit => `${hit.file}:${hit.line}`).join(', ') || 'none'}`,
  failures);

const packageText = readText('package.json').toLowerCase();
const srcText = srcFiles.map(file => readText(file).toLowerCase()).join('\n');
const telemetryHits = TELEMETRY_PATTERNS
  .filter(pattern => pattern.test(packageText) || pattern.test(srcText))
  .map(pattern => pattern.toString());
ensure(telemetryHits.length === 0,
  `Telemetry/analytics markers should not appear in package/runtime code. Found: ${telemetryHits.join(', ') || 'none'}`,
  failures);

if (failures.length > 0) {
  console.error('[obsidian-review] FAIL');
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log('[obsidian-review] PASS');
console.log('- Desktop-only manifests are aligned.');
console.log(`- versions.json maps ${rootManifest.version} to minAppVersion ${rootManifest.minAppVersion}.`);
console.log('- README and privacy/security disclosures are present.');
console.log('- Runtime network/platform/filesystem checks passed.');
console.log('- Release eyeball checklist is present.');
