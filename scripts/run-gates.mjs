#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { spawn } from 'child_process';
import { performance } from 'perf_hooks';

const ROOT = process.cwd();
const LOG_ROOT = path.join(ROOT, '.gate-logs');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_DIR = path.join(LOG_ROOT, timestamp);
const verbose = process.argv.includes('--verbose');
const continueOnFail = process.argv.includes('--continue');

function argValue(name) {
    const hit = process.argv.find(arg => arg.startsWith(`${name}=`));
    return hit ? hit.slice(name.length + 1) : '';
}

const profileArg = argValue('--profile');
const resultsFileArg = argValue('--results-file');

const colors = {
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m',
};

const steps = [
    {
        id: 'model-drift',
        label: 'AI model drift',
        command: 'node scripts/check-model-updates.mjs --quiet',
        report: summarizeModelDrift,
    },
    {
        id: 'api-features',
        label: 'API feature audit',
        command: 'node scripts/check-api-features.mjs --summary',
        report: summarizeApiFeatures,
    },
    // Pricing registry validation is intentionally NOT part of the automated
    // gates. It enforces a calendar-staleness threshold on a hand-maintained
    // price table, which produced a self-re-triggering Stop-hook loop and is a
    // manual re-verification task, not a per-stop check. Run it on demand with
    // `node scripts/validate-pricing.mjs` (or `npm run validate:pricing`).
    {
        id: 'model-coverage',
        label: 'Model coverage',
        command: 'node scripts/check-model-coverage.mjs --quiet',
    },
    {
        id: 'css-duplicates-pre',
        label: 'CSS duplicates',
        command: 'node check-css-duplicates.mjs --quiet',
    },
    {
        id: 'shipped-assets',
        label: 'Shipped assets',
        command: 'node scripts/check-shipped-assets.mjs --quiet',
    },
    {
        id: 'build',
        label: 'Production build',
        command: 'npm run build-only',
    },
    {
        id: 'quality',
        label: 'Code quality',
        command: 'node code-quality-check.mjs --all',
    },
    {
        id: 'obsidian-review',
        label: 'Obsidian review',
        command: 'npm run review:obsidian',
    },
    {
        id: 'lint-obsidian-enforced',
        label: 'Obsidian lint baseline',
        command: 'npm run lint:obsidian -- --quiet',
    },
    {
        id: 'lint-obsidian',
        label: 'Obsidian lint (report-only)',
        command: 'node scripts/lint-obsidian-report.mjs --quiet',
        report: summarizeObsidianLint,
    },
    {
        id: 'css-drift',
        label: 'CSS drift',
        command: 'npm run css-drift -- --maintenance',
        report: summarizeCssDrift,
    },
    {
        id: 'compliance',
        label: 'Compliance',
        command: 'node scripts/compliance-check.mjs --maintenance',
        report: summarizeCompliance,
    },
    {
        id: 'spec-coverage',
        label: 'Spec coverage',
        command: 'npm run audit:spec-coverage',
    },
    {
        id: 'tests',
        label: 'Unit tests',
        command: 'npm run test:quiet',
    },
    // Steps below are profile-scoped extras (release/deep only). They are NOT
    // part of the default `npm run gates` set that every backup runs.
    {
        id: 'i18n-release',
        label: 'i18n release readiness',
        command: 'node scripts/check-i18n-release.mjs',
    },
    {
        id: 'fallback-gate',
        label: 'Fallback debt',
        command: 'node scripts/fallback-gate.mjs --quiet',
    },
    {
        // Cross-check layer only (--no-llm): deterministic, no API key. The
        // 30-day staleness threshold failing here is intentional — biweekly
        // deep audit is the cadence where "re-verify pricing" belongs (unlike
        // validate-pricing in a per-stop hook; see note above).
        id: 'pricing-drift',
        label: 'Pricing drift',
        command: 'node scripts/check-pricing-drift.mjs --no-llm --check',
    },
    {
        // Informational: warns on newer Obsidian versions, never fails
        // (network errors degrade to a warning inside the script).
        id: 'obsidian-version',
        label: 'Obsidian version watch',
        command: 'node scripts/check-obsidian-version.mjs',
    },
];

// Gate profiles are nested supersets: quick ⊂ daily ⊂ all ⊂ release ⊂ deep.
// `all` (the default for `npm run gates` / `npm run backup`) is the core set;
// release adds bundle-readiness checks; deep adds debt/drift/watch checks.
const CORE = [
    'model-drift', 'api-features', 'model-coverage', 'css-duplicates-pre',
    'shipped-assets', 'build', 'quality', 'obsidian-review',
    'lint-obsidian-enforced', 'lint-obsidian', 'css-drift', 'compliance',
    'spec-coverage', 'tests',
];
const RELEASE = [...CORE, 'i18n-release'];
const PROFILES = {
    quick: ['css-duplicates-pre', 'build', 'quality', 'tests'],
    daily: ['css-duplicates-pre', 'build', 'quality', 'obsidian-review', 'lint-obsidian-enforced', 'lint-obsidian', 'tests'],
    all: CORE,
    release: RELEASE,
    deep: [...RELEASE, 'fallback-gate', 'pricing-drift', 'obsidian-version'],
};

function selectSteps() {
    const profile = PROFILES[profileArg || 'all'];
    if (!profile) {
        console.error(`Unknown gate profile: ${profileArg}. Use one of: ${Object.keys(PROFILES).join(', ')}.`);
        process.exit(1);
    }
    const ids = new Set(profile);
    return steps.filter(step => ids.has(step.id));
}

const activeSteps = selectSteps();

function color(name, text) {
    return `${colors[name] ?? ''}${text}${colors.reset}`;
}

function rel(filePath) {
    return path.relative(ROOT, filePath);
}

function duration(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function stripAnsi(value) {
    return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function extractNotices(output) {
    const patterns = [
        /\bALERT\b/i,
        /\bWARN(?:ING)?\b/i,
        /\bactionable\b/i,
        /\bdrift\b/i,
        /\boutdated\b/i,
        /\bupdate(?:s|d| available)?\b/i,
        /\bupgrade\b/i,
    ];
    return unique(stripAnsi(output)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && patterns.some(pattern => pattern.test(line)))
        .filter(line => !line.startsWith('✓ '))
    ).slice(0, 6);
}

function tail(output, count = 40) {
    const lines = stripAnsi(output).trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-count).join('\n');
}

async function readJson(filePath) {
    try {
        return JSON.parse(await fs.readFile(path.join(ROOT, filePath), 'utf8'));
    } catch {
        return null;
    }
}

async function summarizeObsidianLint() {
    const report = await readJson('.gate-logs/eslint-obsidian.json');
    if (!report || !report.total) return [];
    const obs = Object.entries(report.byRule || {}).filter(([rule]) => rule.startsWith('obsidianmd/'));
    const obsTotal = obs.reduce((sum, [, count]) => sum + count, 0);
    const top = obs
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([rule, count]) => `${rule.replace('obsidianmd/', '')}(${count})`)
        .join(', ');
    return [`Obsidian lint (report-only): ${report.total} problems total, ${obsTotal} from obsidianmd rules — top: ${top || 'none'}. See .gate-logs/eslint-obsidian.json.`];
}

async function summarizeModelDrift() {
    const report = await readJson('scripts/models/model-drift-report.json');
    if (!report) return [];
    const items = [];
    const alerts = Array.isArray(report.releaseAlerts) ? report.releaseAlerts : [];
    alerts.slice(0, 4).forEach(alert => {
        if (alert?.message) items.push(`AI model drift: ${alert.message}`);
    });
    const followUps = Array.isArray(report.recommendedFollowUps) ? report.recommendedFollowUps : [];
    followUps.slice(0, 3).forEach(item => {
        if (typeof item === 'string') items.push(`AI model follow-up: ${item}`);
        else if (item?.message) items.push(`AI model follow-up: ${item.message}`);
    });
    if (report.hasActionableChanges && items.length === 0) {
        items.push('AI model drift: actionable provider changes detected. See scripts/models/model-drift-report.json.');
    }
    return unique(items);
}

async function summarizeApiFeatures() {
    const report = await readJson('scripts/models/feature-audit.json');
    if (!report) return [];
    const items = [];
    const validationErrors = Array.isArray(report.validationErrors) ? report.validationErrors : [];
    const evidenceFailures = Array.isArray(report.evidenceFailures) ? report.evidenceFailures : [];
    const priorities = Array.isArray(report.topPriorities) ? report.topPriorities : [];
    if (validationErrors.length > 0) {
        items.push(`API feature audit: ${validationErrors.length} validation error(s).`);
    }
    if (evidenceFailures.length > 0) {
        items.push(`API feature audit: ${evidenceFailures.length} evidence failure(s).`);
    }
    priorities.slice(0, 3).forEach(priority => {
        const label = priority?.name || priority?.id || priority?.capabilityId;
        if (label) items.push(`API feature gap: ${label}.`);
    });
    return unique(items);
}

async function summarizeCssDrift(output) {
    const clean = stripAnsi(output);
    const deltaMatch = clean.match(/- delta:\s*([+-]\d+)/);
    const delta = deltaMatch ? Number(deltaMatch[1]) : 0;
    if (Number.isFinite(delta) && delta > 0) {
        return [`CSS drift: warning count increased by ${delta}. See the CSS drift log.`];
    }
    return [];
}

async function summarizeCompliance(output) {
    const clean = stripAnsi(output);
    const deltaMatch = clean.match(/- delta:\s*([+-]\d+)/i);
    const delta = deltaMatch ? Number(deltaMatch[1]) : 0;
    if (Number.isFinite(delta) && delta !== 0) {
        return [`Compliance: delta ${deltaMatch[1]}. See the compliance log.`];
    }
    return [];
}

function runCommand(command, logFile) {
    return new Promise(resolve => {
        const started = performance.now();
        const child = spawn(command, {
            cwd: ROOT,
            env: process.env,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const chunks = [];
        child.stdout.on('data', chunk => {
            chunks.push(chunk);
            if (verbose) process.stdout.write(chunk);
        });
        child.stderr.on('data', chunk => {
            chunks.push(chunk);
            if (verbose) process.stderr.write(chunk);
        });
        child.on('close', async code => {
            const output = Buffer.concat(chunks).toString('utf8');
            await fs.writeFile(logFile, output, 'utf8');
            resolve({
                code,
                output,
                elapsedMs: performance.now() - started,
            });
        });
    });
}

async function writeResults(results, actionItems, notices, ok) {
    if (!resultsFileArg) return;
    const payload = {
        profile: profileArg || 'all',
        ok,
        generatedAt: new Date().toISOString(),
        steps: results,
        actionItems: unique(actionItems),
        notices: unique(notices),
    };
    const target = path.isAbsolute(resultsFileArg) ? resultsFileArg : path.join(ROOT, resultsFileArg);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(payload, null, 2), 'utf8');
}

async function main() {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const notices = [];
    const actionItems = [];
    const results = [];
    let firstFailure = null;

    console.log(color('bold', `Radial Timeline gates${profileArg ? ` [${profileArg}]` : ''}`));
    console.log(`${color('dim', 'Logs:')} ${rel(LOG_DIR)}`);

    for (let index = 0; index < activeSteps.length; index++) {
        const step = activeSteps[index];
        const logFile = path.join(LOG_DIR, `${String(index + 1).padStart(2, '0')}-${step.id}.log`);
        process.stdout.write(`[${index + 1}/${activeSteps.length}] ${step.label} ... `);
        const result = await runCommand(step.command, logFile);
        const logPath = rel(logFile);
        const outputNotices = step.report
            ? []
            : extractNotices(result.output).map(line => `${step.label}: ${line}`);
        const reportItems = step.report ? await step.report(result.output) : [];
        notices.push(...outputNotices);
        actionItems.push(...reportItems);

        const ok = result.code === 0;
        results.push({
            id: step.id,
            label: step.label,
            status: ok ? 'PASS' : 'FAIL',
            code: result.code,
            durationMs: result.elapsedMs,
            logPath,
            notices: unique([...outputNotices, ...reportItems]),
            tail: tail(result.output, ok ? 3 : 16),
        });

        if (!ok) {
            console.log(`${color('red', 'FAIL')} (${duration(result.elapsedMs)})`);
            console.log(`${color('red', 'Gate failed:')} ${step.label}`);
            console.log(`${color('dim', 'Log:')} ${logPath}`);
            const failureTail = tail(result.output);
            if (failureTail) {
                console.log('');
                console.log(color('bold', 'Failure Tail'));
                console.log(failureTail);
            }
            if (!firstFailure) firstFailure = step.label;
            process.exitCode = result.code || 1;
            if (!continueOnFail) {
                if (notices.length || actionItems.length) {
                    printSummary(actionItems, notices);
                }
                await writeResults(results, actionItems, notices, false);
                return;
            }
            continue;
        }

        const noticeCount = outputNotices.length + reportItems.length;
        const suffix = noticeCount > 0 ? ` ${color('yellow', `(${noticeCount} notice${noticeCount === 1 ? '' : 's'})`)}` : '';
        console.log(`${color('green', 'PASS')} (${duration(result.elapsedMs)})${suffix}`);
    }

    printSummary(actionItems, notices);
    await writeResults(results, actionItems, notices, !firstFailure);
    if (firstFailure) {
        console.log(color('red', `Gates completed with failures (first: ${firstFailure}).`));
    } else {
        console.log(color('green', 'All gates passed.'));
    }
}

function printSummary(actionItems, notices) {
    const actions = unique(actionItems).slice(0, 12);
    const noticeLines = unique(notices).filter(line => !actions.some(action => line.includes(action))).slice(0, 12);

    console.log('');
    console.log(color('bold', 'Action Items'));
    if (actions.length === 0) {
        console.log('- None.');
    } else {
        actions.forEach(item => console.log(`- ${item}`));
    }

    if (noticeLines.length > 0) {
        console.log('');
        console.log(color('bold', 'Notices'));
        noticeLines.forEach(item => console.log(`- ${item}`));
    }
}

main().catch(error => {
    console.error(color('red', error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
});
