#!/usr/bin/env bash
# Regenerates artifacts/*.json from the pinned commits in manifest.json.
#
#   scripts/capture.sh [project-id]
#
# Env:
#   LLVM_PREFIX  LLVM/MLIR install (default: Homebrew llvm, else /usr/lib/llvm-<major>)
#   WORK_DIR     scratch dir for clones/builds; must not contain spaces (lit breaks)
#   REPO_BASE    clone from "$REPO_BASE/<repo-name>" instead of GitHub (local mirrors)
#
# Each project is built with its own scripts. A build failure does not stop the
# run: capture.mjs records the gap as an `unavailable` artifact instead.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ONLY="${1:-}"
TMP_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
WORK="${WORK_DIR:-${TMP_ROOT%/}/compiler-tooling-lab-work}"
WORK="${WORK%/}"
case "$WORK" in *" "*)
  echo "WORK_DIR must not contain spaces (lit's %s substitution breaks): $WORK" >&2
  exit 1
  ;;
esac

LLVM_MAJOR="$(node -p "require('$ROOT/manifest.json').toolchain.llvm.split('.')[0]")"
if [[ -z "${LLVM_PREFIX:-}" ]]; then
  if command -v brew >/dev/null 2>&1 && [[ -d "$(brew --prefix llvm 2>/dev/null)" ]]; then
    LLVM_PREFIX="$(brew --prefix llvm)"
  else
    LLVM_PREFIX="/usr/lib/llvm-${LLVM_MAJOR}"
  fi
fi
[[ -f "$LLVM_PREFIX/lib/cmake/mlir/MLIRConfig.cmake" ]] || {
  echo "MLIRConfig.cmake not found under $LLVM_PREFIX (set LLVM_PREFIX)" >&2
  exit 1
}
export PATH="$LLVM_PREFIX/bin:$PATH"
mkdir -p "$WORK/src" "$WORK/logs"

checkout() { # id repo commit
  local dir="$WORK/src/$1" url
  if [[ -n "${REPO_BASE:-}" ]]; then url="$REPO_BASE/${2#*/}"; else url="https://github.com/$2.git"; fi
  rm -rf "$dir"
  git init -q "$dir"
  git -C "$dir" remote add origin "$url"
  git -C "$dir" fetch -q --depth 1 origin "$3"
  git -C "$dir" checkout -q --detach FETCH_HEAD
  [[ "$(git -C "$dir" rev-parse HEAD)" == "$3" ]]
}

build() { # id
  local dir="$WORK/src/$1" log="$WORK/logs/$1-build.log"
  echo "==> build $1 (log: $log)"
  case "$1" in
    schema-mlir) (cd "$dir" && MLIR_INSTALL="$LLVM_PREFIX" bash build.sh) ;;
    nano-dsp-mlir) (cd "$dir" && MLIR_DIR="$LLVM_PREFIX/lib/cmake/mlir" bash test.sh) ;;
    mlir-lldb-tools) python3 -m venv "$WORK/venv-lldb" && "$WORK/venv-lldb/bin/pip" install -q -e "$dir[dev]" ;;
    vizmlir) (cd "$dir" && npm ci --no-audit --no-fund && npm run wasm) ;;
  esac >"$log" 2>&1 || echo "!! $1 build exited non-zero; capture will record what is missing (see $log)"
}

while read -r id repo commit; do
  [[ -z "$ONLY" || "$ONLY" == "$id" || "$ONLY" == "vizmlir" ]] || continue
  echo "==> checkout $id @ $commit"
  checkout "$id" "$repo" "$commit"
  build "$id"
done < <(node -e "for (const p of require('$ROOT/manifest.json').projects) console.log(p.id, p.repo, p.commit)")

node "$ROOT/scripts/capture.mjs" --work "$WORK" --llvm "$LLVM_PREFIX" ${ONLY:+--project "$ONLY"}
