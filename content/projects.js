/**
 * @typedef {object} TourStep
 * @property {string} title
 * @property {string} text
 * @property {string[]} [artifacts]
 * @property {string} [timeline]
 * @property {boolean} [trace]
 */

/**
 * @typedef {object} ProjectContent
 * @property {string} summary
 * @property {string[]} purpose
 * @property {string} [status]
 * @property {{ text: string, href?: string }[]} [statusLinks]
 * @property {{ name: string, path: string, text: string }[]} architecture
 * @property {string[]} run
 * @property {string} runNote
 * @property {string[]} tests
 * @property {string[]} benchmarks
 * @property {string} quickDemo
 * @property {string} thumb
 * @property {string} [trace]
 * @property {string[]} [traceIntro]
 * @property {TourStep[]} tour
 */

export const STAGE_TEXT = {
  source: "JSON Schema constraints as schema-dialect IR.",
  diagnostics: "Verifier errors with file, line and column.",
  mlir: "Custom dialects lowered to the LLVM dialect.",
  passes: "IR snapshots and structural diffs, per pass.",
  profiling: "Compile time per pass, plus runtime numbers where they exist.",
};

/** @type {Record<string, ProjectContent>} */
export const PROJECTS = {
  "schema-mlir": {
    summary:
      "JSON Schema constraints as an MLIR dialect, optimized as IR and lowered to native code.",
    purpose: [
      "json-schema-mlir represents JSON Schema validation rules as operations in a `schema` dialect. Constraints are optimized as IR (subsumption, fusion, removing redundant checks) before being lowered to arith/scf/math and the LLVM dialect.",
      "The same constraint lattice also exists as a Mojo library (`mojo/schema/`), with the canonicalizer's subsumption and meet rules and the lowered validation semantics. Its tests check that merging two constraints never changes which values are accepted.",
      "At the pinned commit the front end is in the tree: `schema-translate --import-json-schema` lexes and parses a JSON Schema file, builds an AST with source ranges, and imports it as schema-dialect IR. `schema-opt` then takes `.mlir` input through the passes. The tour starts from the front end, using the Person example; the later steps use the repository's own canonicalization test inputs.",
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
      {
        name: "Mojo lattice library",
        path: "mojo/schema/lattice.mojo",
        text: "StringConstraints and NumberConstraints with subsumes, meet and validate, following the same rules as the two passes above.",
      },
    ],
    run: [
      "git clone https://github.com/joepothiboot/json-schema-mlir && cd json-schema-mlir",
      "git checkout {commit}",
      'MLIR_INSTALL="$(brew --prefix llvm)" ./build.sh   # configures, builds schema-opt, runs check-schema',
      "./build/bin/schema-opt test/Dialect/Schema/schema-canonicalize.mlir --schema-canonicalize --split-input-file",
      "pixi run test-mojo   # Mojo lattice tests; pixi installs the pinned Mojo",
    ],
    runNote:
      "Needs LLVM/MLIR with FileCheck and lit (captured with the toolchain listed below). Clone into a path without spaces, because lit's %s substitution breaks on them.",
    tests: ["schema-tests", "schema-mojo-tests"],
    benchmarks: ["schema-pass-timing"],
    quickDemo:
      "Follow one real test function from the dialect, through canonicalization and lowering, to the LLVM dialect, plus one verifier diagnostic.",
    thumb: "schema-input",
    trace: "schema-trace",
    traceIntro: [
      "`schema-translate --emit-trace` writes what its front end saw and did as one JSON file: the source, the lexer's tokens, the AST with byte ranges, and the IR after import and after `--schema-canonicalize`, with each op tied back to the AST nodes it came from. This viewer draws that file and nothing else; the compiler does not run in your browser.",
      "The Person schema's `age` combines three `allOf` branches. In the IR pane they are separate checks after import, and one `validate_number` after canonicalization. Select that one, and every imported op it absorbed lights up, along with the six JSON keywords it came from.",
    ],
    tour: [
      {
        title: "Follow one schema through the front end",
        text: "examples/person/person.schema.json goes through the lexer, the parser and the importer. The trace viewer links the JSON source, its tokens, the AST and the IR, and shows canonicalization fusing the three allOf branches into one validate_number.",
        trace: true,
      },
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
      {
        title: "The same lattice in Mojo",
        text: "The Mojo library repeats each canonicalization test case, then checks a grid of constraint pairs and values, including NaN and infinity: whenever two constraints merge, the merged one accepts exactly what both accepted.",
        artifacts: ["schema-mojo-tests"],
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
      "Diff real compiler passes from the other projects with VizMLIR's own WASM parser, then open the app and try it yourself.",
    thumb: "viz-nano-linalg-diff",
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

  "nano-dsp-mlir": {
    summary:
      "A small image/math DSL dialect lowered to linalg and LLVM, with differential execution tests.",
    purpose: [
      "nano-dsp-mlir defines a `dsp` dialect (add, relu, matmul, conv2d) with shape verifiers, and lowers it to linalg.generic. From there the tests lower through stock MLIR passes to LLVM and execute with mlir-runner to check numeric results.",
      "Each dsp op is also implemented as a SIMD Mojo kernel (`mojo/nanodsp/`) and as a plain C++ loop nest (`reference/`). All three implementations are tested against the same expected values, and the Mojo kernels are benchmarked. The upstream README also describes pieces not in the tree yet: transform-dialect schedules, -nanodsp-optimize, the Python DSL and sweep scripts.",
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
      {
        name: "Mojo kernels",
        path: "mojo/nanodsp/kernels.mojo",
        text: "Generic SIMD add, relu, matmul and conv2d with the dialect's semantics; the width comes from the target at compile time.",
      },
      {
        name: "C++ reference",
        path: "reference/nanodsp_ref.h",
        text: "Scalar loop nests used as an independent check on both of the above.",
      },
    ],
    run: [
      "git clone https://github.com/joepothiboot/nano-dsp-mlir && cd nano-dsp-mlir",
      "git checkout {commit}",
      "./test.sh   # finds Homebrew LLVM/MLIR or $MLIR_DIR, builds, runs check-nanodsp",
      "pixi run test-mojo && pixi run test-reference && pixi run bench",
    ],
    runNote:
      "Needs LLVM/MLIR with mlir-runner, FileCheck and lit. Clone into a path without spaces. The Mojo and C++ steps need only pixi, which installs the pinned Mojo.",
    tests: ["nano-tests", "nano-mojo-tests", "nano-reference-tests"],
    benchmarks: ["nano-pass-timing", "nano-benchmark", "nano-gpu-results"],
    quickDemo:
      "Follow relu(conv2d(image) + bias) from the dsp dialect through 19 passes to the LLVM dialect, execute it, and see where compile time goes.",
    thumb: "nano-pass-timing",
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
        title: "The same ops in Mojo and C++",
        text: "The Mojo kernels and the C++ reference are checked against the same expected values as the MLIR tests above. The Mojo tests also compare against a naive loop nest on odd sizes, so the code after each SIMD chunk runs too.",
        artifacts: ["nano-mojo-tests", "nano-reference-tests"],
      },
      {
        title: "Profiling",
        text: "Compile-time wall clock per pass, from one run on the capture host. It shows relative cost, not a benchmark. The kernel numbers are the SIMD Mojo kernels on one core. A benchmark of the tiled MLIR kernels against them is not done yet.",
        artifacts: ["nano-pass-timing", "nano-benchmark"],
      },
    ],
  },
};
