#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const localesDir = path.join(root, 'src/i18n/locales');
const i18nIndexPath = path.join(root, 'src/i18n/index.ts');
const releaseBundlePath = path.join(root, 'release/main.js');

const minTranslatedKeys = {
  ja: 937,
  zh: 937,
  ko: 937,
  de: 937,
};

const bundleSentinels = {
  en: 'Legacy: source path (deprecated)',
  ja: 'ソースパス',
  zh: '源路径',
  ko: '원본 경로',
  de: 'Quellpfad',
};

function fail(message) {
  console.error(`[i18n-release] ${message}`);
  process.exitCode = 1;
}

function extractSupportedLocales(source) {
  const match = source.match(/SUPPORTED_LOCALES\s*=\s*\[([^\]]+)\]/m);
  if (!match) {
    throw new Error('Could not find SUPPORTED_LOCALES in src/i18n/index.ts');
  }
  return [...match[1].matchAll(/['"]([a-z-]+)['"]/g)].map(item => item[1]);
}

function extractKeys(obj, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      keys.push(fullKey);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...extractKeys(value, fullKey));
    }
  }
  return keys;
}

function hasKey(obj, keyPath) {
  let current = obj;
  for (const part of keyPath.split('.')) {
    if (!current || typeof current !== 'object' || !(part in current)) return false;
    current = current[part];
  }
  return typeof current === 'string';
}

function parseLocaleFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/export const \w+[^=]*=\s*(\{[\s\S]*\})\s*(?:as const)?;?\s*$/m);
  if (!match) {
    throw new Error(`Could not parse locale file: ${path.relative(root, filePath)}`);
  }

  let objStr = match[1]
    .replace(/\s*as const\s*$/, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
    .replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"')
    .replace(/,(\s*[}\]])/g, '$1');

  try {
    return JSON.parse(objStr);
  } catch {
    return eval(`(${match[1].replace(/\s*as const\s*$/, '')})`);
  }
}

function bundleContains(bundle, value) {
  const escaped = [...value]
    .map(char => {
      const code = char.charCodeAt(0);
      return code > 127 ? `\\u${code.toString(16).padStart(4, '0')}` : char;
    })
    .join('')
    .toLowerCase();
  const lowerBundle = bundle.toLowerCase();
  return bundle.includes(value) || lowerBundle.includes(escaped);
}

const indexSource = fs.readFileSync(i18nIndexPath, 'utf8');
const supportedLocales = extractSupportedLocales(indexSource);
const localeFiles = fs.readdirSync(localesDir)
  .filter(file => file.endsWith('.ts'))
  .map(file => file.replace(/\.ts$/, ''))
  .sort();

for (const locale of supportedLocales) {
  const filePath = path.join(localesDir, `${locale}.ts`);
  if (!fs.existsSync(filePath)) {
    fail(`SUPPORTED_LOCALES includes ${locale}, but src/i18n/locales/${locale}.ts is missing.`);
  }
  const importRegex = new RegExp(`import\\s+\\{\\s*${locale}\\b[\\s\\S]*?\\}\\s+from\\s+['"]\\.\\/locales\\/${locale}['"]`);
  if (!importRegex.test(indexSource)) {
    fail(`SUPPORTED_LOCALES includes ${locale}, but src/i18n/index.ts does not import ./locales/${locale}.`);
  }
}

for (const locale of localeFiles) {
  if (!supportedLocales.includes(locale)) {
    fail(`src/i18n/locales/${locale}.ts exists, but ${locale} is not listed in SUPPORTED_LOCALES.`);
  }
}

const english = parseLocaleFile(path.join(localesDir, 'en.ts'));
const englishKeys = extractKeys(english);
console.log(`[i18n-release] English source keys: ${englishKeys.length}`);

for (const locale of supportedLocales.filter(locale => locale !== 'en')) {
  const localeObj = parseLocaleFile(path.join(localesDir, `${locale}.ts`));
  const translatedCount = englishKeys.filter(key => hasKey(localeObj, key)).length;
  const floor = minTranslatedKeys[locale] ?? 1;
  const percentage = ((translatedCount / englishKeys.length) * 100).toFixed(1);
  console.log(`[i18n-release] ${locale}: ${translatedCount}/${englishKeys.length} (${percentage}%)`);
  if (translatedCount < floor) {
    fail(`${locale} translated key count regressed below ${floor}: ${translatedCount}.`);
  }
}

if (!fs.existsSync(releaseBundlePath)) {
  fail('release/main.js is missing; run a production build before release.');
} else {
  const releaseBundle = fs.readFileSync(releaseBundlePath, 'utf8');
  for (const locale of supportedLocales) {
    const sentinel = bundleSentinels[locale];
    if (!sentinel) {
      fail(`No release bundle sentinel configured for locale ${locale}.`);
      continue;
    }
    if (!bundleContains(releaseBundle, sentinel)) {
      fail(`release/main.js does not contain the ${locale} locale sentinel.`);
    }
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[i18n-release] Locale source, coverage floors, and release bundle checks passed.');
