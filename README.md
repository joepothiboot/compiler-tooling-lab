# compiler-tooling-lab

One integration portal for three separate MLIR projects, presented as a single
developer-tooling pipeline:

**source → diagnostics → MLIR → pass inspection → profiling**

**Live site:** https://joepothiboot.github.io/compiler-tooling-lab/

| Order | Project                                                              | Role in the pipeline                 |
| ----- | -------------------------------------------------------------------- | ------------------------------------ |
| 1     | [json-schema-mlir](https://github.com/joepothiboot/json-schema-mlir) | Source, diagnostics, MLIR lowering   |
| 2     | [VizMLIR](https://github.com/joepothiboot/vizmlir)                   | Pass inspection (WASM parser + diff) |
| 3     | [nano-dsp-mlir](https://github.com/joepothiboot/nano-dsp-mlir)       | MLIR lowering, execution, profiling  |

The site is static HTML, CSS and a few lines of vanilla JS. No framework,
bundler, WASM or runtime dependency. VizMLIR's interactive app is linked at
[its own site](https://joepothiboot.github.io/vizmlir/).

## Rules

- **Pinned, never floating.** `manifest.json` pins every project to a full
  commit SHA. Branch names are refused by the tooling. All source and docs links
  point at the pinned commit.
- **Nothing is faked.** Every artifact is one of:
  - `captured`: output of the project's own tool at the pinned commit, with the exact command, host and toolchain
  - `static`: a file shown verbatim from the repo at the pinned commit
  - `unavailable`: deliberately absent, with the reason
- **Stale data fails the build.** An artifact file captured at a different commit than the manifest pins is rejected.

## Setup

```bash
npm ci
npm run check        # format check, typecheck, tests, build
npx serve dist       # or any static server
```

Requires Node 20+. The site builds from the committed `artifacts/`, so no LLVM
is needed for the day-to-day loop.

VizMLIR is the only project with an interactive app; the portal links to its
own site at https://joepothiboot.github.io/vizmlir/ rather than bundling a copy.

### Re-capturing artifacts

```bash
bash scripts/capture.sh            # all projects
bash scripts/capture.sh vizmlir    # one project (VizMLIR always re-reads the others' IR)
```

This needs LLVM/MLIR (the version in `manifest.json` → `toolchain.llvm`, with
FileCheck, `mlir-runner` and `lit`), Python 3.11, Node and Rust. It clones each
project at its pin into `$WORK_DIR`, which must not contain spaces because
lit's `%s` substitution breaks on them. It then builds each project with the
project's own scripts and runs `scripts/capture.mjs`. Set `REPO_BASE=<dir>` to
clone from local checkouts instead of GitHub.

## Architecture

```
manifest.json            pins: repo, version, commit, demo path, stages, capabilities
content/projects.js      page text; every behavioural claim references an artifact id
artifacts/<id>.json      captured/static/unavailable artifacts per project (generated)
inputs/                  inputs written for this lab (clearly labelled on the site)
src/model.js             shared data model: JSDoc types + validators
src/parse.js             parsers for real tool output (diagnostics, IR dumps, timing, lit, pytest)
src/render.js            HTML rendering (pure functions)
src/site.css, copy.js    the only shipped CSS/JS
scripts/capture.sh|.mjs  clone at pin → build → run tools → artifacts/
scripts/build.mjs        validate everything → dist/
scripts/update-manifest.mjs, reconcile.mjs, lib-git.mjs   synchronization
test/                    unit tests + an integration test over the built site
```

### Shared data model

All three projects contribute the same artifact kinds, defined in
[`src/model.js`](src/model.js):

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

## Synchronization

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

## Contributing

- Keep claims tied to artifacts. If a page says a tool does something, reference
  an artifact id that shows it. The build fails on missing ids.
- Never hand-edit `artifacts/`. Re-run capture. If something cannot be captured,
  emit an `unavailable` artifact with the reason instead of a placeholder.
- Inputs written for the lab go in `inputs/`; they render as lab files, never as
  project files.
- Run `npm run check` before opening a PR.
