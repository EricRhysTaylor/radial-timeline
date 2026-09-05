#!/usr/bin/env node
/**
 * Model & Pricing Watch — the nightly orchestrator.
 *
 * Replaces the old "fail if pricing.json is stale" nag with a job that does
 * real work and reports what it found:
 *   1. Runs the provider model checker (IDs, aliases, token limits, release
 *      alerts) — scripts/check-model-updates.mjs.
 *   2. Runs the pricing drift engine (cross-check + Claude price lookup) and,
 *      in --apply mode, writes verified price corrections + re-stamps.
 *   3. Composes one Markdown status report (the GitHub issue body / job summary)
 *      and emits machine-readable outputs for the workflow.
 *
 * Usage:
 *   node scripts/model-pricing-watch.mjs            # report only (no writes)
 *   node scripts/model-pricing-watch.mjs --apply    # CI: verify, write, report
 *
 * Side effects when run in CI:
 *   - writes the report to $GITHUB_STEP_SUMMARY (if set)
 *   - writes the report to scripts/models/pricing-watch-report.md
 *   - writes actionable/changed flags to $GITHUB_OUTPUT (if set)
 */
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';
import { runModelUpdateCheck } from './check-model-updates.mjs';
import { runPricingDriftCheck, summarizeErrors } from './check-pricing-drift.mjs';

const REPORT_FILE = path.resolve('scripts/models/pricing-watch-report.md');

function fmtUsd(n) {
    return typeof n === 'number' ? `$${n}` : String(n);
}

function pricingSection(p) {
    const lines = [];
    const ageLabel = p.ageDays === null ? 'unknown' : `${p.ageDays}d / ${p.staleDays}d`;
    lines.push(`**Data freshness:** ${ageLabel} ${p.stale && !p.reStamped ? '⚠️ stale' : '✓'}`);
    if (p.llmRan) {
        const partial = (p.llmPartialErrors || []).length;
        lines.push(partial
            ? `**Live price verification:** ⚠️ partial (Claude + web search) — ${summarizeErrors(p.llmPartialErrors)}`
            : '**Live price verification:** ✓ ran (Claude + web search)');
    } else {
        lines.push(`**Live price verification:** ⚠️ skipped — ${p.llmError || 'no API key'}`);
    }

    if (p.priceDrifts.length) {
        lines.push('', '**Price drift detected:**', '', '| Model | Field | Was | Now | Confidence | Source |', '|---|---|---|---|---|---|');
        for (const d of p.priceDrifts) {
            const applied = p.applied.includes(d) ? ' ✅ applied' : '';
            const swing = d.largeSwing ? ' ⚠️ large' : '';
            const src = d.source ? `[link](${d.source})` : '—';
            lines.push(`| \`${d.modelId}\` | ${d.field} | ${fmtUsd(d.from)} | ${fmtUsd(d.to)}${applied}${swing} | ${d.confidence} | ${src} |`);
        }
    } else if (p.llmRan) {
        lines.push('', '✓ All verified prices match `pricing.json`.');
    }

    const c = p.crossCheck;
    const xc = [];
    if (c.missingPrices.length) xc.push(`- ⚠️ **${c.missingPrices.length} curated model(s) with no price:** ${c.missingPrices.map(m => `\`${m.modelId}\``).join(', ')}`);
    if (c.orphanPrices.length) xc.push(`- ⚠️ **${c.orphanPrices.length} price entr(y/ies) for unknown model(s):** ${c.orphanPrices.map(m => `\`${m.modelId}\``).join(', ')}`);
    for (const promo of c.promoIssues) {
        xc.push(promo.state === 'expired'
            ? `- ⚠️ **Promo expired:** \`${promo.modelId}\` "${promo.label}" (${promo.expiresAt})`
            : `- ⏳ **Promo expiring in ${promo.daysLeft}d:** \`${promo.modelId}\` "${promo.label}" (${promo.expiresAt})`);
    }
    if (xc.length) {
        lines.push('', '**Cross-check:**', '', ...xc);
    } else {
        lines.push('', '✓ Cross-check clean (every curated model is priced; no orphan entries; no promo issues).');
    }

    return lines.join('\n');
}

function modelsSection(modelResult) {
    const r = modelResult.report;
    const lines = [];
    if (!r.hasActionableChanges) {
        lines.push('✓ No actionable provider drift (model IDs, aliases, token limits, releases).');
        return lines.join('\n');
    }
    const fmtDiff = (label, prov) => {
        const added = prov.added || [];
        const removed = prov.removed || [];
        if (!added.length && !removed.length) return null;
        const parts = [];
        if (added.length) parts.push(`+${added.length} (${added.map(m => `\`${m.id || m}\``).join(', ')})`);
        if (removed.length) parts.push(`−${removed.length} (${removed.map(m => `\`${m.id || m}\``).join(', ')})`);
        return `- **${label}:** ${parts.join(' · ')}`;
    };
    for (const prov of ['openai', 'anthropic', 'google']) {
        const line = r.changes?.[prov] ? fmtDiff(prov, r.changes[prov]) : null;
        if (line) lines.push(line);
    }
    for (const a of r.aliasChanges || []) {
        lines.push(`- **Alias moved:** \`${a.alias || a.id}\` ${a.from || '?'} → ${a.to || '?'}`);
    }
    for (const t of r.tokenLimitChanges || []) {
        lines.push(`- **Token limit changed:** \`${t.modelId || t.id}\``);
    }
    for (const alert of r.releaseAlerts || []) {
        lines.push(`- 🆕 **Release alert:** ${alert.message}`);
    }
    for (const f of r.recommendedFollowUps || []) {
        lines.push(`- 👉 ${typeof f === 'string' ? f : f.message || JSON.stringify(f)}`);
    }
    return lines.join('\n');
}

export async function runWatch(options = {}) {
    const { apply = false, useLlm = false, now = () => Date.now(), log = console.log } = options;
    const date = new Date(now()).toISOString().slice(0, 10);

    // 1. Model checker (refreshes the snapshot itself when >1 day old).
    let modelResult;
    let modelError = null;
    try {
        modelResult = await runModelUpdateCheck({ quiet: true });
    } catch (error) {
        modelError = error instanceof Error ? error.message : String(error);
    }

    // 2. Pricing drift engine. The paid LLM price lookup is OFF by default; the
    //    free, deterministic cross-check + staleness always runs.
    const pricingResult = await runPricingDriftCheck({ apply, useLlm });

    // 3. Compose report.
    const actionable = pricingResult.actionable
        || Boolean(modelResult?.hasActionableChanges)
        || Boolean(modelError);

    const body = [
        `# 📊 Model & Pricing Watch — ${date}`,
        '',
        actionable ? '**Status:** ⚠️ action items below' : '**Status:** ✓ all clear',
        '',
        '## Pricing',
        '',
        pricingSection(pricingResult),
        '',
        '## Models',
        '',
        modelError ? `⚠️ Model checker error: ${modelError}` : modelsSection(modelResult),
    ];

    const actions = [];
    if (pricingResult.wrote) {
        actions.push(pricingResult.applied.length
            ? `Applied ${pricingResult.applied.length} price correction(s) to \`pricing.json\`${pricingResult.reStamped ? ' and re-stamped freshness' : ''}.`
            : 'Re-stamped `pricing.json` freshness (verified, no value changes).');
    }
    if (actions.length) {
        body.push('', '## Actions taken', '', ...actions.map(a => `- ${a}`));
    }

    const markdown = body.join('\n');

    await fs.writeFile(REPORT_FILE, `${markdown}\n`, 'utf8');

    if (process.env.GITHUB_STEP_SUMMARY) {
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    }
    if (process.env.GITHUB_OUTPUT) {
        await fs.appendFile(process.env.GITHUB_OUTPUT,
            `actionable=${actionable}\nchanged=${pricingResult.wrote}\nreport_file=${REPORT_FILE}\n`);
    }

    log(markdown);
    return { actionable, wrote: pricingResult.wrote, pricingResult, modelResult, modelError, markdown };
}

async function main() {
    const apply = process.argv.includes('--apply');
    // The paid Claude price lookup only runs if explicitly opted in with --llm.
    const useLlm = process.argv.includes('--llm');
    await runWatch({ apply, useLlm });
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && currentFilePath === invokedPath) {
    main().catch(error => {
        console.error(`[model-pricing-watch] Failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}
