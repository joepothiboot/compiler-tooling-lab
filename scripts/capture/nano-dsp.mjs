import fs from "node:fs";
import path from "node:path";
import {
  parseDiagnostics,
  parseIRDumps,
  parsePassFailLines,
  parseTiming,
} from "../../src/parse.js";
import {
  LLVM,
  NO_PIXI,
  display,
  litRun,
  mojoTestRun,
  parsedInput,
  passArtifacts,
  pixiTask,
  relativize,
  run,
  srcDir,
  tool,
  unavailable,
  withLog,
} from "./common.mjs";

/** @typedef {import("../../src/model.js").Artifact} Artifact */

const NANO_STOCK_LOWERING = [
  "-one-shot-bufferize=bufferize-function-boundaries",
  "-buffer-deallocation-pipeline",
  "-convert-linalg-to-loops",
  "-convert-scf-to-cf",
  "-expand-strided-metadata",
  "-lower-affine",
  "-convert-arith-to-llvm",
  "-finalize-memref-to-llvm",
  "-convert-func-to-llvm",
  "-convert-cf-to-llvm",
  "-reconcile-unrealized-casts",
];

/** @returns {Artifact[]} */
function captureNanoKernels(/** @type {string} */ dir) {
  const mojo = mojoTestRun(dir, "nano-mojo-tests", "Mojo kernel tests");
  const ref = pixiTask(dir, "test-reference");
  const bench = pixiTask(dir, "bench");

  if (!ref || !bench) {
    return [
      mojo,
      unavailable(
        "nano-reference-tests",
        "test-run",
        "C++ reference tests",
        NO_PIXI,
      ),
      unavailable(
        "nano-benchmark",
        "execution",
        "Mojo kernel throughput",
        NO_PIXI,
      ),
    ];
  }

  return [
    mojo,
    /** @type {Artifact} */ ({
      id: "nano-reference-tests",
      kind: "test-run",
      title: "C++ reference tests",
      runner: "c++",
      ...withLog(parsePassFailLines(ref.stdout + ref.stderr)),
      provenance: { mode: "captured", command: "pixi run test-reference" },
    }),
    /** @type {Artifact} */ ({
      id: "nano-benchmark",
      kind: "execution",
      title: "Mojo kernel throughput (untiled, one core, best of 3-5 runs)",
      exitCode: bench.code,
      stdout: bench.stdout
        .split("\n")
        .filter((l) => /^(matmul|conv2d) /.test(l))
        .join("\n"),
      provenance: { mode: "captured", command: "pixi run bench" },
    }),
  ];
}

/** @returns {Artifact} */
function captureGpuResults(/** @type {string} */ dir) {
  const rel = "benchmarks/results";
  const resultsDir = path.join(dir, rel);
  const title = "GPU kernel throughput (committed results)";

  if (!fs.existsSync(resultsDir)) {
    return unavailable(
      "nano-gpu-results",
      "execution",
      title,
      `${rel} does not exist at the pinned commit.`,
    );
  }

  const files = fs
    .readdirSync(resultsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const sections = files.map((f) => {
    const { context, benchmarks } = JSON.parse(
      fs.readFileSync(path.join(resultsDir, f), "utf8"),
    );

    const rows = benchmarks.map(
      (/** @type {any} */ b) =>
        `${b.op} ${b.shape} ${b.impl}: ${b.rate.toFixed(1)} ${b.rate_unit}`,
    );

    return [`# ${context.device} (${f})`, ...rows].join("\n");
  });

  return /** @type {Artifact} */ ({
    id: "nano-gpu-results",
    kind: "execution",
    title,
    exitCode: 0,
    stdout: sections.join("\n\n"),
    provenance: { mode: "static", path: rel },
  });
}

/** @returns {Artifact[]} */
export function captureNanoDsp() {
  const dir = srcDir("nano-dsp-mlir");
  const opt = path.join(dir, "build/bin/nanodsp-opt");

  if (!fs.existsSync(opt)) {
    const reason =
      "nanodsp-opt did not build at the pinned commit; see the capture job log.";

    return [
      unavailable("nano-tests", "test-run", "lit regression suite", reason),
      unavailable("nano-input", "ir-snapshot", "Input IR", reason),
      ...captureNanoKernels(dir),
      captureGpuResults(dir),
    ];
  }

  const litCfg = fs.readFileSync(path.join(dir, "test/lit.cfg.py"), "utf8");

  for (const flag of NANO_STOCK_LOWERING) {
    if (!litCfg.includes(flag.split("=")[0])) {
      throw new Error(
        `lit.cfg.py no longer uses ${flag}; update NANO_STOCK_LOWERING`,
      );
    }
  }

  /** @type {Artifact[]} */
  const out = [
    litRun(dir, "nano-tests", "lit regression suite (check-nanodsp)"),
  ];

  const rel = "test/Integration/DSPToLinalg/pipeline.mlir";
  const input = path.join(dir, rel);
  const inputText = fs.readFileSync(input, "utf8").trim();

  out.push({
    id: "nano-input",
    kind: "ir-snapshot",
    title: "relu(conv2d(image) + bias) integration test",
    stage: "dsp",
    text: inputText,
    location: { file: rel, line: 1 },
    provenance: { mode: "static", path: rel },
  });

  const printed = parsedInput(opt, [rel], "nano", "nanodsp-opt", dir);
  out.push(printed.artifact);

  const passes = ["-convert-dsp-to-linalg", ...NANO_STOCK_LOWERING];

  const dumpArgs = [
    rel,
    ...passes,
    "--mlir-print-ir-after-all",
    "--mlir-print-ir-module-scope",
    "--mlir-disable-threading",
    "-o",
    "/dev/null",
  ];

  const dumps = run(opt, dumpArgs, { cwd: dir });

  if (dumps.code !== 0) {
    throw new Error(`nanodsp-opt pipeline failed:\n${dumps.stderr}`);
  }

  out.push(
    ...passArtifacts(
      "nano",
      printed.artifact.id,
      printed.text,
      parseIRDumps(dumps.stderr),
      display("nanodsp-opt", dumpArgs),
    ),
  );

  const lowered = run(opt, [rel, ...passes], { cwd: dir });

  const libs = ["libmlir_runner_utils", "libmlir_c_runner_utils"].map((l) =>
    path.join(
      LLVM,
      "lib",
      `${l}${process.platform === "darwin" ? ".dylib" : ".so"}`,
    ),
  );

  const runnerArgs = [
    "-e",
    "main",
    "--entry-point-result=void",
    ...libs.map((l) => `--shared-libs=${l}`),
  ];

  const exec = run(tool("mlir-runner"), runnerArgs, { input: lowered.stdout });

  out.push({
    id: "nano-execution",
    kind: "execution",
    title: "Executed with mlir-runner",
    exitCode: exec.code,
    stdout: relativize(exec.stdout.trim() || exec.stderr.trim()),
    expected: [...inputText.matchAll(/^\/\/ CHECK: (.*)$/gm)].map((m) => m[1]),
    provenance: {
      mode: "captured",
      command: `${display("nanodsp-opt", [rel, ...passes])} | ${display("mlir-runner", runnerArgs)}`,
    },
  });

  const invalidRel = "test/Dialect/DSP/invalid.mlir";
  const diagArgs = [invalidRel, "-split-input-file", "-o", "/dev/null"];
  const diag = run(opt, diagArgs, { cwd: dir });

  out.push({
    id: "nano-verifier-diagnostics",
    kind: "diagnostic",
    title: "Verifier diagnostics for the invalid-op tests",
    tool: "nanodsp-opt",
    exitCode: diag.code,
    entries: parseDiagnostics(relativize(diag.stderr)),
    provenance: { mode: "captured", command: display("nanodsp-opt", diagArgs) },
  });

  const timeArgs = [rel, ...passes, "--mlir-timing", "-o", "/dev/null"];
  const t = run(opt, timeArgs, { cwd: dir });

  out.push({
    id: "nano-pass-timing",
    kind: "profile",
    title: "Compile-time pass timing",
    metric: "wall time",
    unit: "s",
    ...parseTiming(t.stderr),
    provenance: { mode: "captured", command: display("nanodsp-opt", timeArgs) },
  });

  out.push(...captureNanoKernels(dir), captureGpuResults(dir));

  return out;
}
