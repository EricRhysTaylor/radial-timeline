#!/bin/bash
# Keeps the Mac's local repos in step with origin/main, so work that cloud
# sessions and scheduled routines land on GitHub reaches the vaults without
# anyone running a command.
#
# launchd runs this every 15 minutes and at login (see install.sh). Each run
# checks each known repo, does its work, and exits — nothing stays running.
#
# For each repo it:
#   - skips it unless `main` is checked out and the working tree is clean, so
#     it never touches work in progress (yours or a local agent's);
#   - fast-forwards `main` to origin/main (never merges, rebases or resets);
#   - if the repo has an `npm run deploy` script and HEAD has not been
#     deployed yet, runs `npm ci` when package-lock.json changed, then
#     `npm run deploy`, which rebuilds the plugin into the vaults;
#   - posts one macOS notification per new result, not one per run.
#
# Usage: sync-repos.sh [--root <dir>] [--dry-run]
# Written for the bash 3.2 that ships with macOS.

set -u

REPOS="radial-timeline editorialist radial-timeline-community radial-timeline-web radial-timeline-platform radial-timeline-email radial-timeline-engine"
ROOT="${RT_SYNC_ROOT:-$HOME/Documents/Radial Timeline LLC}"
DRY_RUN=0
LOCK_DIR="${TMPDIR:-/tmp}/rt-repo-sync.lock"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

notify() {
	# $1 title, $2 message
	log "NOTIFY: $1 — $2"
	[ "$DRY_RUN" = 1 ] && return 0
	if command -v osascript >/dev/null 2>&1; then
		local title msg
		title=$(printf '%s' "$1" | sed 's/["\\]/\\&/g')
		msg=$(printf '%s' "$2" | sed 's/["\\]/\\&/g')
		osascript -e "display notification \"$msg\" with title \"$title\"" >/dev/null 2>&1 || true
	fi
}

# Notify once per (repo, key): a repo that stays blocked does not nag every
# 15 minutes; a new origin commit or a new failure notifies again.
notify_once() {
	# $1 git dir, $2 key, $3 title, $4 message
	local marker="$1/rt-sync-notified"
	if [ -f "$marker" ] && [ "$(cat "$marker")" = "$2" ]; then
		return 0
	fi
	notify "$3" "$4"
	[ "$DRY_RUN" = 1 ] || printf '%s' "$2" > "$marker"
}

has_deploy_script() {
	[ -f package.json ] && node -e 'process.exit(require("./package.json").scripts?.deploy ? 0 : 1)' 2>/dev/null
}

sync_repo() {
	local dir="$1" name="$2"
	cd "$dir" || return 0
	local gitdir
	gitdir=$(git rev-parse --absolute-git-dir 2>/dev/null) || return 0

	if ! git fetch --quiet origin main 2>/dev/null; then
		notify_once "$gitdir" "fetch-failed" "$name: can't reach GitHub" "Sync could not fetch origin/main. It will keep trying."
		log "$name: fetch failed"
		return 0
	fi

	local branch head remote
	branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "(detached)")
	head=$(git rev-parse HEAD)
	remote=$(git rev-parse origin/main)

	if [ "$head" != "$remote" ]; then
		if [ "$branch" != "main" ]; then
			notify_once "$gitdir" "branch:$branch:$remote" "$name: not synced" "On branch $branch, not main. Switch to main to receive new work."
			log "$name: on $branch, skipped"
			return 0
		fi
		if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
			notify_once "$gitdir" "dirty:$remote" "$name: not synced" "Uncommitted changes in the repo. New work from GitHub will arrive once they are committed."
			log "$name: uncommitted changes, skipped"
			return 0
		fi
		if ! git merge-base --is-ancestor HEAD origin/main; then
			notify_once "$gitdir" "diverged:$head:$remote" "$name: not synced" "Local main has commits GitHub doesn't. Push or reconcile them; sync won't touch it."
			log "$name: local main has unpushed commits, skipped"
			return 0
		fi
		if [ "$DRY_RUN" = 1 ]; then
			log "$name: would fast-forward ${head:0:9} -> ${remote:0:9}"
		else
			git merge --ff-only --quiet origin/main || { log "$name: fast-forward failed"; return 0; }
			log "$name: fast-forwarded ${head:0:9} -> ${remote:0:9}"
		fi
	fi

	has_deploy_script || return 0
	[ "$branch" = "main" ] || return 0
	# Never build uncommitted work into the vaults.
	[ -z "$(git status --porcelain --untracked-files=no)" ] || return 0

	local target deployed_marker="$gitdir/rt-sync-deployed" deployed=""
	target=$(git rev-parse origin/main)
	[ "$DRY_RUN" = 1 ] || target=$(git rev-parse HEAD)
	[ -f "$deployed_marker" ] && deployed=$(cat "$deployed_marker")
	[ "$deployed" = "$target" ] && return 0

	if [ "$DRY_RUN" = 1 ]; then
		log "$name: would deploy ${target:0:9}"
		return 0
	fi

	if [ -n "$deployed" ] && git cat-file -e "$deployed" 2>/dev/null \
		&& ! git diff --quiet "$deployed" HEAD -- package-lock.json; then
		log "$name: package-lock.json changed, running npm ci"
		if ! npm ci --no-audit --no-fund >>"$LOG_FILE.npm" 2>&1; then
			notify_once "$gitdir" "ci-failed:$target" "$name: update failed" "npm ci failed. See ~/Library/Logs/rt-repo-sync.log.npm"
			return 0
		fi
	fi

	log "$name: deploying ${target:0:9}"
	if npm run --silent deploy >>"$LOG_FILE.npm" 2>&1; then
		printf '%s' "$target" > "$deployed_marker"
		local subject
		subject=$(git log -1 --format=%s "$target")
		notify "$name updated" "Now in your vaults: $subject"
	else
		notify_once "$gitdir" "deploy-failed:$target" "$name: update failed" "npm run deploy failed. See ~/Library/Logs/rt-repo-sync.log.npm"
	fi
}

main() {
	while [ $# -gt 0 ]; do
		case "$1" in
			--root) ROOT="$2"; shift 2 ;;
			--dry-run) DRY_RUN=1; shift ;;
			*) echo "Unknown option: $1" >&2; exit 2 ;;
		esac
	done
	LOG_FILE="${RT_SYNC_LOG:-$HOME/Library/Logs/rt-repo-sync.log}"

	if ! mkdir "$LOCK_DIR" 2>/dev/null; then
		log "previous run still going, skipped"
		exit 0
	fi
	trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

	[ -d "$ROOT" ] || { log "root not found: $ROOT"; exit 0; }

	# Find each repo by its folder's origin remote, not by a hard-coded path,
	# so moving a repo folder doesn't break the sync.
	local gitdir dir url name
	find "$ROOT" -maxdepth 4 -name node_modules -prune -o -name .git -type d -print 2>/dev/null |
	while IFS= read -r gitdir; do
		dir=$(dirname "$gitdir")
		url=$(git -C "$dir" remote get-url origin 2>/dev/null) || continue
		name=$(basename "$url" .git)
		case "$url" in
			*[:/][Ee]ric[Rr]hys[Tt]aylor/*) ;;
			*) continue ;;
		esac
		case " $REPOS " in
			*" $name "*) ( sync_repo "$dir" "$name" ) ;;
		esac
	done
}

main "$@"
