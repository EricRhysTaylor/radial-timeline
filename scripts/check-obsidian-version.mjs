import https from 'https';
import fs from 'fs';
import path from 'path';

const MANIFEST_PATH = path.join(process.cwd(), 'manifest.json');
const STABLE_VERSIONS_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/desktop-releases.json';

// ANSI colors for output
const COLORS = {
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
};

function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

async function fetchLatestVersion(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { 
            headers: { 'User-Agent': 'RadialTimeline-VersionCheck' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    
                    const result = {
                        stable: json.latestVersion || '0.0.0',
                        beta: json.beta?.latestVersion || null
                    };
                    
                    resolve(result);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function check() {
    console.log(`${COLORS.cyan}🔍 Checking for Obsidian updates...${COLORS.reset}`);

    try {
        const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
        const currentTarget = manifest.minAppVersion;
        const result = await fetchLatestVersion(STABLE_VERSIONS_URL);

        console.log(`   Target (minAppVersion): ${currentTarget}`);
        console.log(`   Latest Stable: ${result.stable}`);
        if (result.beta) {
            console.log(`   Latest Beta: ${result.beta}`);
        }

        // Priority 1: Check if there's a beta version newer than current target
        if (result.beta) {
            const betaComparison = compareVersions(result.beta, currentTarget);
            if (betaComparison > 0) {
                console.log(`\n${COLORS.yellow}⚠️  NEWER BETA VERSION AVAILABLE: ${result.beta}${COLORS.reset}`);
                console.log(`${COLORS.yellow}   Check for API changes: https://github.com/obsidianmd/obsidian-releases/releases/tag/v${result.beta}${COLORS.reset}`);
                console.log(`${COLORS.yellow}   Consider testing compatibility and updating minAppVersion if needed.${COLORS.reset}\n`);
                return;
            } else if (betaComparison === 0) {
                console.log(`\n${COLORS.green}✅ Project is targeting the current beta version (${result.beta}).${COLORS.reset}\n`);
                return;
            }
        }

        // Priority 2: Check stable version
        const stableComparison = compareVersions(result.stable, currentTarget);
        
        if (stableComparison > 0) {
            console.log(`\n${COLORS.yellow}⚠️  NEWER STABLE VERSION: ${result.stable}${COLORS.reset}`);
            console.log(`${COLORS.yellow}   Check for API changes: https://github.com/obsidianmd/obsidian-releases/releases/tag/v${result.stable}${COLORS.reset}`);
            console.log(`${COLORS.yellow}   Consider updating minAppVersion.${COLORS.reset}\n`);
        } else if (stableComparison === 0) {
            console.log(`\n${COLORS.green}✅ Project is targeting the latest stable version.${COLORS.reset}\n`);
        } else {
            console.log(`\n${COLORS.green}✅ Project is targeting a version newer than latest stable.${COLORS.reset}\n`);
        }

    } catch (err) {
        console.warn(`${COLORS.yellow}⚠️  Could not fetch Obsidian version info: ${err.message}${COLORS.reset}`);
    }
}

check();
