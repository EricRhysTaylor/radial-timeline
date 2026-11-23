// One way to run a check and report it: one line per step, the full output in
// a gitignored log file. Used by the pre-push gates, the release checks, the
// release preflight, verify and the release script, so every run prints the
// same shape:
//
//   [3/6] Compliance ... PASS (1.0s) 99 errors (baseline 102)
//
// A failing step also prints its last lines and the log path. Nothing else
// reaches the terminal unless a caller passes `--verbose`.
//
// Nested runs share one log folder: a runner exports RT_STEP_LOG_DIR to its
// children, and a child runner writes into a subfolder of it instead of
// starting a new timestamped folder under .gate-logs/.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execSync, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
export const LOG_ROOT = path.join(ROOT, '.gate-logs');
const KEEP_RUNS = 40;

const colors = {
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m',
};

export function color(name, text) {
    return `${colors[name] ?? ''}${text}${colors.reset}`;
}

export function rel(filePath) {
    return path.relative(ROOT, filePath);
}

export function duration(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 120000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function stripAnsi(value) {
    return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

export function tail(output, count = 40) {
    const lines = stripAnsi(output).trim().split(/\r?\n/).filter(line => line.trim());
    return lines.slice(-count).join('\n');
}

export function formatCount(value) {
    return Number(value).toLocaleString('en-US');
}

/** Keep the newest runs; the gate logs were never pruned and reached 260 MB. */
function pruneOldRuns() {
    let entries;
    try {
        entries = fs.readdirSync(LOG_ROOT, { withFileTypes: true });
    } catch {
        return;
    }
    const runs = entries
        .filter(entry => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(entry.name))
        .map(entry => entry.name)
        .sort();
    for (const name of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) {
        fs.rmSync(path.join(LOG_ROOT, name), { recursive: true, force: true });
    }
}

/**
 * Create this run's log folder. Top level: .gate-logs/<timestamp>[-group].
 * Inside another runner: <parent>/<group> (suffixed if the group repeats).
 */
export function openLogDir(group) {
    const parent = process.env.RT_STEP_LOG_DIR;
    let dir;
    if (parent) {
        dir = path.join(parent, group);
        for (let n = 2; fs.existsSync(dir); n++) dir = path.join(parent, `${group}-${n}`);
    } else {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        dir = path.join(LOG_ROOT, group === 'gates' ? stamp : `${stamp}-${group}`);
        pruneOldRuns();
    }
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Repo-relative paths changed on this branch (vs origin/main) plus uncommitted
 * and untracked files. When a ratchet count rises, the new offenders are
 * almost always in these files, so a check lists those first.
 */
export function changedFiles() {
    const run = (cmd) => {
        try {
            return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
        } catch {
            return '';
        }
    };
    const base = run('git merge-base HEAD origin/main');
    const lists = [
        base ? run(`git diff --name-only ${base}`) : '',
        run('git ls-files --others --exclude-standard'),
    ];
    return new Set(lists.join('\n').split('\n').map(line => line.trim()).filter(Boolean));
}

/** Write a full listing (every finding) next to the logs and return its relative path. */
export function writeFullReport(name, lines) {
    fs.mkdirSync(LOG_ROOT, { recursive: true });
    const file = path.join(LOG_ROOT, name);
    fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
    return rel(file);
}

/**
 * Run a shell command. Captured (default): output goes to `logFile` and is
 * returned. `inherit`: the child writes to this terminal (for steps that
 * print their own compact table, such as a push that runs the gates).
 */
export function runCommand(command, { logFile, logDir, verbose = false, inherit = false } = {}) {
    return new Promise(resolve => {
        const started = performance.now();
        const env = logDir ? { ...process.env, RT_STEP_LOG_DIR: logDir } : process.env;
        const child = spawn(command, {
            cwd: ROOT,
            env,
            shell: true,
            stdio: inherit ? ['inherit', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
        });
        const chunks = [];
        if (!inherit) {
            child.stdout.on('data', chunk => {
                chunks.push(chunk);
                if (verbose) process.stdout.write(chunk);
            });
            child.stderr.on('data', chunk => {
                chunks.push(chunk);
                if (verbose) process.stderr.write(chunk);
            });
        }
        child.on('close', code => {
            const output = Buffer.concat(chunks).toString('utf8');
            if (logFile) fs.writeFileSync(logFile, output, 'utf8');
            resolve({ code: code ?? 1, output, elapsedMs: performance.now() - started });
        });
    });
}

function safeSummary(step, output) {
    if (!step.summary) return '';
    try {
        return step.summary(stripAnsi(output)) || '';
    } catch {
        return '';
    }
}

/**
 * Run one step and print its line.
 * step: { id, label, command, summary?(plainOutput) => string, inherit?, allowFail? }
 * ctx:  { logDir, index?, total?, verbose? }
 */
export async function runStep(step, ctx) {
    const prefix = ctx.total ? `[${ctx.index}/${ctx.total}] ` : '';
    const number = String(ctx.index ?? ctx.sequence?.next() ?? 0).padStart(2, '0');
    const logFile = step.inherit ? undefined : path.join(ctx.logDir, `${number}-${step.id}.log`);

    if (step.inherit) console.log(`${prefix}${step.label} ...`);
    else process.stdout.write(`${prefix}${step.label} ... `);

    const result = await runCommand(step.command, {
        logFile,
        logDir: ctx.logDir,
        verbose: ctx.verbose,
        inherit: step.inherit,
    });
    const ok = result.code === 0;
    const summary = safeSummary(step, result.output);
    const time = `(${duration(result.elapsedMs)})`;
    const label = step.inherit ? `${prefix}${step.label} ... ` : '';
    const logPath = logFile ? rel(logFile) : '';

    if (ok) {
        console.log(`${label}${color('green', 'PASS')} ${time}${summary ? ` ${summary}` : ''}`);
    } else if (step.allowFail) {
        console.log(`${label}${color('yellow', 'SKIPPED')} ${time} ${summary || 'did not complete; continuing'}${logPath ? color('dim', ` · log: ${logPath}`) : ''}`);
    } else {
        console.log(`${label}${color('red', 'FAIL')} ${time}${summary ? ` ${summary}` : ''}`);
        if (!step.inherit) {
            const detail = tail(result.output, 40);
            if (detail) {
                console.log('');
                console.log(detail);
                console.log('');
            }
            console.log(`${color('dim', 'Log:')} ${logPath}`);
        }
    }
    return { ...result, ok, summary, logPath };
}

/** Numbering for runs whose length is not known up front (the release script). */
export function createSequence() {
    let n = 0;
    return { next: () => ++n };
}

/**
 * Run a list of steps in order and stop at the first failure.
 * Prints a title line with the log folder, one line per step, and a last line.
 */
export async function runSteps(title, group, steps, { verbose = process.argv.includes('--verbose') } = {}) {
    const logDir = openLogDir(group);
    console.log(`${color('bold', title)} ${color('dim', `· logs: ${rel(logDir)}`)}`);
    for (let index = 0; index < steps.length; index++) {
        const result = await runStep(steps[index], { logDir, index: index + 1, total: steps.length, verbose });
        if (!result.ok && !steps[index].allowFail) {
            console.log(color('red', `${title}: stopped at ${steps[index].label}.`));
            return { ok: false, code: result.code || 1, logDir };
        }
    }
    console.log(color('green', `${title}: all ${steps.length} passed.`));
    return { ok: true, code: 0, logDir };
}

/** True when the calling module is the script node was started with (not an import). */
export function isMain(importMetaUrl) {
    return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === importMetaUrl;
}

// --- Count summaries shared by every runner -------------------------------

export const summaries = {
    /** "Tests  6772 passed | 2 expected fail | 56 skipped (6830)" */
    vitest(output) {
        const line = output.split('\n').find(text => /^\s*Tests\s+\d/.test(text));
        if (!line) return '';
        const failed = /(\d+) failed/.exec(line)?.[1];
        const passed = /(\d+) passed/.exec(line)?.[1];
        if (failed) return `${formatCount(failed)} failed, ${formatCount(passed ?? 0)} passed`;
        return passed ? `${formatCount(passed)} tests` : '';
    },
    /** compliance-check.mjs --maintenance */
    compliance(output) {
        const match = /\[compliance\] (\d+) errors \(baseline (\d+)\)/.exec(output);
        return match ? `${formatCount(match[1])} errors (baseline ${formatCount(match[2])})` : '';
    },
    /** css-drift-check.mjs --maintenance */
    cssDrift(output) {
        const match = /\[css-drift\] (\d+) warnings \(baseline (\d+)\)/.exec(output);
        return match ? `${formatCount(match[1])} warnings (baseline ${formatCount(match[2])})` : '';
    },
    /** lint-obsidian-enforced.mjs */
    obsidianLintBaseline(output) {
        const current = /- current total: (\d+)/.exec(output)?.[1];
        const baseline = /- baseline total: (\d+)/.exec(output)?.[1];
        return current ? `${formatCount(current)} findings (baseline ${formatCount(baseline ?? 0)})` : '';
    },
    /** publishing-pdf-qa.ts: one "✓ <layout>: N pages" line per layout */
    pdfLayouts(output) {
        const count = output.split('\n').filter(line => /^✓ /.test(line)).length;
        return count ? `${count} layouts compiled` : '';
    },
    /** check-i18n-release.mjs */
    i18n(output) {
        const locales = output.split('\n').filter(line => /^\[i18n-release\] [a-z]{2}(-[A-Za-z]+)?: \d+\//.test(line));
        if (!locales.length) return '';
        const lowest = Math.min(...locales.map(line => Number(/\(([\d.]+)%\)/.exec(line)?.[1] ?? 100)));
        return `${locales.length} languages, lowest ${lowest}% translated`;
    },
    /** check-unpublished-releases.mjs */
    draftReleases(output) {
        const inFlight = /draft for current version (\S+) exists/.exec(output)?.[1];
        return inFlight ? `draft ${inFlight} in progress` : 'none stranded';
    },
    /** check-obsidian-version.mjs (never fails; say when Obsidian moved ahead) */
    obsidianVersion(output) {
        const newer = /NEWER (\w+) VERSION AVAILABLE: (\S+)/.exec(output);
        const target = /Target \(minAppVersion\): (\S+)/.exec(output)?.[1];
        if (newer) return color('yellow', `Obsidian ${newer[2]} (${newer[1].toLowerCase()}) is out; minAppVersion ${target ?? '?'}`);
        return target ? `minAppVersion ${target} is current` : '';
    },
};
