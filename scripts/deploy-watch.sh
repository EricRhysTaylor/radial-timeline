#!/bin/bash
# Deploy watcher — keeps the local checkout + vault plugin folders in sync
# with origin/main. Run by launchd every 2 minutes on the Mac Studio (see
# scripts/install-deploy-watch.sh). Single-shot: fetch, fast-forward if
# behind, rebuild into the vault folders, exit.
#
# Why this exists: remote (cloud) Claude Code sessions can merge to GitHub
# but can never write to this machine's disk. Without this watcher, every
# remote merge strands the Mac on a stale build (see CLAUDE.md → Remote
# Session Deploys).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$REPO_DIR/.deploy-watch.log"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"; }

cd "$REPO_DIR"

# Only ever auto-deploy from main.
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
    log "skip: checkout is on '$BRANCH', not main"
    exit 0
fi

git fetch origin main --quiet
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"

if [ "$LOCAL" = "$REMOTE" ]; then
    exit 0  # up to date — stay silent
fi

# Never clobber in-progress local work.
if [ -n "$(git status --porcelain)" ]; then
    log "skip: origin/main moved to ${REMOTE:0:9} but working tree is dirty"
    exit 0
fi

log "deploy: ${LOCAL:0:9} -> ${REMOTE:0:9}"
git merge --ff-only origin/main --quiet

# Production build — esbuild.config.mjs bundles JS+CSS and copies the plugin
# into every configured vault folder. Deliberately NOT `npm run build`: the
# backup wrapper would create commits, which an unattended watcher must not do.
if node esbuild.config.mjs production >> "$LOG_FILE" 2>&1; then
    log "deploy: build OK — vault plugin folders updated to ${REMOTE:0:9}"
else
    log "deploy: BUILD FAILED for ${REMOTE:0:9} — see output above"
    exit 1
fi
