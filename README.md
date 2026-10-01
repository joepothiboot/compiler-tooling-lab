# compiler-tooling-lab 🧪

One integration portal for three separate MLIR projects, presented as a single
developer-tooling pipeline:

**source → diagnostics → MLIR → pass inspection → profiling**

🌐 **Live site:** https://joepothiboot.github.io/compiler-tooling-lab/

| Order | Project                                                              | Role in the pipeline                                       |
| ----- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1     | [json-schema-mlir](https://github.com/joepothiboot/json-schema-mlir) | Source, diagnostics, MLIR lowering                         |
| 2     | [VizMLIR](https://github.com/joepothiboot/vizmlir)                   | Pass inspection and a GPU view of the IR (WASM parser)     |
| 3     | [nano-dsp-mlir](https://github.com/joepothiboot/nano-dsp-mlir)       | MLIR lowering, tiling, vectorization, execution, profiling |

## 📦 The three projects

Each is pinned to a full commit in `manifest.json`. The test counts are the
results captured from that commit's own runners.

### 📐 json-schema-mlir (`914691c`)

An out-of-tree MLIR dialect that compiles JSON Schema (Draft 2020-12) into
native validators.

- A hand-written front end: lexer, recursive-descent parser and importer into
  the `schema` dialect, one op per keyword, located at that keyword.
  `--emit-trace` writes the whole run for the trace viewer.
- Constraint-lattice canonicalization (subsumption, fusion), then lowering to
  `arith`/`scf`/`math`/`func` and the LLVM dialect.
- A Mojo library with the same lattice, tested for soundness of `meet`.
- Captured: 11 lit tests and 12 Mojo tests, all passing.
- Details: [`docs/trace-format.md`](https://github.com/joepothiboot/json-schema-mlir/blob/914691c49d2d685f26fb67e5ebd08ed968ea4fe7/docs/trace-format.md) and its README (keywords, runtime ABI, pass flags).

### 🔍 VizMLIR (`4064da8`)

A browser tool that reads `mlir-opt` pass traces and draws what the IR means.

- A GPU view: launches as blocks and warps, buffers by memory space, and a
  coalesced, strided, misaligned or bank-conflict verdict per access, proven for
  every warp when addresses are linear.
- NVIDIA GPU code (CUDA) is followed through MLIR: `gpu.launch`, `affine`
  index math, NVVM thread and block ids and loads and stores in the LLVM
  dialect, down to the PTX that comes out. It reads MLIR, not CUDA C++ source.
- Triton GPU IR (`tt.`/`ttg.`): which thread holds which element under a
  `#blocked` layout, with proven verdicts for every `tt.load` and `tt.store`.
  The Triton sample is hand-written in Triton 3.x TTGIR format, because Triton
  does not run on macOS; the CUDA-path samples are real `mlir-opt` output.
- VizMLIR only reads IR and never runs it, so it gives verdicts, not timings.
  Timings from Nsight Systems, Nsight Compute or Google Benchmark can be
  imported and lined up with the passes.
- Step through a pipeline with before/after diffs, op counts, pass timing and
  buffer lifetimes.
- Everything runs in the browser; the portal links to its live app.
- Captured: 330 vitest tests, all passing.
- Details: [`docs/trace-format.md`](https://github.com/joepothiboot/vizmlir/blob/4064da83a3cb52ad82434b681139efa4ab8ae7cc/docs/trace-format.md), [`docs/benchmark-format.md`](https://github.com/joepothiboot/vizmlir/blob/4064da83a3cb52ad82434b681139efa4ab8ae7cc/docs/benchmark-format.md) and the in-app **Learn** guide.

### ⚡ nano-dsp-mlir (`0de4c3c`)

A small MLIR compiler for a tensor DSL.

- A `dsp` dialect (`add`, `relu`, `matmul`, `conv2d` and the int8 `qmatmul`)
  lowered to `linalg.generic` and on to LLVM.
- Tiling and vectorization from a Transform-dialect schedule generated from a
  target model, checked bit for bit against the unscheduled code.
- SIMD Mojo kernels and a scalar C++ reference tested against the same values.
- Captured: 23 lit tests, 17 Mojo tests and 7 C++ reference tests, all passing.
- Details: [`docs/02-tiling-model.md`](https://github.com/joepothiboot/nano-dsp-mlir/blob/0de4c3c45b25a06758c2f28e26f25cc88aa9dfd1/docs/02-tiling-model.md), [`docs/quantization.md`](https://github.com/joepothiboot/nano-dsp-mlir/blob/0de4c3c45b25a06758c2f28e26f25cc88aa9dfd1/docs/quantization.md), [`docs/hexagon-target.md`](https://github.com/joepothiboot/nano-dsp-mlir/blob/0de4c3c45b25a06758c2f28e26f25cc88aa9dfd1/docs/hexagon-target.md).
- Not captured here: the emulated Hexagon run and the benchmark comparison of
  tiled MLIR kernels against Mojo, which is not done yet.

The site is one static article page: each project is a section of the prose,
and its captured outputs, architecture, run steps and tests open in a closable
dialog from links in the text (an appendix when JS is off). It is plain HTML,
CSS and a few lines of vanilla JS. No framework,
bundler, WASM or runtime dependency. VizMLIR's interactive app is linked at
[its own site](https://joepothiboot.github.io/vizmlir/).

The json-schema-mlir section also carries a **trace viewer**: it draws the file
`schema-translate --emit-trace` writes (source, tokens, AST and the IR before and
after canonicalization, tied to source ranges) and links each op back to the
JSON that produced it. The viewer only reads the captured trace; the compiler
does not run in your browser.

## 📏 Rules

- **Pinned, never floating.** `manifest.json` pins every project to a full
  commit SHA. Branch names are refused by the tooling. All source and docs links
  point at the pinned commit.
- **Nothing is faked.** Every artifact is one of:
  - `captured`: output of the project's own tool at the pinned commit, with the exact command, host and toolchain
  - `static`: a file shown verbatim from the repo at the pinned commit
  - `unavailable`: deliberately absent, with the reason
- **Stale data fails the build.** An artifact file captured at a different commit than the manifest pins is rejected.

## 🏁 Setup

```bash
npm ci
npm run check        # format check, typecheck, tests, build
npx serve dist       # or any static server
```

Requires Node 20+. The site builds from the committed `artifacts/`, so no LLVM
is needed for the day-to-day loop.

VizMLIR is the only project with an interactive app; the portal links to its
own site at https://joepothiboot.github.io/vizmlir/ rather than bundling a copy.

### 🔄 Re-capturing artifacts

```bash
bash scripts/capture.sh            # all projects
bash scripts/capture.sh vizmlir    # one project (VizMLIR always re-reads the others' IR)
```

This needs LLVM/MLIR (the version in `manifest.json` → `toolchain.llvm`, with
FileCheck, `mlir-runner` and `lit`), Python 3.11, Node, Rust and
[pixi](https://pixi.sh) (which installs the Mojo version each project pins). It clones each
project at its pin into `$WORK_DIR`, which must not contain spaces because
lit's `%s` substitution breaks on them. It then builds each project with the
project's own scripts and runs `scripts/capture.mjs`. Set `REPO_BASE=<dir>` to
clone from local checkouts instead of GitHub.

## 🏗️ Architecture

```
manifest.json            pins: repo, version, commit, stages, capabilities
content/projects.js      article text; every behavioural claim references an artifact id
artifacts/<id>.json      captured/static/unavailable artifacts per project (generated)
inputs/                  inputs written for this lab (clearly labelled on the site)
src/model.js             shared data model: JSDoc types + validators
src/parse.js             parsers for real tool output (diagnostics, IR dumps, timing, lit, vitest, Mojo/C++ tests)
src/trace.js             validates and indexes a schema-translate --emit-trace file
src/render.js            HTML rendering (pure functions): the article and its notes
src/render-trace.js      static markup for the trace viewer
src/site.css, *.js       the only shipped CSS/JS (notes.js opens notes as dialogs, trace-viewer.js drives the trace viewer)
scripts/capture.sh|.mjs  clone at pin → build → run tools → artifacts/
scripts/build.mjs        validate everything → dist/
scripts/update-manifest.mjs, reconcile.mjs, lib-git.mjs   synchronization
test/                    unit tests + an integration test over the built site
```

### 🧬 Shared data model

All three projects contribute the same artifact kinds, defined in
[`src/model.js`](src/model.js). A `trace` kind (the front end's own trace file,
kept verbatim) is used by json-schema-mlir only:

| Kind          | Carries                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `source`      | Input text with a `SourceLocation` (`file`, 1-based `line`, `column`)     |
| `diagnostic`  | Tool, exit code, entries of severity + message + `SourceLocation \| null` |
| `ir-snapshot` | IR text, dialect stage, optional VizMLIR graph summary                    |
| `pass-event`  | Pass name, order, changed?, before/after snapshot ids, optional diff      |
| `profile`     | Metric, unit, total, nested entries                                       |
| `execution`   | Exit code, stdout, expected lines                                         |
| `test-run`    | Runner, pass/fail/error/skip counts, log                                  |

Artifact ids are global, so a VizMLIR pass event can reference snapshots
captured from json-schema-mlir.

## 🔁 Synchronization

| Workflow                                           | Trigger                                  | Does                                                                      |
| -------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------- |
| [`ci.yml`](.github/workflows/ci.yml)               | pull requests                            | format check, typecheck, tests, build                                     |
| [`deploy.yml`](.github/workflows/deploy.yml)       | push to `main`, manual                   | CI, then builds pinned VizMLIR and the site, then deploys to GitHub Pages |
| [`update.yml`](.github/workflows/update.yml)       | manual, `repository_dispatch`, reconcile | re-pin → re-capture all artifacts → check → open an integration PR        |
| [`reconcile.yml`](.github/workflows/reconcile.yml) | daily schedule, manual                   | flags unreachable pins/stale artifacts, dispatches missed releases        |

To have a project announce a release, add a step to its release workflow
(it needs a token with `repo` scope on this repository):

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $LAB_DISPATCH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/joepothiboot/compiler-tooling-lab/dispatches \
  -d '{"event_type":"project-release","client_payload":{"project":"vizmlir","ref":"v0.3.0"}}'
```

Set the `PIN_UPDATE_TOKEN` secret (PAT or GitHub App token) so integration PRs
trigger CI. PRs opened with the default `GITHUB_TOKEN` do not.

Manually: `node scripts/update-manifest.mjs --project <id> --ref <tag|sha>`,
then `bash scripts/capture.sh`.

## 🤝 Contributing

- Keep claims tied to artifacts. If a page says a tool does something, reference
  an artifact id that shows it. The build fails on missing ids.
- Never hand-edit `artifacts/`. Re-run capture. If something cannot be captured,
  emit an `unavailable` artifact with the reason instead of a placeholder.
- Inputs written for the lab go in `inputs/`; they render as lab files, never as
  project files.
- Run `npm run check` before opening a PR.

## 📜 License

MIT. See [`LICENSE`](LICENSE).
