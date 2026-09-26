// Hand-written page text. Every claim about behaviour points at an artifact id
// (artifacts/*.json) so the build can check it exists and render its provenance.
// `{commit}` in `run` is replaced with the manifest pin at build time.

/**
 * @typedef {object} TourStep
 * @property {string} title
 * @property {string} text          Plain text; rendered escaped.
 * @property {string[]} [artifacts] Artifact ids rendered after the text.
 * @property {string} [timeline]    Artifact-id prefix whose pass events render as a table.
 */

/**
 * @typedef {object} ProjectContent
 * @property {string} summary       One line for cards.
 * @property {string[]} purpose
 * @property {string} [status]      Shown as a callout when the project has caveats.
 * @property {{ text: string, href?: string }[]} [statusLinks]
 * @property {{ name: string, path: string, text: string }[]} architecture  Ordered components; path is repo-relative.
 * @property {string[]} run         Shell lines.
 * @property {string} runNote
 * @property {string[]} tests       Artifact ids of test-run (or unavailable) artifacts.
 * @property {string[]} benchmarks  Artifact ids of profile (or unavailable) artifacts.
 * @property {string} quickDemo
 * @property {TourStep[]} tour
 */

/** One-line description per pipeline stage, for the landing page. */
export const STAGE_TEXT = {
  source: "JSON Schema constraints as schema-dialect IR.",
  diagnostics: "Verifier errors with file, line and column.",
  mlir: "Custom dialects lowered to the LLVM dialect.",
  passes: "IR snapshots and structural diffs, per pass.",
  debugging: "Generated code mapped back to ops and SSA values in LLDB.",
  profiling: "Compile time per pass, plus runtime numbers where they exist.",
};

/** @type {Record<string, ProjectContent>} */
export const PROJECTS = {
  "schema-mlir": {
    summary:
      "JSON Schema constraints as an MLIR dialect, optimized as IR and lowered to native code.",
    purpose: [
      "json-schema-mlir represents JSON Schema validation rules as operations in a `schema` dialect. Constraints are optimized as IR (subsumption, fusion, removing redundant checks) before being lowered to arith/scf/math and the LLVM dialect.",
      "At the pinned commit, the entry point is `schema-opt` on `.mlir` input. The JSON-to-IR front end shown in the upstream pipeline diagram is not in the tree yet.",
    ],
    architecture: [
      {
        name: "schema dialect",
        path: "include/Schema/SchemaOps.td",
        text: "ODS definitions for validate_string, validate_number and struct, with verifiers.",
      },
      {
        name: "--schema-canonicalize",
        path: "lib/Schema/SchemaCanonicalizerPass.cpp",
        text: "Constraint-lattice subsumption and conjunction fusion.",
      },
      {
        name: "--lower-schema-to-std",
        path: "lib/Schema/LowerToStandard.cpp",
        text: "Type-guarded lowering to arith/scf/math plus runtime ABI calls.",
      },
      {
        name: "--schema-to-llvm-pipeline",
        path: "tools/schema-opt/schema-opt.cpp",
        text: "Registers the pipelines that continue to the LLVM dialect.",
      },
    ],
    run: [
      "git clone https://github.com/joepothiboot/json-schema-mlir && cd json-schema-mlir",
      "git checkout {commit}",
      'MLIR_INSTALL="$(brew --prefix llvm)" ./build.sh   # configures, builds schema-opt, runs check-schema',
      "./build/bin/schema-opt test/Dialect/Schema/schema-canonicalize.mlir --schema-canonicalize --split-input-file",
    ],
    runNote:
      "Needs LLVM/MLIR with FileCheck and lit (captured with the toolchain listed below). Clone into a path without spaces, because lit's %s substitution breaks on them.",
    tests: ["schema-tests"],
    benchmarks: ["schema-pass-timing"],
    quickDemo:
      "Follow one real test function from the dialect, through canonicalization and lowering, to the LLVM dialect, plus one verifier diagnostic.",
    tour: [
      {
        title: "Start from a real test input",
        text: "Three validate_string checks on the same value, combined with arith.andi. This function comes verbatim from the repository's canonicalization tests.",
        artifacts: ["schema-input"],
      },
      {
        title: "Diagnostics point at the source",
        text: "A contradictory constraint (max_length below min_length) is rejected by the op verifier. The error carries file, line and column. This input file was written for the lab; the diagnostic is schema-opt's real output.",
        artifacts: ["schema-bad-input", "schema-verifier-diagnostic"],
      },
      {
        title: "Every pass in the pipeline",
        text: "--schema-to-std-pipeline runs the passes below. Rows marked unchanged left the IR exactly as they found it.",
        timeline: "schema-pass-",
      },
      {
        title: "Canonicalization fuses the constraint tree",
        text: "The three checks become one validate_string carrying the meet of the constraints: min_length 5 subsumes min_length 2. Both andi ops disappear.",
        artifacts: [
          "schema-ir-0-parsed",
          "schema-ir-2-schemacanonicalizerpass",
        ],
      },
      {
        title: "Lowering guards on the runtime type tag",
        text: "The validator becomes an scf.if on the JSON kind, so a length check never runs on a non-string. String length and regex matching go through the runtime ABI.",
        artifacts: ["schema-ir-7-symboldcepass"],
      },
      {
        title: "Down to the LLVM dialect",
        text: "--schema-to-llvm-pipeline continues through control flow and LLVM conversion.",
        artifacts: ["schema-llvm"],
      },
    ],
  },

  vizmlir: {
    summary:
      "Browser-only MLIR graph viewer and structural diff, with a Rust parser compiled to WebAssembly.",
    purpose: [
      "VizMLIR parses MLIR in the browser with a Rust parser compiled to WebAssembly, draws the operation graph on a canvas, and diffs two IR snapshots with SSA names normalized. No backend is involved.",
      "In this lab it is the pass-inspection step: the IR captured from json-schema-mlir and nano-dsp-mlir is run through VizMLIR's own WASM parser and diff module at the pinned commit.",
    ],
    architecture: [
      {
        name: "Lexer and parser (Rust)",
        path: "wasm/src/parser/lexer.rs",
        text: "Tokenizes and parses MLIR into an arena-allocated AST with interned strings.",
      },
      {
        name: "WASM ABI",
        path: "wasm/src/abi.rs",
        text: "A fixed shared-memory header (ABI v3) exposing nodes, edges, layout and diagnostics.",
      },
      {
        name: "JS bridge",
        path: "src/wasm/bridge.js",
        text: "Reads the header through typed-array views; no copying or JSON.",
      },
      {
        name: "Diff and renderer",
        path: "src/diff.js",
        text: "SSA-normalized structural diff; canvas graph renderer.",
      },
    ],
    run: [
      "git clone https://github.com/joepothiboot/vizmlir && cd vizmlir",
      "git checkout {commit}",
      "rustup target add wasm32-unknown-unknown",
      "npm ci && npm run dev",
    ],
    runNote:
      "Needs Node 20+ and Rust with the wasm32-unknown-unknown target. wasm-opt (binaryen) is optional.",
    tests: ["viz-tests"],
    benchmarks: [],
    quickDemo:
      "Diff real compiler passes from the other projects with VizMLIR's own WASM parser, then open the pinned build yourself.",
    tour: [
      {
        title: "Diff json-schema-mlir's canonicalization",
        text: "VizMLIR matches operations by kind and SSA-normalized label. The fused validate_string keeps its op name, so it matches. The two absorbed checks and both andi ops are reported as removed.",
        artifacts: ["viz-schema-canonicalize-diff"],
      },
      {
        title: "A real finding: function arguments",
        text: "In the graph summaries above, VizMLIR reports each use of %arg0 as an undefined SSA value. At this commit the parser does not appear to register function block arguments as definitions. This is captured output, shown as-is, and a candidate upstream fix.",
      },
      {
        title: "Diff the lowering to standard dialects",
        text: "The larger diff after --lower-schema-to-std shows the runtime ABI declarations and the scf.if guard being introduced.",
        artifacts: ["viz-schema-lowering-diff"],
      },
      {
        title: "Diff nano-dsp-mlir's dsp → linalg conversion",
        text: "The same diff applied to the other compiler: dsp ops become linalg.generic with affine maps.",
        artifacts: ["viz-nano-linalg-diff"],
      },
    ],
  },

  "mlir-lldb-tools": {
    summary:
      "LLDB commands, printers and a DAP server keyed by MLIR ops and SSA values (not yet run end to end).",
    purpose: [
      "mlir-lldb-tools aims to let LLDB work in terms of MLIR ops and SSA values for a small schema compiler (schemac): breakpoints set by source field, pretty-printers that read real memory, and a narrow DAP server for VS Code.",
      "Its central design rule is that a lowering pass may enrich location information but never erase it. Every metadata layer is tagged real or synthetic, so an illustration cannot be passed off as tool output.",
    ],
    status:
      "Upstream states this project has not been built or run end to end. At the pinned commit the schemac front end rejects its own example, upstream CI failed, and this capture found 1 toolchain-free test passing while 2 test modules could not be collected without an importable LLDB.",
    statusLinks: [
      {
        text: "Upstream CI run at the pinned commit (failed)",
        href: "https://github.com/joepothiboot/mlir-lldb-tools/actions/runs/36238464285",
      },
    ],
    architecture: [
      {
        name: "schemac",
        path: "schemac/cli.py",
        text: "Lexer, parser, AST, folding/DCE passes with provenance; emits C++, MLIR and side-car metadata.",
      },
      {
        name: "toy_schema dialect",
        path: "mlir/include/ToySchema/ToySchemaOps.td",
        text: "Out-of-tree dialect and schemac-opt (needs an MLIR install).",
      },
      {
        name: "Runtime",
        path: "runtime/include/mlir_rt.h",
        text: "Standard-layout C++ structs with a magic field written last.",
      },
      {
        name: "LLDB layer",
        path: "src/mlir_lldb_tools/commands/breakfield.py",
        text: "Commands and printers built on the SB API; addresses come from DWARF.",
      },
      {
        name: "DAP server",
        path: "src/mlir_lldb_tools/dap/server.py",
        text: "A hand-written, deliberately narrow debug adapter.",
      },
    ],
    run: [
      "git clone https://github.com/joepothiboot/mlir-lldb-tools && cd mlir-lldb-tools",
      "git checkout {commit}",
      "python3 -m venv .venv && . .venv/bin/activate && pip install -e '.[dev]'",
      "PYTHONPATH=.:src pytest -m 'not needs_lldb and not needs_mlir'",
    ],
    runNote:
      "PYTHONPATH is needed because the editable install does not expose the top-level schemac package at this commit. LLDB's Python module must match your interpreter's minor version.",
    tests: ["lldb-tests"],
    benchmarks: [],
    quickDemo:
      "See the source language, what the front end actually does with it today, the generated C++ the debugger maps back to, and what is still missing.",
    tour: [
      {
        title: "The source language",
        text: "A schema with a string, an integer range, a tensor and a DSP buffer. These are the fields the debugger is meant to break on by name.",
        artifacts: ["lldb-schema-source"],
      },
      {
        title: "What the front end does at this commit",
        text: "Running schemac on that example stops with a parse error. The message has no line or column, which is the kind of location loss this project exists to prevent.",
        artifacts: ["lldb-frontend-diagnostic"],
      },
      {
        title: "Generated code the debugger maps back to",
        text: "Each __mlir_vN local corresponds to SSA value %N, and the metadata maps op → generated line. This file is checked into the repo. It could not be regenerated here because of the parse error above.",
        artifacts: ["lldb-generated-cpp"],
      },
      {
        title: "Tests and debug values",
        text: "The toolchain-free tier is the only one that runs without LLDB and MLIR. No debugger session has been captured, so no debug values are shown.",
        artifacts: ["lldb-tests", "lldb-debug-session"],
      },
    ],
  },

  "nano-dsp-mlir": {
    summary:
      "A small image/math DSL dialect lowered to linalg and LLVM, with differential execution tests.",
    purpose: [
      "nano-dsp-mlir defines a `dsp` dialect (add, relu, matmul, conv2d) with shape verifiers, and lowers it to linalg.generic. From there the tests lower through stock MLIR passes to LLVM and execute with mlir-runner to check numeric results.",
      "At v0.1.0 (plus one README commit) the tree contains the dialect, the dsp → linalg conversion and the tests. The upstream README also describes pieces not in the tree yet: transform-dialect schedules, -nanodsp-optimize, the Python DSL, sweep scripts and docs/.",
    ],
    architecture: [
      {
        name: "dsp dialect",
        path: "include/nanodsp/Dialect/DSP/IR/DSPOps.td",
        text: "Value-semantics ops on static f32 tensors, with verifiers.",
      },
      {
        name: "-convert-dsp-to-linalg",
        path: "lib/Conversion/DSPToLinalg/DSPToLinalg.cpp",
        text: "Rewrites each op to linalg.generic in destination-passing style.",
      },
      {
        name: "Stock lowering (test oracle)",
        path: "test/lit.cfg.py",
        text: "Upstream bufferization and LLVM conversion, used only so the tests can execute.",
      },
      {
        name: "nanodsp-opt",
        path: "tools/nanodsp-opt/nanodsp-opt.cpp",
        text: "mlir-opt-style driver with the dialect and passes registered.",
      },
    ],
    run: [
      "git clone https://github.com/joepothiboot/nano-dsp-mlir && cd nano-dsp-mlir",
      "git checkout {commit}",
      "./test.sh   # finds Homebrew LLVM/MLIR or $MLIR_DIR, builds, runs check-nanodsp",
    ],
    runNote:
      "Needs LLVM/MLIR with mlir-runner, FileCheck and lit. Clone into a path without spaces.",
    tests: ["nano-tests"],
    benchmarks: ["nano-pass-timing", "nano-benchmark"],
    quickDemo:
      "Follow relu(conv2d(image) + bias) from the dsp dialect through 19 passes to the LLVM dialect, execute it, and see where compile time goes.",
    tour: [
      {
        title: "The program",
        text: "An integration test: a 3×3 box blur over a 4×4 image, plus a bias, through relu. The CHECK lines state the expected output.",
        artifacts: ["nano-input"],
      },
      {
        title: "Verifier diagnostics",
        text: "The invalid-op tests, run without -verify-diagnostics, so the raw errors and their locations are visible.",
        artifacts: ["nano-verifier-diagnostics"],
      },
      {
        title: "dsp → linalg",
        text: "The only pass this project owns. conv2d, add and relu become linalg.generic ops with explicit indexing maps.",
        artifacts: ["nano-ir-1-convertdsptolinalg"],
      },
      {
        title: "Every pass to the LLVM dialect",
        text: "The stock lowering chain the tests use. Unchanged rows are passes that found nothing to do.",
        timeline: "nano-pass-",
      },
      {
        title: "Execute and check",
        text: "The lowered module run with mlir-runner. The printed memref is compared with the test's CHECK lines.",
        artifacts: ["nano-execution"],
      },
      {
        title: "Profiling",
        text: "Compile-time wall clock per pass, from one run on the capture host. It shows relative cost, not a benchmark. Runtime kernel numbers do not exist yet.",
        artifacts: ["nano-pass-timing", "nano-benchmark"],
      },
    ],
  },
};
