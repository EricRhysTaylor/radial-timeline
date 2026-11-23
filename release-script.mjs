#!/usr/bin/env node

import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import readline from "readline";
import { color, createSequence, openLogDir, rel, runStep, summaries } from "./scripts/lib/step-runner.mjs";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Every step prints one line; its full output goes to this run's log folder.
// Steps that print their own compact table (a push that runs the pre-push
// gates, the preflight and verify runners) write to the terminal directly.
const LOG_DIR = openLogDir('release');
const sequence = createSequence();

// Questions must stand out from the step lines around them.
function ask(prompt) {
    return new Promise((resolve) => {
        rl.question(`\n${color('bold', color('yellow', '▶ YOUR ANSWER NEEDED'))}\n  ${color('bold', prompt)} `, (answer) => resolve(answer.trim()));
    });
}

function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/** Run one release step. Stops the release on failure unless `allowFail`. */
async function step(label, command, { inherit = false, allowFail = false, summary } = {}) {
    const result = await runStep({ id: slug(label), label, command, inherit, allowFail, summary }, { logDir: LOG_DIR, sequence });
    if (!result.ok && !allowFail) {
        console.error(color('red', `\nRelease stopped at "${label}". Nothing after this step ran.`));
        console.error(`Logs: ${rel(LOG_DIR)}`);
        process.exit(result.code || 1);
    }
    return result;
}

/** A read-only lookup: stdout only, never printed. */
function read(command) {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function updateManifestAndVersions(targetVersion) {
    // Keep manifest files and versions.json in sync with package.json
    const manifestPath = 'src/manifest.json';
    const rootManifestPath = 'manifest.json';
    const versionsPath = 'versions.json';
    try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const { minAppVersion } = manifest;
        manifest.version = targetVersion;
        // Write both the source and root manifests so Obsidian's updater sees the bump
        writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'));
        writeFileSync(rootManifestPath, JSON.stringify(manifest, null, '\t'));

        const versions = JSON.parse(readFileSync(versionsPath, 'utf8'));
        versions[targetVersion] = minAppVersion;
        writeFileSync(versionsPath, JSON.stringify(versions, null, '\t'));
        console.log(`Manifest and versions.json ... ${color('green', 'PASS')} synced to ${targetVersion}`);
    } catch (err) {
        console.error('❌ Failed to update manifest/versions:', err.message);
        process.exit(1);
    }
}

const EMBEDDED_RELEASE_NOTES_PATH = 'src/data/releaseNotesBundle.json';

function parseSemver(version) {
    if (!version) return null;
    const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;
    return {
        major: Number.parseInt(match[1], 10),
        minor: Number.parseInt(match[2], 10),
        patch: Number.parseInt(match[3], 10)
    };
}

function compareSemverDesc(a, b) {
    const parsedA = parseSemver(a);
    const parsedB = parseSemver(b);
    if (!parsedA && !parsedB) return 0;
    if (!parsedA) return 1;
    if (!parsedB) return -1;
    if (parsedA.major !== parsedB.major) return parsedB.major - parsedA.major;
    if (parsedA.minor !== parsedB.minor) return parsedB.minor - parsedA.minor;
    return parsedB.patch - parsedA.patch;
}

function fetchReleaseInfo(tag) {
    if (!tag) return null;
    try {
        // Only fetch minimal info to check existence and draft status
        return JSON.parse(read(`gh release view ${tag} --json name,isDraft,tagName`));
    } catch (error) {
        return null; // Release doesn't exist
    }
}

function readExistingReleaseBundle() {
    try {
        const raw = readFileSync(EMBEDDED_RELEASE_NOTES_PATH, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function updateBundleWithLocalEntry(version, body) {
    const newEntry = {
        version: version,
        title: version,
        body: body,
        url: `https://github.com/EricRhysTaylor/Radial-Timeline/releases/tag/${version}`,
        publishedAt: new Date().toISOString()
    };

    let bundle = readExistingReleaseBundle();
    if (!bundle) {
        bundle = { entries: [] };
    }

    if (!bundle.entries) {
        bundle.entries = [];
        if (bundle.latest) bundle.entries.push(bundle.latest);
        if (bundle.patches) bundle.entries.push(...bundle.patches);
        if (bundle.major) bundle.entries.push(bundle.major);
    }

    // Remove any existing entry for this version (idempotency)
    bundle.entries = bundle.entries.filter(e => e.version !== version);

    // Add new entry at the top
    bundle.entries.unshift(newEntry);
    bundle.entries.sort((a, b) => compareSemverDesc(a.version, b.version));

    // Update legacy fields
    bundle.latest = bundle.entries[0];

    const semver = parseSemver(version);
    if (semver) {
        const majorVersionStr = `${semver.major}.0.0`;
        let majorEntry = bundle.entries.find(e => e.version === majorVersionStr);

        if (!majorEntry) {
            if (version === majorVersionStr) {
                majorEntry = newEntry;
            } else {
                majorEntry = bundle.entries[bundle.entries.length - 1];
            }
        }
        bundle.major = majorEntry;
        bundle.majorVersion = majorEntry ? majorEntry.version : majorVersionStr;
        bundle.patches = bundle.entries.filter(e => {
            const s = parseSemver(e.version);
            return s && s.major === semver.major && e.version !== bundle.majorVersion;
        });
    }

    try {
        writeFileSync(EMBEDDED_RELEASE_NOTES_PATH, JSON.stringify(bundle, null, 2));
        console.log(`Release notes bundle ... ${color('green', 'PASS')} entry for ${version} added`);
    } catch (err) {
        console.error(`Release notes bundle ... ${color('yellow', 'NOT UPDATED')} ${err.message}`);
    }
}

function getLastReleaseTag() {
    try {
        const releases = JSON.parse(read('gh release list --limit 1 --json tagName'));
        if (releases && releases.length > 0) {
            return releases[0].tagName;
        }
    } catch (error) {
        // console.log('⚠️  Could not get GitHub releases, falling back to Git tags');
    }

    try {
        return read('git tag --sort=-version:refname | head -1').trim() || null;
    } catch {
        return null;
    }
}

function tagExists(tag) {
    try {
        const out = execSync(`git tag -l "${tag}"`, { encoding: 'utf8' });
        return out.trim() === tag;
    } catch {
        return false;
    }
}

function readLocalReleaseDraft(version) {
    const draftPath = `docs/releases/draft-for-release-${version}.md`;
    if (!existsSync(draftPath)) return null;
    try {
        const body = readFileSync(draftPath, 'utf8').trim();
        return body.length > 0 ? body : null;
    } catch {
        return null;
    }
}

// Categorization rules
const CATEGORIES = [
    {
        title: "New Features",
        keywords: [/feat/i, /add/i, /new/i, /implement/i, /create/i]
    },
    {
        title: "Bug Fixes",
        keywords: [/fix/i, /resolve/i, /bug/i, /patch/i, /correct/i, /repair/i]
    },
    {
        title: "Improvements",
        keywords: [/improve/i, /refactor/i, /perf/i, /optimiz/i, /tweak/i, /update/i, /styl/i, /polish/i, /better/i, /enlarge/i, /adjust/i, /refine/i]
    },
    {
        title: "Documentation",
        keywords: [/doc/i, /readme/i, /wiki/i, /comment/i]
    },
    {
        title: "Maintenance",
        keywords: [/chore/i, /maint/i, /build/i, /ci/i, /bump/i, /upgrade/i, /script/i]
    }
];

function generateChangelog(fromTag, toRef = 'HEAD') {
    try {
        const range = fromTag ? `${fromTag}..${toRef}` : toRef;
        const logs = execSync(`git log ${range} --pretty=format:"%h|%H|%s" --no-merges`, { encoding: 'utf8' });

        if (!logs.trim()) {
            return "No changes since last release.";
        }

        const lines = logs.trim().split('\n');
        const categorized = {};
        const uncategorized = [];

        CATEGORIES.forEach(cat => categorized[cat.title] = []);

        lines.forEach(line => {
            const parts = line.split('|');
            if (parts.length < 3) return;

            const shortHash = parts[0];
            const fullHash = parts[1];
            let rawMessage = parts.slice(2).join('|').trim();
            let cleanMessages = [];

            if (rawMessage.startsWith('[backup]')) {
                const segments = rawMessage.split(' — ');
                if (segments.length >= 3) {
                    let descParts = [];
                    for (let i = 2; i < segments.length; i++) {
                        const seg = segments[i].trim();
                        if (/^\d+\s+files$/.test(seg) || /^[+\-]\d+\/[+\-]\d+/.test(seg)) break;
                        descParts.push(seg);
                    }
                    const fullDesc = descParts.join(' — ');
                    if (fullDesc && !fullDesc.includes('automatic backup after build')) {
                        cleanMessages = fullDesc.split('. ').map(s => s.trim()).filter(s => s.length > 2);
                    }
                } else {
                    const hyphenSegments = rawMessage.split(' - ');
                    if (hyphenSegments.length >= 4 && rawMessage.includes('[backup]')) {
                        const desc = hyphenSegments.slice(2, hyphenSegments.length - 2).join(' - ');
                        if (desc && !desc.includes('automatic backup after build')) {
                            cleanMessages = desc.split('. ').map(s => s.trim()).filter(s => s.length > 2);
                        }
                    } else if (!rawMessage.includes('automatic backup after build')) {
                        cleanMessages = [rawMessage];
                    }
                }
            } else {
                cleanMessages = [rawMessage];
            }

            cleanMessages.forEach(msg => {
                if (msg.endsWith('.')) msg = msg.slice(0, -1);
                let message = msg.replace(/#(\d+)/g, '[#$1](https://github.com/EricRhysTaylor/Radial-Timeline/issues/$1)');
                const hashLink = `([${shortHash}](https://github.com/EricRhysTaylor/Radial-Timeline/commit/${fullHash}))`;

                let assigned = false;
                for (const cat of CATEGORIES) {
                    if (cat.keywords.some(regex => regex.test(message))) {
                        categorized[cat.title].push(`- ${message} ${hashLink}`);
                        assigned = true;
                        break;
                    }
                }

                if (!assigned) {
                    if (!/^\d+\s+files$/.test(message) && !message.toLowerCase().includes('[backup]') && !/^[+\-]\d+/.test(message)) {
                        uncategorized.push(`- ${message} ${hashLink}`);
                    }
                }
            });
        });

        let changelog = "";
        CATEGORIES.forEach(cat => {
            if (categorized[cat.title].length > 0) {
                changelog += `### ${cat.title}\n${categorized[cat.title].join('\n')}\n\n`;
            }
        });

        if (uncategorized.length > 0) {
            changelog += `### Other Changes\n${uncategorized.join('\n')}\n\n`;
        }

        return changelog.trim() || "No significant changes since last release.";
    } catch (error) {
        console.error(error);
        return "Could not generate changelog.";
    }
}

// CI build: dispatch the release-build workflow (build + attestation + asset
// upload happen on GitHub-hosted runners so assets carry provenance).
async function runReleaseWorkflowAndWait(version) {
    await step(
        "Dispatching the release build on GitHub",
        `gh workflow run release-build.yml --ref main -f version=${version}`
    );

    let runId = null;
    for (let attempt = 0; attempt < 10 && !runId; attempt++) {
        execSync('sleep 3');
        try {
            const runs = JSON.parse(read('gh run list --workflow=release-build.yml --limit 1 --json databaseId,status,createdAt'));
            if (runs.length > 0 && runs[0].status !== 'completed') {
                runId = runs[0].databaseId;
            }
        } catch { /* retry */ }
    }
    if (!runId) {
        console.error(color('red', 'Could not find the dispatched workflow run. Check: gh run list --workflow=release-build.yml'));
        process.exit(1);
    }

    // `gh run watch` redraws the job list every few seconds; that goes to the
    // log, and the terminal gets one line when the run ends.
    console.log(color('dim', `  CI run: https://github.com/EricRhysTaylor/radial-timeline/actions/runs/${runId}`));
    await step(
        "Building, attesting and uploading assets in CI",
        `gh run watch ${runId} --exit-status --interval 15`
    );
}

async function performBuildAndUpload(version, isDraft = false) {
    // 0. Verify manifest version matches target version (Critical for Obsidian detection)
    const manifestPath = 'src/manifest.json';
    try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.version !== version) {
            console.log(color('yellow', `Manifest says ${manifest.version}, expected ${version}; syncing.`));
            updateManifestAndVersions(version);
        }
    } catch (e) {
        console.warn(color('yellow', `Could not verify the manifest version: ${e.message}`));
    }

    // 1. Sync release notes from GitHub to ensure local bundle is current
    await step("Syncing release notes from GitHub", "node sync-release-notes.mjs", {
        summary: output => {
            const entries = /Entries: (\d+)/.exec(output)?.[1];
            const latest = /Latest: (.+)/.exec(output)?.[1];
            return entries ? `${entries} entries, latest ${latest}` : '';
        },
    });

    // 2. Commit the synced notes (otherwise git status is dirty)
    try {
        await step('Staging synced release notes', 'git add src/data/releaseNotesBundle.json');
        // We only commit if there are changes
        const status = read('git status --porcelain');
        if (status.includes('src/data/releaseNotesBundle.json')) {
            await step('Committing release notes', `git commit -m "docs: sync release notes for ${version}"`);

            // Move the tag to this new commit so the tag includes the notes.
            // This is "history rewriting" but ensures the tag is "perfect".
            // The push runs the pre-push gates on this new commit.
            await step(`Moving tag ${version} to HEAD`, `git tag -f ${version}`);
            await step(`Pushing tag ${version} (runs the pre-push gates)`, `git push origin ${version} --force`, { inherit: true });
        } else {
            console.log(color('dim', 'Release notes already current; no commit needed.'));
        }
    } catch (e) {
        console.warn(color('yellow', 'Could not commit synced notes or move tag. Proceeding anyway.'));
    }

    // 3. Release preflight + verify. Both print their own one-line-per-check table.
    await step("Release preflight", "npm run --silent release:prep", { inherit: true });
    await step("Verify (build, standards, tests)", "npm run --silent verify", { inherit: true });

    // 4. Build, attest, and upload in CI. GitHub-hosted runners build the
    // assets from the pushed tag and sign a provenance attestation for each,
    // so the scorecard can verify the assets came from this repo's source.
    await runReleaseWorkflowAndWait(version);

    // 5. Publish (if it was a draft). Answering "Finish release" is the
    // decision; there is no second publish prompt. A draft left behind here
    // is the costly failure: main's manifest already names this version, so
    // every Obsidian install/update 404s until the release is public (7.3.0
    // sat that way on 2026-09-23). Any failure below exits non-zero, loudly.
    if (isDraft) {
        await step("Publishing release", `gh release edit ${version} --draft=false --latest`);
        await verifyPublishedAssets(version);
        console.log(color('green', `\nRelease ${version} is published.`));
        console.log(`https://github.com/EricRhysTaylor/radial-timeline/releases/tag/${version}`);
        await queueDirectoryScan();
    } else {
        await verifyPublishedAssets(version);
        console.log(color('green', `\nAssets updated for existing release ${version}.`));
        await queueDirectoryScan();
    }
    console.log(color('dim', `Logs: ${rel(LOG_DIR)}`));
}

// What Obsidian actually fetches: the three assets from the public download
// URL. A draft, a missing asset, or a failed publish all show up here as a
// non-200. Retries briefly because the download CDN can lag a publish.
const RELEASE_ASSETS = ['manifest.json', 'main.js', 'styles.css'];

async function verifyPublishedAssets(version) {
    process.stdout.write(`Public download links for ${version} ... `);
    const base = `https://github.com/EricRhysTaylor/radial-timeline/releases/download/${version}`;
    let failures = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
        failures = [];
        for (const asset of RELEASE_ASSETS) {
            try {
                const res = await fetch(`${base}/${asset}`, { method: 'HEAD', redirect: 'follow' });
                if (res.status !== 200) failures.push(`${asset} → ${res.status}`);
            } catch (e) {
                failures.push(`${asset} → ${e.message}`);
            }
        }
        if (!failures.length) {
            console.log(`${color('green', 'PASS')} ${RELEASE_ASSETS.length}/${RELEASE_ASSETS.length} assets download`);
            return;
        }
        if (attempt < 6) await new Promise(r => setTimeout(r, 10000));
    }
    console.log(color('red', 'FAIL'));
    console.error(color('red', `\nRelease ${version} is NOT downloadable: ${failures.join('; ')}`));
    console.error(`   Obsidian users cannot install or update until this is fixed.`);
    console.error(`   Check: gh release view ${version} (is it still a draft? are all three assets attached?)`);
    process.exit(1);
}

// The community directory does NOT notice new releases on its own — someone
// has to hit the dashboard's "Check for new releases" endpoint, which queues
// the official review scan. Opening this URL in the default browser (where
// the Obsidian community session is logged in) performs the check.
const DIRECTORY_CHECK_RELEASE_URL =
    'https://community.obsidian.md/account/plugins/radial-timeline/check-release';

async function queueDirectoryScan() {
    await step("Opening the directory's check-release page (queues the review scan)", `open "${DIRECTORY_CHECK_RELEASE_URL}"`, { allowFail: true });
    console.log("  If the page asks you to log in, log in and reload it; the scan queues on page load.");
}

async function main() {
    console.log(`\n${color('bold', 'Radial Timeline release')} ${color('dim', `· logs: ${rel(LOG_DIR)}`)}`);

    try {
        const branch = read('git rev-parse --abbrev-ref HEAD').trim();
        if (branch !== 'main') {
            console.error(color('red', `Releases must be cut from 'main'. Current: '${branch}'`));
            process.exit(1);
        }
    } catch (e) { /* ignore */ }

    // Read current version
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const currentVersion = packageJson.version;

    // Check if there is already a release/draft for this version
    const existingRelease = fetchReleaseInfo(currentVersion);

    if (existingRelease) {
        if (existingRelease.isDraft) {
            console.log(`A DRAFT release for ${currentVersion} is on GitHub: you edited its notes and are ready to finish.`);
            const choice = await ask(`Finish and PUBLISH release ${currentVersion}? This syncs the notes, builds, uploads and publishes; there is no later prompt. (y/N):`);
            if (choice.toLowerCase() === 'y') {
                await performBuildAndUpload(currentVersion, true);
                rl.close();
                return;
            }
        } else {
            console.log(`Release ${currentVersion} is already published on GitHub.`);
            const choice = await ask(`Repair or update the assets for ${currentVersion}? This syncs the notes, builds and uploads. (y/N):`);
            if (choice.toLowerCase() === 'y') {
                await performBuildAndUpload(currentVersion, false);
                rl.close();
                return;
            }
        }
    }

    // --- NEW RELEASE FLOW ---

    const lastTag = getLastReleaseTag();

    // Get new version from user
    const newVersion = await ask(`New version number (package.json has ${currentVersion}; last release tag ${lastTag || 'none'}):`);

    if (!newVersion) {
        console.log("No version entered; nothing changed.");
        rl.close();
        return;
    }

    if (newVersion === currentVersion) {
        console.log("That is the current version; nothing changed. Use the repair option above if needed.");
        rl.close();
        return;
    }

    // Translation gate, before anything is committed, tagged or pushed. The
    // tag goes public in Step 1, so a failure here must stop the release
    // first; release-preflight repeats the same check when the draft is
    // finished. A major release (x.0.0) ships only after the translation pass
    // (docs/engineering/standards/i18n.md).
    const isMajor = /^\d+\.0\.0$/.test(newVersion);
    await step(
        isMajor ? `Translations (full coverage for ${newVersion})` : 'Translations',
        isMajor ? 'node scripts/check-i18n-release.mjs --full-coverage' : 'node scripts/check-i18n-release.mjs',
        { summary: summaries.i18n }
    );

    // Notes gate, before the tag goes public: the version must match what
    // changed (new features make a minor release), and a minor or major
    // release shows 1 to 5 screenshots (docs/engineering/standards/release-process.md).
    await step(`Release notes for ${newVersion}`, `node scripts/check-release-notes.mjs ${newVersion}`, {
        summary: output => /\((\w+)\): notes pass/.exec(output)?.[1] ?? '',
    });

    const autoChangelog = generateChangelog(lastTag);
    const localDraftBody = readLocalReleaseDraft(newVersion);
    const releaseNotesBody = localDraftBody ?? `## What's Changed\n\n${autoChangelog}`;
    console.log(color('dim', localDraftBody
        ? `  Notes: docs/releases/draft-for-release-${newVersion}.md`
        : `  Notes: generated from the commits since ${lastTag || 'the first commit'}`));

    // Step 1: create the draft release.
    // 1. Bump version locally
    await step(`Bumping version to ${newVersion}`, `npm version ${newVersion} --no-git-tag-version`);

    // 2. Update bundle with preliminary auto-notes (so we have something)
    updateBundleWithLocalEntry(newVersion, releaseNotesBody);

    // 3. Commit bump
    await step('Staging version bump', 'git add .');
    await step('Committing version bump', `git commit -m "Release version ${newVersion}"`);

    // 4. Create Draft on GitHub (Text Only)
    // We create the tag now so we can attach the release to it
    await step(`Creating tag ${newVersion}`, `git tag ${newVersion}`);
    await step('Pushing main (runs the pre-push gates)', 'git push origin main', { inherit: true });
    // Same commit the gates just passed on the main push; don't run them twice.
    await step('Pushing tag', `RT_SKIP_PREPUSH_GATES=1 git push origin ${newVersion}`);

    const notesFile = '.release-notes-temp.md';
    writeFileSync(notesFile, releaseNotesBody);
    await step('Creating the draft release on GitHub', `gh release create ${newVersion} --title "${newVersion}" --notes-file "${notesFile}" --draft`);
    unlinkSync(notesFile);

    const opened = await step('Opening the draft in your browser', `gh release view ${newVersion} --web`, { allowFail: true });

    console.log(`\n${color('bold', color('yellow', '▶ ACTION REQUIRED: finish the draft now'))}`);
    console.log(`  Obsidian already sees ${newVersion} on main; installs fail until the release is published.`);
    console.log(`  1. Edit the release notes on GitHub${opened.ok ? ' (opened in your browser)' : `: https://github.com/EricRhysTaylor/Radial-Timeline/releases/tag/${newVersion}`}.`);
    console.log('  2. Add wiki links and fix typos, then SAVE the draft. Do not publish it there.');
    console.log('  3. Come back and run: npm run release');
    console.log('     Answering y to "Finish and PUBLISH" publishes it; there is no later prompt.');
    console.log(color('dim', `Logs: ${rel(LOG_DIR)}`));

    rl.close();
}

main();
