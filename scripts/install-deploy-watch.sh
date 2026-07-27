#!/bin/bash
# One-time installer for the deploy watcher (run ON the Mac Studio):
#
#   bash scripts/install-deploy-watch.sh
#
# Installs a launchd agent that runs scripts/deploy-watch.sh every 2 minutes.
# From then on, any merge to origin/main (including merges made from remote
# Claude Code sessions) lands in the local checkout and all Obsidian vault
# plugin folders automatically — restart/reload Obsidian to pick it up.
#
# Uninstall: launchctl bootout "gui/$(id -u)/com.radialtimeline.deploywatch"
#            rm ~/Library/LaunchAgents/com.radialtimeline.deploywatch.plist
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.radialtimeline.deploywatch"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

chmod +x "$REPO_DIR/scripts/deploy-watch.sh"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$REPO_DIR/scripts/deploy-watch.sh</string>
    </array>
    <key>StartInterval</key>
    <integer>120</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>$REPO_DIR/.deploy-watch.err</string>
</dict>
</plist>
PLIST_EOF

# Reload cleanly if already installed.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Deploy watcher installed and running (checks origin/main every 2 min)."
echo "Log: $REPO_DIR/.deploy-watch.log"
