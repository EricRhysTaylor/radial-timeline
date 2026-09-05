#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";

const BUNDLE_PATH = 'src/data/releaseNotesBundle.json';

function parseSemver(version) {
    const match = version.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;
    return {
        major: Number.parseInt(match[1], 10),
        minor: Number.parseInt(match[2], 10),
        patch: Number.parseInt(match[3], 10)
    };
}

function fetchRelease(tag) {
    try {
        const json = execSync(`gh release view ${tag} --json name,body,publishedAt,url,isDraft`, { encoding: 'utf8' });
        const data = JSON.parse(json);
        const isDraft = data.isDraft || false;
        return {
            version: tag,
            title: data.name || tag,
            body: data.body || '',
            url: data.url || `https://github.com/EricRhysTaylor/Radial-Timeline/releases/tag/${tag}`,
            publishedAt: data.publishedAt || new Date().toISOString(),
            isDraft
        };
    } catch (error) {
        console.warn(`⚠️  Could not fetch release ${tag}: ${error.message}`);
        return null;
    }
}

function fetchAllReleases() {
    try {
        const output = execSync('gh release list --limit 50', { encoding: 'utf8' });
        const lines = output.trim().split('\n');
        const releases = [];
        for (const line of lines) {
            const parts = line.split('\t');
            if (parts.length > 0) {
                const version = parts[0].trim().replace(/^v/i, '');
                releases.push(version);
            }
        }
        return releases;
    } catch (error) {
        console.error(`❌ Failed to list releases: ${error.message}`);
        return [];
    }
}

function loadExistingBundle() {
    if (!existsSync(BUNDLE_PATH)) {
        return null;
    }
    try {
        const raw = readFileSync(BUNDLE_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        console.warn(`⚠️  Could not read existing bundle: ${error.message}`);
        return null;
    }
}

console.log('🔄 Syncing release notes from GitHub...\n');

const existingBundle = loadExistingBundle();

// Get all releases
const allReleases = fetchAllReleases();
if (allReleases.length === 0) {
    console.error('❌ No releases found');
    process.exit(1);
}

// Latest should be first
const latestVersion = allReleases[0];
const semver = parseSemver(latestVersion);
if (!semver) {
    console.error(`❌ Invalid version format: ${latestVersion}`);
    process.exit(1);
}

console.log(`📦 Latest release: ${latestVersion}`);

// Fetch latest release details (this will be the first entry in the ordered list)
const releaseCache = new Map();
const latest = fetchRelease(latestVersion);
if (!latest) {
    console.error('❌ Failed to fetch latest release');
    process.exit(1);
}
releaseCache.set(latestVersion, latest);

const getReleaseDetails = (version) => {
    if (releaseCache.has(version)) {
        return releaseCache.get(version);
    }
    const release = fetchRelease(version);
    if (release) {
        releaseCache.set(version, release);
    }
    return release;
};

const entries = [];
const seen = new Set();

for (const version of allReleases) {
    if (seen.has(version)) continue;
    const v = parseSemver(version);
    if (!v || v.major !== semver.major) continue;
    const release = getReleaseDetails(version);
    if (!release) continue;
    entries.push(release);
    seen.add(version);
}

if (entries.length === 0) {
    console.error('❌ Unable to build release notes entries for this major version');
    process.exit(1);
}

const targetMajorVersion = `${semver.major}.0.0`;
let majorEntry = entries.find(entry => entry.version === targetMajorVersion) ?? null;

if (!majorEntry) {
    const fallbackExistingEntry =
        (existingBundle?.entries ?? []).find(entry => entry.version === targetMajorVersion) ??
        (existingBundle?.major?.version === targetMajorVersion ? existingBundle.major : null);
    if (fallbackExistingEntry) {
        console.warn(`⚠️  Major release ${targetMajorVersion} not found via GitHub, reusing embedded entry.`);
        majorEntry = fallbackExistingEntry;
        if (!entries.some(entry => entry.version === fallbackExistingEntry.version)) {
            entries.push(fallbackExistingEntry);
        }
    } else {
        console.warn(`⚠️  Major release ${targetMajorVersion} not found via GitHub, using oldest available release.`);
        majorEntry = entries[entries.length - 1] ?? entries[0] ?? null;
    }
}

const majorVersion = majorEntry?.version ?? null;
if (!majorEntry) {
    console.warn('⚠️  No major release entry identified. The latest release will be highlighted instead.');
}

const latestEntry = entries[0] ?? majorEntry ?? null;
const legacyPatches = entries.filter(entry => {
    const isMajor = majorEntry && entry.version === majorEntry.version;
    const isLatest = latestEntry && entry.version === latestEntry.version;
    return !(isMajor || isLatest);
});

const bundle = {
    entries,
    majorVersion,
    major: majorEntry ?? null,
    latest: latestEntry ?? null,
    patches: legacyPatches.length > 0 ? legacyPatches : undefined
};

try {
    writeFileSync(BUNDLE_PATH, JSON.stringify(bundle, null, 2));
    console.log(`\n✅ Release notes synced to ${BUNDLE_PATH}`);
    console.log(`   Entries: ${entries.length}`);
    console.log(`   Major Version: ${majorVersion ?? 'n/a'}`);
    const latestLabel = latestEntry?.isDraft ? `${latestEntry.version} (DRAFT)` : (latestEntry?.version ?? 'n/a');
    console.log(`   Latest: ${latestLabel}`);
    if (latestEntry?.isDraft) {
        console.log('\n💡 Next: run "npm run backup --note=\'Sync release notes\'" to commit, then publish the draft on GitHub.');
    } else {
        console.log('\n💡 Reminder: run "npm run backup" to commit these updated release notes.');
    }
} catch (err) {
    console.error(`❌ Failed to write bundle: ${err.message}`);
    process.exit(1);
}
