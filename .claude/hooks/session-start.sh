#!/bin/bash
# Prepares a fresh (remote) checkout so `npm run gates` can pass:
#   - installs pinned dependencies (incl. the TypeScript version in package.json)
#   - generates the gitignored styles.css build artifact the CSS gate reads
# Without this, a fresh clone fails gates on a missing styles.css and a
# mismatched TypeScript, which the Stop-hook gate then loops on.
set -euo pipefail

# Only needed in remote/cloud environments; a local checkout already has these.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
npm install
node scripts/bundle-css.mjs
