import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../root.mjs";
import {
  parseDiagnostics,
  parseIRDumps,
  parseTiming,
} from "../../src/parse.js";
import {
  TMP,
  display,
  litRun,
  mojoTestRun,
  parsedInput,
  passArtifacts,
  relativize,
  run,
  srcDir,
  unavailable,
} from "./common.mjs";

/** @typedef {import("../../src/model.js").Artifact} Artifact */

const TRACE_TITLE = "Front-end trace of the Person schema";

/**
 * @param {string} dir
 * @returns {Artifact}
 */
function captureSchemaTrace(dir) {
  const rel = "examples/person/person.schema.json";
  const translate = path.join(dir, "build/bin/schema-translate");

  if (!fs.existsSync(translate)) {
    return unavailable(
      "schema-trace",
      "trace",
      TRACE_TITLE,
      "schema-translate (and --emit-trace) is not in the build at the pinned commit.",
    );
  }

  const traceFile = path.join(TMP, "person.trace.json");
  fs.rmSync(traceFile, { force: true });

  const argv = ["--import-json-schema", rel, `--emit-trace=${traceFile}`];
  const r = run(translate, argv, { cwd: dir });

  if (r.code !== 0 || !fs.existsSync(traceFile)) {
    throw new Error(`schema-translate --emit-trace failed:\n${r.stderr}`);
  }

  const trace = JSON.parse(fs.readFileSync(traceFile, "utf8"));

  if (trace.source?.text !== fs.readFileSync(path.join(dir, rel), "utf8")) {
    throw new Error(`the trace's source text differs from ${rel}`);
  }

  return {
    id: "schema-trace",
    kind: "trace",
    title: TRACE_TITLE,
    trace,
    provenance: {
      mode: "captured",
      command: display("schema-translate", argv),
    },
  };
}

/** @returns {Artifact[]} */
export function captureSchemaMlir() {
  const dir = srcDir("schema-mlir");
  const opt = path.join(dir, "build/bin/schema-opt");

  if (!fs.existsSync(opt)) {
    const reason =
      "schema-opt did not build at the pinned commit; see the capture job log.";

    return [
      unavailable("schema-tests", "test-run", "lit regression suite", reason),
      unavailable("schema-input", "ir-snapshot", "Input IR", reason),
      unavailable("schema-trace", "trace", TRACE_TITLE, reason),
      mojoTestRun(dir, "schema-mojo-tests", "Mojo constraint-lattice tests"),
    ];
  }

  /** @type {Artifact[]} */
  const out = [
    litRun(dir, "schema-tests", "lit regression suite (check-schema)"),
    mojoTestRun(dir, "schema-mojo-tests", "Mojo constraint-lattice tests"),
  ];

  const rel = "test/Dialect/Schema/schema-canonicalize.mlir";
  const lines = fs.readFileSync(path.join(dir, rel), "utf8").split("\n");

  const start = lines.findIndex((l) =>
    l.startsWith("func.func @fuse_constraint_tree"),
  );

  const end = lines.indexOf("}", start);

  if (start < 0 || end < 0) {
    throw new Error(`${rel}: @fuse_constraint_tree not found`);
  }

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

  if (pipe.code !== 0) {
    throw new Error(`schema-opt pipeline failed:\n${pipe.stderr}`);
  }

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

  if (llvm.code !== 0) {
    throw new Error(`schema-opt llvm pipeline failed:\n${llvm.stderr}`);
  }

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

  out.push(captureSchemaTrace(dir));

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
