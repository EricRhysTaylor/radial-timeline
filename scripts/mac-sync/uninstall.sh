#!/bin/bash
# Removes the launchd job that install.sh set up. Repos and vaults are untouched.
LABEL="com.radialtimeline.repo-sync"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Repo sync removed."
