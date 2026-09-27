#!/usr/bin/env node
// Runs each project's real tools at its pinned commit and writes artifacts/<id>.json.
// Invoked by scripts/capture.sh after it has cloned and built the projects.
//
//   node scripts/capture.mjs --work <dir> --llvm <prefix> [--project <id>]
//
// Nothing here synthesises output: every artifact is tool output (`captured`),
// a verbatim file (`static`), or an explicit gap with a reason (`unavailable`).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateArtifactFile } from "../src/model.js";
import {
  parseDiagnostics,
  parseIRDumps,
  parseLit,
  parseTiming,
} from "../src/parse.js";

/** @typedef {import("../src/model.js").Artifact} Artifact */
/** @typedef {import("../src/model.js").Manifest} Manifest */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((/** @type {string[][]} */ acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]]);
    return acc;
  }, []),
);
if (!args.work || !args.llvm) {
  console.error(
    "usage: capture.mjs --work <dir> --llvm <prefix> [--project <id>]",
  );
  process.exit(2);
}
const WORK = path.resolve(args.work);
const LLVM = path.resolve(args.llvm);
const TMP = path.join(WORK, "tmp");
fs.mkdirSync(TMP, { recursive: true });

/** @type {Manifest} */
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"),
);
const srcDir = (/** @type {string} */ id) => path.join(WORK, "src", id);

// ---------------------------------------------------------------------------
// Process helpers

/**
 * @param {string} cmd
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: Record<string, string>, input?: string }} [opts]
 */
function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: (r.stderr ?? "") + (r.error ? String(r.error.message) : ""),
  };
}

/** Rewrites absolute paths to repo-relative ones so artifacts are host-independent. */
function relativize(/** @type {string} */ text) {
  let out = text;
  for (const p of manifest.projects) {
    out = out
      .split(`${srcDir(p.id)}/build/bin/`)
      .join("")
      .split(`${srcDir(p.id)}/`)
      .join("");
  }
  return out
    .split(`${ROOT}/`)
    .join("lab:")
    .split(`${TMP}/`)
    .join("")
    .split(`${LLVM}/bin/`)
    .join("")
    .split(`${LLVM}/lib/`)
    .join("$LLVM/lib/")
    .split(`${WORK}/`)
    .join("");
}

const shellWord = (/** @type {string} */ w) =>
  /^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`;
const display = (/** @type {string} */ cmd, /** @type {string[]} */ argv) =>
  relativize([cmd, ...argv].map(shellWord).join(" "));

function tool(/** @type {string} */ name) {
  const inLlvm = path.join(LLVM, "bin", name);
  return fs.existsSync(inLlvm) ? inLlvm : name;
}

/** @template {{ log: string }} T @param {T} r @returns {T} */
const withLog = (r) => ({ ...r, log: relativize(r.log) });

/** @returns {Artifact} */
function unavailable(
  /** @type {string} */ id,
  /** @type {any} */ kind,
  /** @type {string} */ title,
  /** @type {string} */ reason,
) {
  return /** @type {Artifact} */ ({
    id,
    kind,
    title,
    provenance: { mode: "unavailable", reason },
  });
}

const stageOf = (/** @type {string} */ ir) =>
  /\bllvm\./.test(ir)
    ? "llvm"
    : /\bdsp\./.test(ir)
      ? "dsp"
      : /\bschema\.validate|schema\.struct/.test(ir)
        ? "schema"
        : /\blinalg\./.test(ir)
          ? "linalg"
          : "arith/scf/memref";

const slug = (/** @type {string} */ s) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Turns per-pass IR dumps into ir-snapshot + pass-event artifacts. Unchanged
 * passes are recorded as events that point at the previous snapshot.
 * @param {string} prefix @param {string} inputId @param {string} inputText
 * @param {{ pass: string, text: string }[]} dumps @param {string} command
 */
function passArtifacts(prefix, inputId, inputText, dumps, command) {
  /** @type {Artifact[]} */
  const out = [];
  let prevId = inputId;
  let prevText = inputText;
  dumps.forEach((d, i) => {
    const changed = d.text !== prevText;
    let afterId = prevId;
    if (changed) {
      afterId = `${prefix}-ir-${i + 1}-${slug(d.pass)}`;
      out.push({
        id: afterId,
        kind: "ir-snapshot",
        title: `IR after ${d.pass}`,
        stage: stageOf(d.text),
        text: d.text,
        provenance: { mode: "captured", command },
      });
    }
    out.push({
      id: `${prefix}-pass-${i + 1}-${slug(d.pass)}`,
      kind: "pass-event",
      title: d.pass,
      pass: d.pass,
      index: i + 1,
      changed,
      before: prevId,
      after: afterId,
      provenance: { mode: "captured", command },
    });
    prevId = afterId;
    prevText = d.text;
  });
  return out;
}

/**
 * The input as the tool itself parses and prints it (no passes). Pass chains
 * start here so the first diff compares printed IR with printed IR.
 * @param {string} opt @param {string[]} argv @param {string} prefix @param {string} name @param {string} [cwd]
 */
function parsedInput(opt, argv, prefix, name, cwd) {
  const r = run(opt, argv, { cwd });
  if (r.code !== 0)
    throw new Error(`${name} could not parse its input:\n${r.stderr}`);
  const text = r.stdout.trim();
  /** @type {Artifact} */
  const artifact = {
    id: `${prefix}-ir-0-parsed`,
    kind: "ir-snapshot",
    title: `Input as parsed and printed by ${name}`,
    stage: stageOf(text),
    text,
    provenance: { mode: "captured", command: display(name, argv) },
  };
  return { artifact, text };
}

/** @param {string} dir @param {string} rel @param {string} id @param {string} title @param {string} language */
function staticSource(dir, rel, id, title, language) {
  return /** @type {Artifact} */ ({
    id,
    kind: "source",
    title,
    language,
    text: fs.readFileSync(path.join(dir, rel), "utf8"),
    location: { file: rel, line: 1 },
    provenance: { mode: "static", path: rel },
  });
}

function litRun(
  /** @type {string} */ dir,
  /** @type {string} */ id,
  /** @type {string} */ title,
) {
  const lit = fs.existsSync(path.join(LLVM, "bin", "llvm-lit"))
    ? path.join(LLVM, "bin", "llvm-lit")
    : "lit";
  const r = run(lit, ["-v", "build/test"], {
    cwd: dir,
    env: { PATH: `${LLVM}/bin:${process.env.PATH}` },
  });
  return /** @type {Artifact} */ ({
    id,
    kind: "test-run",
    title,
    runner: "lit",
    ...withLog(parseLit(r.stdout + r.stderr)),
    provenance: { mode: "captured", command: "lit -v build/test" },
  });
}

// ---------------------------------------------------------------------------
// Per-project captures

/** @returns {Artifact[]} */
function captureSchemaMlir() {
  const dir = srcDir("schema-mlir");
  const opt = path.join(dir, "build/bin/schema-opt");
  if (!fs.existsSync(opt)) {
    const reason =
      "schema-opt did not build at the pinned commit; see the capture job log.";
    return [
      unavailable("schema-tests", "test-run", "lit regression suite", reason),
      unavailable("schema-input", "ir-snapshot", "Input IR", reason),
    ];
  }
  /** @type {Artifact[]} */
  const out = [
    litRun(dir, "schema-tests", "lit regression suite (check-schema)"),
  ];

  // Input: one function from the repo's own canonicalization test.
  const rel = "test/Dialect/Schema/schema-canonicalize.mlir";
  const lines = fs.readFileSync(path.join(dir, rel), "utf8").split("\n");
  const start = lines.findIndex((l) =>
    l.startsWith("func.func @fuse_constraint_tree"),
  );
  const end = lines.indexOf("}", start);
  if (start < 0 || end < 0)
    throw new Error(`${rel}: @fuse_constraint_tree not found`);
  const inputText = lines.slice(start, end + 1).join("\n");
  const input = path.join(TMP, "fuse_constraint_tree.mlir");
  fs.writeFileSync(input, inputText + "\n");
  out.push({
    id: "schema-input",
    kind: "ir-snapshot",
    title: "@fuse_constraint_tree (from the canonicalization tests)",
    stage: "schema",
    text: inputText,
    location: { file: rel, line: start + 1 },
    provenance: { mode: "static", path: `${rel}#L${start + 1}-L${end + 1}` },
  });

  const printed = parsedInput(opt, [input], "schema", "schema-opt");
  out.push(printed.artifact);

  const pipeArgs = [
    input,
    "--schema-to-std-pipeline",
    "--mlir-print-ir-after-all",
    "--mlir-print-ir-module-scope",
    "--mlir-disable-threading",
    "-o",
    "/dev/null",
  ];
  const pipe = run(opt, pipeArgs);
  if (pipe.code !== 0)
    throw new Error(`schema-opt pipeline failed:\n${pipe.stderr}`);
  out.push(
    ...passArtifacts(
      "schema",
      printed.artifact.id,
      printed.text,
      parseIRDumps(pipe.stderr),
      display("schema-opt", pipeArgs.slice(0)),
    ),
  );

  const llvmArgs = [input, "--schema-to-llvm-pipeline"];
  const llvm = run(opt, llvmArgs);
  if (llvm.code !== 0)
    throw new Error(`schema-opt llvm pipeline failed:\n${llvm.stderr}`);
  out.push({
    id: "schema-llvm",
    kind: "ir-snapshot",
    title: "LLVM dialect output",
    stage: "llvm",
    text: llvm.stdout.trim(),
    provenance: { mode: "captured", command: display("schema-opt", llvmArgs) },
  });

  const badRel = "inputs/schema-mlir/contradictory-bounds.mlir";
  const bad = path.join(ROOT, badRel);
  out.push({
    id: "schema-bad-input",
    kind: "source",
    title: "Contradictory constraint (input written for this lab)",
    language: "mlir",
    text: fs.readFileSync(bad, "utf8"),
    location: { file: `lab:${badRel}`, line: 1 },
    provenance: { mode: "static", path: `lab:${badRel}` },
  });
  const diag = run(opt, [bad]);
  out.push({
    id: "schema-verifier-diagnostic",
    kind: "diagnostic",
    title: "Verifier diagnostic",
    tool: "schema-opt",
    exitCode: diag.code,
    entries: parseDiagnostics(relativize(diag.stderr)),
    provenance: { mode: "captured", command: display("schema-opt", [bad]) },
  });

  const timeArgs = [
    input,
    "--schema-to-std-pipeline",
    "--mlir-timing",
    "-o",
    "/dev/null",
  ];
  const t = run(opt, timeArgs);
  out.push({
    id: "schema-pass-timing",
    kind: "profile",
    title: "Compile-time pass timing",
    metric: "wall time",
    unit: "s",
    ...parseTiming(t.stderr),
    provenance: { mode: "captured", command: display("schema-opt", timeArgs) },
  });
  return out;
}

// Mirrors %stock_lower_to_llvm in nano-dsp-mlir/test/lit.cfg.py; verified against the file below.
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
function captureNanoDsp() {
  const dir = srcDir("nano-dsp-mlir");
  const opt = path.join(dir, "build/bin/nanodsp-opt");
  if (!fs.existsSync(opt)) {
    const reason =
      "nanodsp-opt did not build at the pinned commit; see the capture job log.";
    return [
      unavailable("nano-tests", "test-run", "lit regression suite", reason),
      unavailable("nano-input", "ir-snapshot", "Input IR", reason),
    ];
  }
  const litCfg = fs.readFileSync(path.join(dir, "test/lit.cfg.py"), "utf8");
  for (const flag of NANO_STOCK_LOWERING) {
    if (!litCfg.includes(flag.split("=")[0]))
      throw new Error(
        `lit.cfg.py no longer uses ${flag}; update NANO_STOCK_LOWERING`,
      );
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
  if (dumps.code !== 0)
    throw new Error(`nanodsp-opt pipeline failed:\n${dumps.stderr}`);
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

  out.push(
    unavailable(
      "nano-benchmark",
      "profile",
      "Runtime kernel benchmark",
      "benchmark/harness.cpp is a Google Benchmark starter with no build target at this commit, and upstream lists measured numbers as pending. No runtime numbers are shown until the project publishes them.",
    ),
  );
  return out;
}

/** @returns {Promise<Artifact[]>} */
async function captureVizmlir() {
  const dir = srcDir("vizmlir");
  const wasm = path.join(dir, "public/mlir_core.wasm");
  if (!fs.existsSync(wasm)) {
    const reason =
      "mlir_core.wasm did not build at the pinned commit; see the capture job log.";
    return [
      unavailable(
        "viz-schema-canonicalize-diff",
        "pass-event",
        "VizMLIR diff",
        reason,
      ),
    ];
  }
  const { MlirEngine } = await import(
    pathToFileURL(path.join(dir, "src/wasm/bridge.js")).href
  );
  const { copySnapshot, diffSnapshots } = await import(
    pathToFileURL(path.join(dir, "src/diff.js")).href
  );
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasm), {});
  const engine = new MlirEngine(instance);

  const parse = (/** @type {string} */ text) => {
    const status = engine.parse(text);
    if (status !== 0)
      throw new Error(`VizMLIR parse failed: ${engine.statusText}`);
    const snap = engine.snapshot();
    return {
      copy: copySnapshot(snap),
      graph: {
        nodes: snap.nodeCount,
        edges: snap.edgeCount,
        diagnostics: snap.diagnostics().map((/** @type {any} */ d) => ({
          message: d.message,
          line: d.line,
          symbol: d.symbol,
        })),
      },
    };
  };

  /** @type {Map<string, any>} */
  const byId = new Map();
  for (const id of ["schema-mlir", "nano-dsp-mlir"]) {
    const f = path.join(ROOT, "artifacts", `${id}.json`);
    if (fs.existsSync(f))
      for (const a of JSON.parse(fs.readFileSync(f, "utf8")).artifacts)
        byId.set(a.id, a);
  }
  const eventFor = (/** @type {string} */ prefix, /** @type {RegExp} */ pass) =>
    [...byId.values()].find(
      (a) =>
        a.kind === "pass-event" &&
        a.id.startsWith(prefix) &&
        pass.test(a.pass) &&
        a.changed,
    );

  const pairs = [
    {
      id: "viz-schema-canonicalize-diff",
      title: "json-schema-mlir canonicalization, diffed by VizMLIR",
      ev: eventFor("schema-pass", /SchemaCanonicalizerPass/),
    },
    {
      id: "viz-schema-lowering-diff",
      title: "json-schema-mlir lowering to std, diffed by VizMLIR",
      ev: eventFor("schema-pass", /LowerSchemaToStandard/),
    },
    {
      id: "viz-nano-linalg-diff",
      title: "nano-dsp-mlir dsp → linalg, diffed by VizMLIR",
      ev: eventFor("nano-pass", /DSPToLinalg|dsp-to-linalg/i),
    },
  ];
  /** @type {Artifact[]} */
  const out = [];
  const command =
    "node scripts/capture.mjs (imports VizMLIR src/wasm/bridge.js, src/diff.js and runs public/mlir_core.wasm)";
  for (const { id, title, ev } of pairs) {
    if (!ev) {
      out.push(
        unavailable(
          id,
          "pass-event",
          title,
          "The upstream pass event was not captured, so there is nothing to diff.",
        ),
      );
      continue;
    }
    const before = parse(byId.get(ev.before).text);
    const after = parse(byId.get(ev.after).text);
    const rows = diffSnapshots(before.copy, after.copy).map(
      (/** @type {any} */ r) => ({
        type: r.type,
        before: r.before?.label,
        after: r.after?.label,
      }),
    );
    out.push({
      id,
      kind: "pass-event",
      title,
      pass: ev.pass,
      index: ev.index,
      changed: true,
      before: ev.before,
      after: ev.after,
      diff: {
        tool: "VizMLIR diffSnapshots",
        rows,
        beforeGraph: before.graph,
        afterGraph: after.graph,
      },
      provenance: { mode: "captured", command },
    });
  }
  out.push(
    unavailable(
      "viz-tests",
      "test-run",
      "Automated tests",
      "The repository has no automated test suite at the pinned commit. The capture above exercises its WASM parser and diff module.",
    ),
  );
  return out;
}

// ---------------------------------------------------------------------------

function toolchain() {
  const v = (
    /** @type {string} */ cmd,
    /** @type {string[]} */ a,
    /** @type {RegExp} */ re,
  ) => re.exec(run(cmd, a).stdout + run(cmd, a).stderr)?.[1] ?? "unknown";
  return {
    llvm: v(tool("mlir-opt"), ["--version"], /LLVM version ([\w.]+)/),
    python: v("python3", ["--version"], /Python ([\w.]+)/),
    node: process.version,
    rustc: v("rustc", ["--version"], /rustc ([\w.]+)/),
  };
}

/** @type {Record<string, () => Artifact[] | Promise<Artifact[]>>} */
const CAPTURES = {
  "schema-mlir": captureSchemaMlir,
  "nano-dsp-mlir": captureNanoDsp,
  vizmlir: captureVizmlir, // last: diffs the IR captured by the others
};

const chain = toolchain();
let failed = false;
for (const [id, capture] of Object.entries(CAPTURES)) {
  if (args.project && args.project !== id) continue;
  const project = manifest.projects.find((p) => p.id === id);
  if (!project) throw new Error(`manifest has no project ${id}`);
  const head = run("git", [
    "-C",
    srcDir(id),
    "rev-parse",
    "HEAD",
  ]).stdout.trim();
  if (head !== project.commit)
    throw new Error(
      `${id}: checkout is ${head}, manifest pins ${project.commit}`,
    );

  const file = {
    project: id,
    commit: project.commit,
    capture: {
      capturedAt: new Date().toISOString(),
      host: `${os.platform()}-${os.arch()}`,
      toolchain: chain,
    },
    artifacts: await capture(),
  };
  const errs = validateArtifactFile(file, project);
  if (errs.length) {
    console.error(errs.join("\n"));
    failed = true;
  }
  fs.writeFileSync(
    path.join(ROOT, "artifacts", `${id}.json`),
    JSON.stringify(file, null, 2) + "\n",
  );
  console.log(`captured ${id}: ${file.artifacts.length} artifacts`);
}
process.exit(failed ? 1 : 0);
