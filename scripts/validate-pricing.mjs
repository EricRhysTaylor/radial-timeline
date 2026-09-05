#!/usr/bin/env node
/**
 * Validates scripts/models/pricing.json structure and data integrity.
 * Run: node scripts/validate-pricing.mjs
 */
import fs from 'fs/promises';
import path from 'path';
import process from 'process';

const PRICING_PATH = path.resolve('scripts/models/pricing.json');
const VALID_PROVIDERS = new Set(['openai', 'anthropic', 'google']);
const STALE_DAYS = 30;

function isFiniteNonNeg(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateEntry(entry, index, warnings) {
    const errors = [];
    const prefix = `models[${index}]`;

    if (!entry || typeof entry !== 'object') {
        return [`${prefix}: not an object`];
    }

    if (!VALID_PROVIDERS.has(entry.provider)) {
        errors.push(`${prefix}.provider: invalid "${entry.provider}"`);
    }
    if (typeof entry.modelId !== 'string' || !entry.modelId.trim()) {
        errors.push(`${prefix}.modelId: missing or empty`);
    }
    if (!isFiniteNonNeg(entry.inputPer1M)) {
        errors.push(`${prefix}.inputPer1M: must be a non-negative number`);
    }
    if (!isFiniteNonNeg(entry.outputPer1M)) {
        errors.push(`${prefix}.outputPer1M: must be a non-negative number`);
    }

    if (entry.longContext !== undefined) {
        if (!entry.longContext || typeof entry.longContext !== 'object') {
            errors.push(`${prefix}.longContext: must be an object`);
        } else {
            if (!isFiniteNonNeg(entry.longContext.thresholdInputTokens)) {
                errors.push(`${prefix}.longContext.thresholdInputTokens: required non-negative number`);
            }
            if (!isFiniteNonNeg(entry.longContext.inputPer1M)) {
                errors.push(`${prefix}.longContext.inputPer1M: required non-negative number`);
            }
            if (!isFiniteNonNeg(entry.longContext.outputPer1M)) {
                errors.push(`${prefix}.longContext.outputPer1M: required non-negative number`);
            }
        }
    }

    if (entry.promo !== undefined) {
        if (!entry.promo || typeof entry.promo !== 'object') {
            errors.push(`${prefix}.promo: must be an object`);
        } else {
            if (typeof entry.promo.label !== 'string' || !entry.promo.label.trim()) {
                errors.push(`${prefix}.promo.label: required non-empty string`);
            }
            if (entry.promo.expiresAt !== undefined) {
                const ts = Date.parse(entry.promo.expiresAt);
                if (!Number.isFinite(ts)) {
                    errors.push(`${prefix}.promo.expiresAt: invalid ISO date`);
                } else if (ts < Date.now()) {
                    warnings.push(`${prefix}.promo.expiresAt: promo "${entry.promo.label}" has expired (${entry.promo.expiresAt})`);
                }
            }

            // Promo price higher than standard makes no sense
            if (isFiniteNonNeg(entry.promo.standardInputPer1M)
                && isFiniteNonNeg(entry.inputPer1M)
                && entry.inputPer1M > entry.promo.standardInputPer1M) {
                warnings.push(`${prefix}: promo inputPer1M ($${entry.inputPer1M}) > standardInputPer1M ($${entry.promo.standardInputPer1M})`);
            }
            if (isFiniteNonNeg(entry.promo.standardOutputPer1M)
                && isFiniteNonNeg(entry.outputPer1M)
                && entry.outputPer1M > entry.promo.standardOutputPer1M) {
                warnings.push(`${prefix}: promo outputPer1M ($${entry.outputPer1M}) > standardOutputPer1M ($${entry.promo.standardOutputPer1M})`);
            }

            // Free promo with no standard fallback
            if (entry.inputPer1M === 0 && entry.outputPer1M === 0
                && !isFiniteNonNeg(entry.promo.standardInputPer1M)
                && !isFiniteNonNeg(entry.promo.standardOutputPer1M)) {
                warnings.push(`${prefix}: $0 promo "${entry.promo.label}" has no standard fallback prices — will remain $0 after expiry`);
            }
        }
    }

    return errors;
}

async function main() {
    let raw;
    try {
        raw = await fs.readFile(PRICING_PATH, 'utf8');
    } catch {
        console.error(`[validate-pricing] Cannot read ${PRICING_PATH}`);
        process.exitCode = 1;
        return;
    }

    let data;
    try {
        data = JSON.parse(raw);
    } catch (e) {
        console.error(`[validate-pricing] Invalid JSON: ${e.message}`);
        process.exitCode = 1;
        return;
    }

    const errors = [];
    const warnings = [];

    if (typeof data.generatedAt !== 'string') {
        errors.push('generatedAt: missing or not a string');
    } else {
        const ts = Date.parse(data.generatedAt);
        if (!Number.isFinite(ts)) {
            errors.push('generatedAt: invalid ISO date');
        } else {
            const ageDays = (Date.now() - ts) / (24 * 60 * 60 * 1000);
            if (ageDays > STALE_DAYS) {
                errors.push(`generatedAt: pricing data is ${Math.floor(ageDays)} days old (stale threshold: ${STALE_DAYS} days)`);
            }
        }
    }

    if (!Array.isArray(data.models)) {
        errors.push('models: missing or not an array');
    } else {
        if (data.models.length === 0) {
            errors.push('models: empty array');
        }
        data.models.forEach((entry, index) => {
            errors.push(...validateEntry(entry, index, warnings));
        });

        // Check for duplicate provider+modelId pairs
        const seen = new Set();
        data.models.forEach((entry, index) => {
            if (entry?.provider && entry?.modelId) {
                const key = `${entry.provider}::${entry.modelId}`;
                if (seen.has(key)) {
                    errors.push(`models[${index}]: duplicate key ${key}`);
                }
                seen.add(key);
            }
        });
    }

    if (warnings.length > 0) {
        console.warn('[validate-pricing] Warnings:');
        warnings.forEach(w => console.warn(`  ⚠ ${w}`));
    }

    if (errors.length > 0) {
        console.error('[validate-pricing] Validation failed:');
        errors.forEach(err => console.error(`  - ${err}`));
        process.exitCode = 1;
    } else {
        const modelCount = data.models?.length ?? 0;
        console.log(`[validate-pricing] OK (${modelCount} entries${warnings.length ? `, ${warnings.length} warning(s)` : ''})`);
    }
}

main();
