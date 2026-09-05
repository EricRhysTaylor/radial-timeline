#!/usr/bin/env bash

set -u

mkdir -p docs/audits
npx tsc -p tsconfig.audit.json --noEmit > docs/audits/tsc-unused.txt 2>&1 || true
