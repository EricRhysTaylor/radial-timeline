#!/bin/bash
# Stop hook: run the gates after a turn and wake the agent if they fail.
# A failure wakes the agent, whose reply ends another turn, so an unfixed
# failure (often another session's uncommitted work in this shared checkout)
# would rerun every few seconds. A turn that ends less than COOLDOWN seconds
# after the last run finished skips the run.

COOLDOWN=60

if [ "$CLAUDE_CODE_REMOTE" = "true" ]; then exit 0; fi
if ! command -v npm >/dev/null 2>&1; then echo "gates skipped: npm not on PATH"; exit 0; fi

cd "$CLAUDE_PROJECT_DIR" || exit 0
mkdir -p .gate-logs
stamp=.gate-logs/.stop-hook-last-run
if [ -f "$stamp" ]; then
  age=$(( $(date +%s) - $(stat -f %m "$stamp") ))
  if [ "$age" -lt "$COOLDOWN" ]; then exit 0; fi
fi
output=$(npm run gates 2>&1)
exit_code=$?
touch "$stamp" # measured from the end of a run: a full pass takes about a minute itself
if [ $exit_code -ne 0 ]; then
  echo "GATES FAILED (exit $exit_code) — fix before declaring work complete:"
  echo "$output" | tail -50
  exit 2
fi
exit 0
