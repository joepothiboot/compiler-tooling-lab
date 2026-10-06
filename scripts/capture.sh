#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ONLY="${1:-}"
TMP_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
WORK="${WORK_DIR:-${TMP_ROOT%/}/compiler-tooling-lab-work}"
WORK="${WORK%/}"

if [[ "$WORK" == *" "* ]]; then
  echo "WORK_DIR must not contain spaces (lit's %s substitution breaks): $WORK" >&2
  exit 1
fi

LLVM_MAJOR="$(node -p "require('$ROOT/manifest.json').toolchain.llvm.split('.')[0]")"

if [[ -z "${LLVM_PREFIX:-}" ]]; then
  if command -v brew >/dev/null 2>&1 && [[ -d "$(brew --prefix llvm 2>/dev/null)" ]]; then
    LLVM_PREFIX="$(brew --prefix llvm)"
  else
    LLVM_PREFIX="/usr/lib/llvm-${LLVM_MAJOR}"
  fi
fi

if [[ ! -f "$LLVM_PREFIX/lib/cmake/mlir/MLIRConfig.cmake" ]]; then
  echo "MLIRConfig.cmake not found under $LLVM_PREFIX (set LLVM_PREFIX)" >&2
  exit 1
fi

export PATH="$LLVM_PREFIX/bin:$PATH"
mkdir -p "$WORK/src" "$WORK/logs"

checkout() {
  local id="$1" repo="$2" commit="$3"
  local dir="$WORK/src/$id" url

  if [[ -n "${REPO_BASE:-}" ]]; then
    url="$REPO_BASE/${repo#*/}"
  else
    url="https://github.com/$repo.git"
  fi

  rm -rf "$dir"
  git init -q "$dir"
  git -C "$dir" remote add origin "$url"
  git -C "$dir" fetch -q --depth 1 origin "$commit"
  git -C "$dir" checkout -q --detach FETCH_HEAD

  [[ "$(git -C "$dir" rev-parse HEAD)" == "$commit" ]]
}

build() {
  local id="$1"
  local dir="$WORK/src/$id" log="$WORK/logs/$id-build.log"

  echo "==> build $id (log: $log)"

  case "$id" in
    schema-mlir) (cd "$dir" && MLIR_INSTALL="$LLVM_PREFIX" bash build.sh) ;;
    nano-dsp-mlir) (cd "$dir" && MLIR_DIR="$LLVM_PREFIX/lib/cmake/mlir" bash test.sh) ;;
    vizmlir) (cd "$dir" && npm ci --no-audit --no-fund && npm run wasm) ;;
  esac >"$log" 2>&1 || echo "!! $id build exited non-zero; capture will record what is missing (see $log)"
}

while read -r id repo commit; do
  [[ -z "$ONLY" || "$ONLY" == "$id" || "$ONLY" == "vizmlir" ]] || continue

  echo "==> checkout $id @ $commit"
  checkout "$id" "$repo" "$commit"
  build "$id"
done < <(node -e "for (const p of require('$ROOT/manifest.json').projects) console.log(p.id, p.repo, p.commit)")

node "$ROOT/scripts/capture.mjs" --work "$WORK" --llvm "$LLVM_PREFIX" ${ONLY:+--project "$ONLY"}
