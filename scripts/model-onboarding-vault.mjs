#!/usr/bin/env node
/**
 * Reset the model onboarding test vault: a fresh copy of the fixture book
 * (tests/fixtures/model-onboarding/vault) in an Obsidian vault outside the
 * repo, for clicking through Pulse, Summary and Synopsis, Gossamer and Inquiry
 * by hand with a new model.
 *
 * Running the features writes to scene YAML and adds Radial Timeline folders,
 * so the vault lives outside the repo, where that never dirties `main`. Each
 * reset replaces everything except `.obsidian` (the installed plugin and its
 * settings survive, so the AI provider and model stay chosen). `npm run
 * deploy` installs the plugin there (esbuild.config.mjs, "Model Onboarding").
 *
 *   npm run model-vault:reset
 *   RT_MODEL_ONBOARDING_VAULT=/other/path npm run model-vault:reset
 *
 * In the vault, set Settings → Source path to "The Tidewater Ledger".
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repoRoot, 'tests', 'fixtures', 'model-onboarding', 'vault');
const target = resolve(process.env.RT_MODEL_ONBOARDING_VAULT
    || join(repoRoot, '..', 'Test Vaults', 'Obsidian Vault Model Onboarding'));
const MARKER = '.model-onboarding-vault';

mkdirSync(target, { recursive: true });
const entries = readdirSync(target).filter(name => name !== '.obsidian' && name !== '.DS_Store');
// Only ever clear a folder this script created: never an author's vault
// pointed at by mistake.
if (entries.length > 0 && !existsSync(join(target, MARKER))) {
    console.error(`Refusing to reset ${target}: it has files and no ${MARKER} marker, so it is not a model onboarding vault.`);
    process.exit(1);
}
for (const name of entries) rmSync(join(target, name), { recursive: true, force: true });
cpSync(source, target, { recursive: true });
writeFileSync(join(target, MARKER), 'Created by scripts/model-onboarding-vault.mjs. Everything here except .obsidian is replaced on each reset.\n');
console.log(`Model onboarding vault reset: ${target}`);
console.log('Open it in Obsidian; set Source path to "The Tidewater Ledger". Run `npm run deploy` first if the plugin is not installed there.');
