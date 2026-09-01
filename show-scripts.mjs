#!/usr/bin/env node

// Show key project scripts in a concise format
const quiet = process.argv.includes('--quiet');

if (!quiet) {
  console.log('\n📦 Available commands: \x1b[32mnpm run build\x1b[0m (auto-backup if >1h; refactorAlerts.ts) | \x1b[32mnpm run dev\x1b[0m | \x1b[32mnpm run verify\x1b[0m | \x1b[32mserver\x1b[0m (local MLX LLM: start · server:stop · server:status) | \x1b[32mbackup\x1b[0m | \x1b[32mcss-drift\x1b[0m | \x1b[32mscan-ert\x1b[0m | \x1b[32mrelease\x1b[0m | \x1b[32mrelease:prep\x1b[0m | \x1b[32msync-release-notes\x1b[0m | \x1b[32mpublish-wiki\x1b[0m | \x1b[32mupdate-models\x1b[0m | \x1b[32mlint\x1b[0m | \x1b[32mreview:obsidian\x1b[0m | \x1b[32mrelease:eyeball\x1b[0m | \x1b[32mauditDaily\x1b[0m | \x1b[32mauditFriday\x1b[0m | \x1b[32mauditDeep\x1b[0m\n');
}
