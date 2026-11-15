#!/bin/bash
# Brings the Mac's company repos up to date with origin/main, so work that
# cloud sessions and scheduled routines land on GitHub reaches the vaults.
#
# One shot: it runs, reports, and exits. Nothing stays running and nothing is
# scheduled by this script (owner's rule: no background processes on the Mac
# Studio). The Daily brief runs it each morning and puts the report in the
# Clearing House "Deploys" card; `npm run deploy` still works by hand.
#
# For each repo it:
#   - skips it unless `main` is checked out, the working tree is clean and
#     main has no commits GitHub lacks, so it never touches work in progress;
#   - fast-forwards `main` to origin/main (never merges, rebases or resets);
#   - if the repo has an `npm run deploy` script and HEAD has not been
#     deployed yet, runs `npm ci` when package-lock.json changed, then
#     `npm run deploy`, which rebuilds the plugin into the vaults.
#
# Usage: sync-repos.sh [--root <dir>] [--report <file.json>] [--dry-run]
#   --report  writes {rows, meta} JSON: one row per repo with its state.
# Written for the bash 3.2 that ships with macOS.

set -u

REPOS="radial-timeline editorialist radial-timeline-community radial-timeline-web radial-timeline-platform radial-timeline-email radial-timeline-engine"
ROOT="${RT_SYNC_ROOT:-$HOME/Documents/Radial Timeline LLC}"
DRY_RUN=0
REPORT=""
LOCK_DIR="${TMPDIR:-/tmp}/rt-repo-sync.lock"
ROWS_FILE=""
NPM_LOG="${RT_SYNC_NPM_LOG:-$HOME/Library/Logs/rt-repo-sync-npm.log}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# One report row: repo, state, GitHub commit, its subject, deployed commit, note.
# States: Up to date, Updated, Not synced, Failed.
record() {
	log "$1: $2${6:+ — $6}"
	[ -n "$ROWS_FILE" ] || return 0
	printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$(printf '%s' "$4" | tr '\t' ' ')" "$5" "$6" >> "$ROWS_FILE"
}

has_deploy_script() {
	[ -f package.json ] && node -e 'process.exit(require("./package.json").scripts?.deploy ? 0 : 1)' 2>/dev/null
}

is_dirty() { [ -n "$(git status --porcelain --untracked-files=no)" ]; }

sync_repo() {
	local dir="$1" name="$2"
	cd "$dir" || return 0
	local gitdir
	gitdir=$(git rev-parse --absolute-git-dir 2>/dev/null) || return 0

	if ! git fetch --quiet origin main 2>/dev/null; then
		record "$name" "Failed" "" "" "" "Couldn't reach GitHub."
		return 0
	fi

	local branch head remote subject plugin=0 deployed="" marker="$gitdir/rt-sync-deployed"
	branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo "(detached)")
	head=$(git rev-parse HEAD)
	remote=$(git rev-parse origin/main)
	subject=$(git log -1 --format=%s origin/main)
	has_deploy_script && plugin=1
	[ -f "$marker" ] && deployed=$(cat "$marker")
	local vaults="no build"
	[ "$plugin" = 1 ] && vaults="${deployed:0:9}"

	if [ "$head" != "$remote" ]; then
		if [ "$branch" != "main" ]; then
			record "$name" "Not synced" "${remote:0:9}" "$subject" "$vaults" "On branch $branch, not main."
			return 0
		fi
		if is_dirty; then
			record "$name" "Not synced" "${remote:0:9}" "$subject" "$vaults" "Uncommitted changes in the repo."
			return 0
		fi
		if ! git merge-base --is-ancestor HEAD origin/main; then
			record "$name" "Not synced" "${remote:0:9}" "$subject" "$vaults" "Local main has commits GitHub doesn't."
			return 0
		fi
		if [ "$DRY_RUN" = 1 ]; then
			record "$name" "Not synced" "${remote:0:9}" "$subject" "$vaults" "Dry run: would pull ${head:0:9} → ${remote:0:9}."
			return 0
		fi
		if ! git merge --ff-only --quiet origin/main; then
			record "$name" "Failed" "${remote:0:9}" "$subject" "$vaults" "Fast-forward failed."
			return 0
		fi
		log "$name: fast-forwarded ${head:0:9} -> ${remote:0:9}"
	fi

	if [ "$plugin" = 0 ]; then
		if [ "$head" != "$remote" ]; then
			record "$name" "Updated" "${remote:0:9}" "$subject" "$vaults" "Pulled ${head:0:9} → ${remote:0:9}."
		else
			record "$name" "Up to date" "${remote:0:9}" "$subject" "$vaults" ""
		fi
		return 0
	fi

	if [ "$branch" != "main" ] || is_dirty; then
		# Already at origin/main, but never build uncommitted work or another branch.
		if [ "$deployed" = "$remote" ]; then
			record "$name" "Up to date" "${remote:0:9}" "$subject" "$vaults" ""
		else
			record "$name" "Not synced" "${remote:0:9}" "$subject" "$vaults" "Not built: $( [ "$branch" != main ] && echo "on branch $branch" || echo "uncommitted changes")."
		fi
		return 0
	fi
	if [ "$deployed" = "$remote" ]; then
		record "$name" "Up to date" "${remote:0:9}" "$subject" "$vaults" ""
		return 0
	fi
	if [ "$DRY_RUN" = 1 ]; then
		record "$name" "Not synced" "${remote:0:9}" "$subject" "$vaults" "Dry run: would build ${remote:0:9} into the vaults."
		return 0
	fi

	mkdir -p "$(dirname "$NPM_LOG")"
	if [ -n "$deployed" ] && git cat-file -e "$deployed" 2>/dev/null \
		&& ! git diff --quiet "$deployed" HEAD -- package-lock.json; then
		log "$name: package-lock.json changed, running npm ci"
		if ! npm ci --no-audit --no-fund >>"$NPM_LOG" 2>&1; then
			record "$name" "Failed" "${remote:0:9}" "$subject" "$vaults" "npm ci failed; see $NPM_LOG."
			return 0
		fi
	fi
	log "$name: deploying ${remote:0:9}"
	if npm run --silent deploy >>"$NPM_LOG" 2>&1; then
		printf '%s' "$remote" > "$marker"
		record "$name" "Updated" "${remote:0:9}" "$subject" "${remote:0:9}" "Built into the vaults${deployed:+ (was ${deployed:0:9})}."
	else
		record "$name" "Failed" "${remote:0:9}" "$subject" "$vaults" "npm run deploy failed; see $NPM_LOG."
	fi
}

write_report() {
	node - "$ROWS_FILE" "$REPORT" "$ROOT" <<'JS'
const fs = require("fs");
const [rowsFile, out, root] = process.argv.slice(2);
const cols = ["repo", "state", "github", "github_subject", "vaults", "note"];
const rows = fs.readFileSync(rowsFile, "utf8").split("\n").filter(Boolean).map((line) => {
	const cells = line.split("\t");
	return Object.fromEntries(cols.map((c, i) => [c, cells[i] || null]));
}).sort((a, b) => a.repo.localeCompare(b.repo));
const meta = [
	{ label: "Checked", value: new Date().toISOString() },
	{ label: "Repos folder", value: root },
	{ label: "Script", value: "radial-timeline/scripts/mac-sync/sync-repos.sh" },
];
fs.writeFileSync(out, JSON.stringify({ rows, meta }, null, 2) + "\n");
JS
}

main() {
	while [ $# -gt 0 ]; do
		case "$1" in
			--root) ROOT="$2"; shift 2 ;;
			--report) REPORT="$2"; shift 2 ;;
			--dry-run) DRY_RUN=1; shift ;;
			*) echo "Unknown option: $1" >&2; exit 2 ;;
		esac
	done

	if ! mkdir "$LOCK_DIR" 2>/dev/null; then
		log "another sync is running; skipped"
		exit 0
	fi
	trap 'rmdir "$LOCK_DIR" 2>/dev/null; [ -n "$ROWS_FILE" ] && rm -f "$ROWS_FILE"' EXIT
	[ -n "$REPORT" ] && ROWS_FILE=$(mktemp)

	[ -d "$ROOT" ] || { log "repos folder not found: $ROOT"; exit 1; }

	# Find each repo by its origin remote, not a hard-coded path, so moving a
	# repo folder doesn't break the sync.
	local gitdir dir url name
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
	done < <(find "$ROOT" -maxdepth 4 -name node_modules -prune -o -name .git -type d -print 2>/dev/null)

	[ -n "$REPORT" ] && write_report && log "report written to $REPORT"
	return 0
}

main "$@"
