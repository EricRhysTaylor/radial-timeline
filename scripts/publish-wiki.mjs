
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const WIKI_REPO = 'git@github.com:EricRhysTaylor/Radial-Timeline.wiki.git';
const TEMP_DIR = '.wiki_temp_publish';
const SOURCE_DIR = 'wiki';

function run(command, cwd) {
    console.log(`> ${command}`);
    try {
        execSync(command, { stdio: 'inherit', cwd });
    } catch (e) {
        console.error(`Command failed: ${command}`);
        process.exit(1);
    }
}

function publish() {
    console.log('🚀 Starting Wiki Publish...');

    // 1. Clean up previous temp dir
    if (fs.existsSync(TEMP_DIR)) {
        console.log('Cleaning up previous temp directory...');
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }

    // 2. Clone the Wiki repo
    console.log(`Cloning ${WIKI_REPO}...`);
    run(`git clone ${WIKI_REPO} ${TEMP_DIR}`);

    // 3. Copy files from 'wiki/' to temp dir
    console.log(`Copying files from ${SOURCE_DIR} to ${TEMP_DIR}...`);
    // Using cp -R for simplicity on Mac
    run(`cp -R ${SOURCE_DIR}/. ${TEMP_DIR}/`);

    // 3b. Prune pages that no longer exist in wiki/. cp never deletes, so
    // renamed or retired pages otherwise stay live on the public wiki forever
    // (36 such orphans had accumulated by 2026-07, including a stale License.md
    // that still marked the trademark TM after it registered as R).
    const orphans = fs.readdirSync(TEMP_DIR)
        .filter(f => f.endsWith('.md'))
        .filter(f => !fs.existsSync(path.join(SOURCE_DIR, f)));
    if (orphans.length > 0) {
        console.log(`Pruning ${orphans.length} orphaned page(s): ${orphans.join(', ')}`);
        for (const f of orphans) {
            fs.rmSync(path.join(TEMP_DIR, f));
        }
    }

    // 4. Commit and Push
    console.log('Committing and pushing changes...');
    const cwd = path.resolve(TEMP_DIR);

    // Check for changes
    try {
        const status = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
        if (!status) {
            console.log('✅ No changes to publish.');
        } else {
            // Build a descriptive commit message from the changed files
            const changedFiles = status.split('\n').filter(Boolean).map(l => l.slice(3).trim());
            const pad = (n) => String(n).padStart(2, '0');
            const now = new Date();
            const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
            const summary = changedFiles.slice(0, 6).map(f => f.replace(/\.md$/, '')).join(', ');
            const extra = changedFiles.length > 6 ? ` (+${changedFiles.length - 6} more)` : '';
            const commitMsg = `[wiki] ${ts} — ${changedFiles.length} pages — ${summary}${extra}`;

            run('git add .', cwd);
            run(`git commit -m ${JSON.stringify(commitMsg)}`, cwd);
            run('git push', cwd);
            console.log('✅ Wiki published successfully!');
        }
    } catch (e) {
        console.error('Error checking git status or pushing');
    }

    // 5. Cleanup
    console.log('Cleaning up...');
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    console.log('Done.');
}

publish();
