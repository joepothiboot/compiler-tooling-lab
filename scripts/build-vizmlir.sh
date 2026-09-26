#!/usr/bin/env bash
# Builds VizMLIR at the commit pinned in manifest.json, with a relative base so
# it can be served from any sub-path of this site.
#
#   scripts/build-vizmlir.sh <out-dir>
#
# Needs Node and Rust with the wasm32-unknown-unknown target.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$(mkdir -p "${1:?usage: build-vizmlir.sh <out-dir>}" && cd "$1" && pwd)"
read -r REPO COMMIT < <(node -e "const p=require('$ROOT/manifest.json').projects.find(p=>p.id==='vizmlir');console.log(p.repo,p.commit)")
TMP_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
SRC="${TMP_ROOT%/}/compiler-tooling-lab-vizmlir"
URL="${REPO_BASE:+$REPO_BASE/${REPO#*/}}"
URL="${URL:-https://github.com/$REPO.git}"

rm -rf "$SRC"
git init -q "$SRC"
git -C "$SRC" remote add origin "$URL"
git -C "$SRC" fetch -q --depth 1 origin "$COMMIT"
git -C "$SRC" checkout -q --detach FETCH_HEAD
[[ "$(git -C "$SRC" rev-parse HEAD)" == "$COMMIT" ]]

cd "$SRC"
npm ci --no-audit --no-fund
npm run wasm
npx vite build --base ./ --outDir "$OUT" --emptyOutDir
echo "VizMLIR @ ${COMMIT:0:7} built into $OUT"
