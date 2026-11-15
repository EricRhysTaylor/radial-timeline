#!/bin/bash
# One-time setup on the Mac: installs a launchd job that runs sync-repos.sh
# every 15 minutes and at login. Re-run it any time; it replaces the old job.
# Remove with uninstall.sh.
set -euo pipefail

LABEL="com.radialtimeline.repo-sync"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/sync-repos.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/rt-repo-sync.log"

command -v npm >/dev/null || { echo "npm is not on PATH in this shell. Open a terminal where npm works and re-run." >&2; exit 1; }
# launchd starts jobs with a bare PATH. Record this shell's, so node, npm and
# git resolve exactly as they do when you run them yourself.
JOB_PATH="$PATH"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

echo "Checking what the first run would do (nothing is changed yet):"
bash "$SCRIPT" --dry-run

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>$(xml "$SCRIPT")</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key><string>$(xml "$JOB_PATH")</string>
	</dict>
	<key>StartInterval</key><integer>900</integer>
	<key>RunAtLoad</key><true/>
	<key>ProcessType</key><string>Background</string>
	<key>StandardOutPath</key><string>$(xml "$LOG")</string>
	<key>StandardErrorPath</key><string>$(xml "$LOG")</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo
echo "Installed. The first sync is running now; after that it runs every 15 minutes."
echo "Log: $LOG"
echo "Remove it with: bash \"$(dirname "$SCRIPT")/uninstall.sh\""
