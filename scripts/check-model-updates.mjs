#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import process from 'process';
import { fileURLToPath } from 'url';
import {
    buildModelDriftReport,
    computeAliasChanges,
    computeActionableDrift,
    computeAnthropicNewestChange,
    computeDiff,
    computeStaleProviders,
    computeTokenLimitChanges,
    createLatestAliasTracking,
    describeStaleProvider,
    hasProviderDiff,
    parseCanonicalSnapshot,
    parseLatestAliasTracking,
    snapshotContentChanged,
} from './modelSnapshotUtils.mjs';

const MODELS_FILE = path.resolve('scripts/models/latest-models.json');
const LATEST_TRACKING_FILE = path.resolve('scripts/models/latest-aliases.json');
const DRIFT_REPORT_FILE = path.resolve('scripts/models/model-drift-report.json');
const CURATED_REGISTRY_FILE = path.resolve('scripts/models/registry.json');
const RELEASE_WATCH_FILE = path.resolve('scripts/models/release-watch.json');
const UPDATE_SCRIPT = 'node scripts/update-ai-models.mjs';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

async function readJson(filePath) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function readIfExists(filePath) {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch {
        return null;
    }
}

async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function isSnapshotStale(snapshot, nowMs) {
    if (!snapshot?.generatedAt) return true;
    const generatedAtMs = Date.parse(snapshot.generatedAt);
    if (!Number.isFinite(generatedAtMs)) return true;
    return (nowMs - generatedAtMs) >= ONE_DAY_MS;
}

function runUpdateCommand() {
    try {
        execSync(UPDATE_SCRIPT, { stdio: 'inherit', env: process.env });
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function buildSummaryMessage(report, reportFilePath) {
    const lines = [];
    if ((report.releaseAlerts?.length || 0) > 0) {
        const primary = report.releaseAlerts[0];
        lines.push(`${YELLOW}[check-model-updates] ALERT: ${primary.message} See ${reportFilePath}.${RESET}`);
    } else if (report.hasActionableChanges) {
        lines.push(`${YELLOW}[check-model-updates] ALERT: Actionable provider drift detected. See ${reportFilePath}.${RESET}`);
    }
    // A stale provider list is reported alongside, never instead of, the
    // drift it can still see: the gate cannot know what it has not fetched.
    for (const entry of report.staleProviders || []) {
        lines.push(`${YELLOW}[check-model-updates] STALE: ${describeStaleProvider(entry)}${RESET}`);
    }
    if (lines.length === 0) return '[check-model-updates] No actionable provider drift detected.';
    return lines.join('\n');
}

function parseCuratedRegistry(payload) {
    if (!payload || typeof payload !== 'object') return new Set();
    const models = Array.isArray(payload.models) ? payload.models : [];
    return new Set(models
        .filter(model => model && typeof model === 'object' && typeof model.id === 'string')
        .map(model => model.id));
}

function parseReleaseWatch(payload) {
    if (!payload || typeof payload !== 'object') return [];
    const watched = Array.isArray(payload.watchedReleases) ? payload.watchedReleases : [];
    return watched.filter(entry =>
        entry
        && typeof entry === 'object'
        && typeof entry.provider === 'string'
        && typeof entry.modelId === 'string'
        && typeof entry.label === 'string'
        && typeof entry.announcedAt === 'string'
    );
}

function computeReleaseAlerts(watchedReleases, snapshot, curatedModelIds) {
    const snapshotModelIds = new Set((snapshot?.models || []).map(model => model.id));
    const alerts = [];

    for (const release of watchedReleases) {
        const inSnapshot = snapshotModelIds.has(release.modelId);
        const inCuratedRegistry = curatedModelIds.has(release.modelId);
        if (release.notifyUntil === 'curated' && inCuratedRegistry) continue;

        let state = null;
        let message = '';
        if (!inSnapshot) {
            state = 'announced_not_in_snapshot';
            message = `${release.provider} announced ${release.label} on ${release.announcedAt}, but the local provider snapshot does not include ${release.modelId} yet.`;
        } else if (!inCuratedRegistry) {
            state = 'announced_not_curated';
            message = `${release.provider} released ${release.label} on ${release.announcedAt}, and RT has not curated ${release.modelId} yet.`;
        }

        if (!state) continue;
        alerts.push({
            id: release.id,
            provider: release.provider,
            modelId: release.modelId,
            label: release.label,
            announcedAt: release.announcedAt,
            sourceUrl: release.sourceUrl || null,
            state,
            message,
        });
    }

    return alerts;
}

export async function runModelUpdateCheck(options = {}) {
    const {
        modelsFile = MODELS_FILE,
        latestTrackingFile = LATEST_TRACKING_FILE,
        driftReportFile = DRIFT_REPORT_FILE,
        curatedRegistryFile = CURATED_REGISTRY_FILE,
        releaseWatchFile = RELEASE_WATCH_FILE,
        quiet = false,
        now = () => Date.now(),
        updateSnapshot = async () => runUpdateCommand(),
        log = console.log,
        warn = console.warn,
    } = options;

    const beforeSnapshot = parseCanonicalSnapshot(await readJson(modelsFile));
    const shouldRefresh = isSnapshotStale(beforeSnapshot, now());

    let refreshResult = { ok: true, skipped: !shouldRefresh };
    if (shouldRefresh) {
        if (!quiet) {
            log('[check-model-updates] Refreshing provider snapshot...');
        }
        refreshResult = await updateSnapshot();
    }

    const afterSnapshot = parseCanonicalSnapshot(await readJson(modelsFile));
    const usableSnapshot = afterSnapshot ?? beforeSnapshot;

    if (!usableSnapshot) {
        const refreshError = refreshResult.ok ? '' : ` (${refreshResult.error})`;
        throw new Error(`Provider snapshot unavailable${refreshError}.`);
    }

    if (shouldRefresh && !refreshResult.ok) {
        warn('[check-model-updates] Snapshot refresh failed; using existing canonical snapshot.');
    }

    const previousTracking = parseLatestAliasTracking(await readJson(latestTrackingFile));
    const nextTracking = createLatestAliasTracking(usableSnapshot);
    const curatedModelIds = parseCuratedRegistry(await readJson(curatedRegistryFile));
    const watchedReleases = parseReleaseWatch(await readJson(releaseWatchFile));

    const changes = computeDiff(beforeSnapshot?.models || [], usableSnapshot.models);
    const aliasChanges = previousTracking ? computeAliasChanges(previousTracking, nextTracking) : [];
    const anthropicNewestChanged = previousTracking
        ? computeAnthropicNewestChange(previousTracking, nextTracking)
        : null;
    const tokenLimitChanges = previousTracking
        ? computeTokenLimitChanges(previousTracking, nextTracking)
        : [];
    const releaseAlerts = computeReleaseAlerts(watchedReleases, usableSnapshot, curatedModelIds);
    const staleProviders = computeStaleProviders(usableSnapshot, now());
    const actionable = computeActionableDrift({
        changes,
        aliasChanges,
        anthropicNewestChanged,
        tokenLimitChanges,
        releaseAlerts,
        curatedModelIds,
    });

    const report = buildModelDriftReport({
        checkedAt: nextTracking.checkedAt,
        beforeSnapshot,
        afterSnapshot: usableSnapshot,
        changes,
        aliasChanges,
        anthropicNewestChanged,
        tokenLimitChanges,
        releaseAlerts,
        staleProviders,
        actionable,
    });

    // Write only on a real change. Both payloads carry a fresh checkedAt on every
    // run, so writing unconditionally produced a diff (and, with the auto-backup
    // build, a commit) on every build even when nothing about the models moved.
    if (snapshotContentChanged(await readIfExists(latestTrackingFile), nextTracking)) {
        await writeJson(latestTrackingFile, nextTracking);
    }
    if (snapshotContentChanged(await readIfExists(driftReportFile), report)) {
        await writeJson(driftReportFile, report);
    }

    const summary = buildSummaryMessage(report, driftReportFile);
    if (!quiet || report.hasActionableChanges || staleProviders.length > 0 || (shouldRefresh && !refreshResult.ok)) {
        log(summary);
    }

    return {
        staleProviders,
        refreshed: shouldRefresh && refreshResult.ok,
        usedFallbackSnapshot: shouldRefresh && !refreshResult.ok,
        hasActionableChanges: report.hasActionableChanges,
        hasProviderDiff: hasProviderDiff(changes),
        report,
        tracking: nextTracking,
        summary,
    };
}

async function main() {
    const quiet = process.argv.includes('--quiet');
    await runModelUpdateCheck({ quiet });
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && currentFilePath === invokedPath) {
    main().catch(error => {
        console.error(`${RED}[check-model-updates] Failed: ${error instanceof Error ? error.message : String(error)}${RESET}`);
        process.exitCode = 1;
    });
}
