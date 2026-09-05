#!/usr/bin/env node
/**
 * Model coverage gate.
 *
 * Enforces the cross-file consistency contract for every cloud model in
 * the RT registry. Catches the class of bug where a model is added to
 * one source but forgotten in another — the pattern behind the Gemini
 * 3.5 Flash failure (a registry entry was complete, but the dispatch
 * layer never honored its declared capability).
 *
 * Checks performed:
 *
 *   [1] Every model.id in src/ai/registry/builtinModels.ts (excluding
 *       provider:'none' and provider:'ollama') has a pricing entry in
 *       src/ai/cost/providerPricing.ts.
 *
 *   [2] Every model.id in providerPricing.ts is either in BUILTIN_MODELS
 *       or in the documented dangling allowlist (legacy retained-for-
 *       continuity entries).
 *
 * Exit codes:
 *   0  all good
 *   1  one or more violations
 *
 * Run: node scripts/check-model-coverage.mjs [--quiet]
 */
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BUILTIN_MODELS_PATH = path.join(ROOT, 'src/ai/registry/builtinModels.ts');
const PROVIDER_PRICING_PATH = path.join(ROOT, 'src/ai/cost/providerPricing.ts');

// Pricing entries that intentionally exist without a corresponding
// BUILTIN_MODELS entry. Each must be justified with a comment when
// added — drift here means we're keeping pricing data alive for a
// model we've already retired from the runtime registry.
const PRICING_DANGLING_ALLOWLIST = new Set([
    // (empty after the 2026-05-22 minimum-viable-catalog trim)
]);

// BUILTIN_MODELS entries that intentionally don't need a pricing row.
// "chat-latest" / "*-latest" aliases resolve to dated snapshots at
// request time (handled by remotePricing.ts), so the alias itself
// doesn't carry pricing data here. The list is forward-defensive —
// most of these aren't currently in BUILTIN_MODELS but would pass the
// gate if re-added later via the deliberate promotion process in
// docs/engineering/standards/model-promotion.md.
const BUILTIN_NO_PRICING_ALLOWLIST = new Set([
    'gpt-5.5-chat-latest',
    'gpt-5.4-chat-latest',
    'gpt-5.3-chat-latest',
    'gpt-5.2-chat-latest',
    'gpt-5.1-chat-latest',
    'gpt-5-chat-latest',
    'gemini-pro-latest',
    'gemini-flash-latest',
]);

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const COLOR = {
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
};

function log(...messages) {
    if (!quiet) console.log(...messages);
}

async function readFileSafe(filePath) {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (err) {
        console.error(`${COLOR.red}Failed to read ${filePath}: ${err.message}${COLOR.reset}`);
        process.exit(2);
    }
}

/**
 * Parse BUILTIN_MODELS to extract { provider, id } pairs. String-based
 * parse keeps the script dependency-free (no ts-node / tsx required).
 */
function parseBuiltinModels(source) {
    const entries = [];
    // Capture provider, then id on the next few lines of the same object.
    const re = /provider:\s*'([^']+)',[\s\S]{0,200}?id:\s*'([^']+)',/g;
    let match;
    while ((match = re.exec(source)) !== null) {
        entries.push({ provider: match[1], id: match[2] });
    }
    return entries;
}

/**
 * Parse providerPricing.ts to extract every keyed model ID. The file
 * structure is provider -> { modelId: { ... } } at depth 2.
 */
function parsePricingKeys(source) {
    const keys = new Set();
    // Top-of-line single-quoted keys (4-space indent) that begin a pricing object.
    const re = /^\s{4,8}'([a-zA-Z0-9.\-_]+)':\s*\{/gm;
    let match;
    while ((match = re.exec(source)) !== null) {
        keys.add(match[1]);
    }
    return keys;
}

async function main() {
    const [builtinSrc, pricingSrc] = await Promise.all([
        readFileSafe(BUILTIN_MODELS_PATH),
        readFileSafe(PROVIDER_PRICING_PATH),
    ]);

    const builtinAll = parseBuiltinModels(builtinSrc);
    const builtinIds = new Set(builtinAll.map(m => m.id));
    const pricingKeys = parsePricingKeys(pricingSrc);

    log(`${COLOR.dim}Parsed:${COLOR.reset} ${builtinAll.length} BUILTIN_MODELS · ${pricingKeys.size} pricing keys`);

    const findings = [];

    // [1] cloud BUILTIN_MODELS → must have pricing
    const cloudBuiltin = builtinAll.filter(m =>
        m.provider !== 'none' && m.provider !== 'ollama'
    );
    for (const model of cloudBuiltin) {
        if (BUILTIN_NO_PRICING_ALLOWLIST.has(model.id)) continue;
        if (!pricingKeys.has(model.id)) {
            findings.push({
                severity: 'error',
                check: 'missing-pricing',
                message: `${model.provider}/${model.id} is in BUILTIN_MODELS but has no entry in providerPricing.ts`,
            });
        }
    }

    // [2] pricing entries → must be in BUILTIN_MODELS or allowlisted
    for (const key of pricingKeys) {
        if (builtinIds.has(key)) continue;
        if (PRICING_DANGLING_ALLOWLIST.has(key)) continue;
        findings.push({
            severity: 'warn',
            check: 'dangling-pricing',
            message: `providerPricing.ts has '${key}' but no BUILTIN_MODELS entry — retire pricing or restore the registry entry`,
        });
    }

    const errors = findings.filter(f => f.severity === 'error');
    const warnings = findings.filter(f => f.severity === 'warn');

    if (errors.length === 0 && warnings.length === 0) {
        log(`${COLOR.green}✓ Model coverage OK${COLOR.reset} — ${cloudBuiltin.length} cloud models cross-referenced.`);
        process.exit(0);
    }

    for (const f of errors) {
        console.error(`${COLOR.red}ERR${COLOR.reset}  [${f.check}] ${f.message}`);
    }
    for (const f of warnings) {
        console.error(`${COLOR.yellow}WARN${COLOR.reset} [${f.check}] ${f.message}`);
    }

    if (errors.length > 0) {
        console.error(`\n${COLOR.red}Model coverage failed: ${errors.length} error(s), ${warnings.length} warning(s).${COLOR.reset}`);
        console.error(
            `If a finding is intentional, add the model ID to the relevant allowlist in scripts/check-model-coverage.mjs with a comment.`
        );
        process.exit(1);
    }
    // Warnings alone don't fail the gate.
    console.error(`\n${COLOR.yellow}Model coverage: ${warnings.length} warning(s).${COLOR.reset}`);
    process.exit(0);
}

main().catch(err => {
    console.error(`${COLOR.red}check-model-coverage crashed: ${err.message}${COLOR.reset}`);
    process.exit(2);
});
