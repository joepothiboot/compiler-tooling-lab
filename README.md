# compiler-tooling-lab

A static site that presents three separate MLIR projects as one compiler
tooling pipeline: source, diagnostics, MLIR, pass inspection and profiling.

Site: https://joepothiboot.github.io/compiler-tooling-lab/

Each project is pinned to a commit in `manifest.json`. Everything the site
shows (test results, IR dumps, diagnostics, timings) is output captured by
running that project's own tools at the pinned commit. Nothing is written by
hand.

| Project                                                              | Commit    | Covers                                                |
| -------------------------------------------------------------------- | --------- | ----------------------------------------------------- |
| [nano-dsp-mlir](https://github.com/joepothiboot/nano-dsp-mlir)       | `0de4c3c` | Lowering, tiling, vectorization, execution, profiling |
| [VizMLIR](https://github.com/joepothiboot/vizmlir)                   | `4064da8` | Pass inspection and GPU analysis of the IR            |
| [json-schema-mlir](https://github.com/joepothiboot/json-schema-mlir) | `914691c` | Front end, diagnostics, lowering                      |

## The projects

**nano-dsp-mlir** is an MLIR compiler for a small tensor DSL. A `dsp` dialect
is lowered to `linalg.generic` and on to LLVM, tiled and vectorized by a
Transform-dialect schedule generated from a target model, and checked bit for
bit against the unscheduled code. Mojo kernels and a C++ reference are tested
against the same values. Captured: 23 lit, 17 Mojo and 7 C++ reference tests.
The emulated Hexagon run and the MLIR-vs-Mojo benchmark aren't captured.

**VizMLIR** reads `mlir-opt` pass traces in the browser and shows how the IR
changes per pass. For GPU code it maps launches to blocks and warps, sorts
buffers by memory space, and classifies each load and store (coalesced,
strided, misaligned, broadcast, bank conflict). It follows CUDA-path MLIR down
to PTX and also reads Triton GPU IR. It reads IR only and doesn't time
anything. Captured: 330 vitest tests. The site links to
[its own app](https://joepothiboot.github.io/vizmlir/) instead of embedding it.

**json-schema-mlir** compiles JSON Schema (Draft 2020-12) to native
validators: a hand-written front end into a `schema` dialect, lattice-based
canonicalization, and lowering to the LLVM dialect, plus a Mojo library with
the same lattice. Captured: 11 lit and 12 Mojo tests. Its section includes a
trace viewer for the output of `schema-translate --emit-trace`, which links
each op back to the JSON that produced it.

## How the data stays honest

- Every project is pinned to a full commit SHA. The tooling refuses branch
  names, and all source links point at the pinned commit.
- Every artifact is one of three kinds: `captured` (tool output, with the exact
  command, host and toolchain), `static` (a file read verbatim from the repo),
  or `unavailable` (deliberately missing, with the reason).
- The build fails if an artifact was captured at a different commit than the
  manifest pins, or if the page references an artifact that doesn't exist.

## Development

Requirements: Node.js 20+.

```bash
npm ci
npm run check    # prettier, tsc, tests, build
npx serve dist
```

The site builds from the committed `artifacts/`, so day-to-day work doesn't
need LLVM.

### Re-capturing artifacts

```bash
bash scripts/capture.sh            # all projects
bash scripts/capture.sh vizmlir    # one project
```

This clones each project at its pinned commit, builds it with its own scripts
and runs `scripts/capture.mjs`. It needs LLVM/MLIR (version in
`manifest.json`, with `FileCheck`, `lit` and `mlir-runner`), Python 3.11, Node,
Rust and [pixi](https://pixi.sh) for Mojo.

Environment variables:

- `WORK_DIR`: scratch directory for clones and builds. Must not contain spaces
  (lit's `%s` substitution breaks on them).
- `REPO_BASE`: clone from local checkouts instead of GitHub.
- `LLVM_PREFIX`: LLVM install to use. Defaults to Homebrew's, or
  `/usr/lib/llvm-<major>` on Linux.

### Updating pins

```bash
node scripts/update-manifest.mjs --project <id> --ref <tag|sha>
bash scripts/capture.sh
```

| Workflow                                           | Trigger                                  | What it does                                                  |
| -------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| [`ci.yml`](.github/workflows/ci.yml)               | Pull requests                            | Format check, typecheck, tests, build                         |
| [`deploy.yml`](.github/workflows/deploy.yml)       | Push to `main`, manual                   | CI, then build and deploy to GitHub Pages                     |
| [`update.yml`](.github/workflows/update.yml)       | Manual, `repository_dispatch`, reconcile | Re-pin, re-capture all artifacts, check, push to `main`       |
| [`reconcile.yml`](.github/workflows/reconcile.yml) | Daily, manual                            | Flags unreachable pins and stale artifacts, re-sends releases |

`update.yml` refuses to push if the new capture has more `unavailable`
artifacts than before. Set the `PIN_UPDATE_TOKEN` secret (a PAT or GitHub App
token that can push to `main`) so the push triggers a deploy; pushes made with
the default `GITHUB_TOKEN` don't.

A project announces a release by sending a `repository_dispatch` event (vizmlir
and nano-dsp-mlir already do this on `v*` tags):

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $LAB_DISPATCH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/joepothiboot/compiler-tooling-lab/dispatches \
  -d '{"event_type":"project-release","client_payload":{"project":"vizmlir","ref":"v0.3.0"}}'
```

## Repository layout

```
manifest.json         pinned projects: repo, version, commit, stages
content/projects.js   page text; every claim references an artifact id
artifacts/            captured artifacts, one file per project (generated)
inputs/               inputs written for this lab, labelled as such on the site
src/                  data model, parsers, HTML rendering, browser scripts
src/styles/           stylesheets, concatenated into assets/site.css
scripts/              build, capture, manifest update and reconcile
test/                 unit tests and an integration test over the built site
```

All three projects contribute the same artifact kinds (`source`, `diagnostic`,
`ir-snapshot`, `pass-event`, `profile`, `execution`, `test-run`, plus `trace`
for json-schema-mlir), defined in [`src/model.js`](src/model.js). Artifact ids
are global, so a VizMLIR pass event can reference snapshots captured from
another project.

## Contributing

- Back every claim on the page with an artifact id; the build fails on
  missing ids.
- Don't edit `artifacts/` by hand. Re-run the capture, or record an
  `unavailable` artifact with the reason.
- Put inputs written for the lab in `inputs/`.
- Run `npm run check` before opening a PR.

## License

MIT. See [LICENSE](LICENSE).
