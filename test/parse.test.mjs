// Parsers are tested against output copied verbatim from real tool runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseDiagnostics,
  parseIRDumps,
  parseLit,
  parseMojoTests,
  parsePassFailLines,
  parseTiming,
  parseVitest,
} from "../src/parse.js";

test("parseDiagnostics reads MLIR file:line:col diagnostics and notes", () => {
  const out = `bad.mlir:2:8: error: 'schema.validate_string' op 'max_length' (3) must be >= 'min_length' (8)
  %v = schema.validate_string %doc { min_length = 8 : i64, max_length = 3 : i64 } : !schema.value
       ^
bad.mlir:2:8: note: see current operation: %0 = "schema.validate_string"(%arg0) <{max_length = 3 : i64, min_length = 8 : i64}> : (!schema.value) -> i1`;
  const d = parseDiagnostics(out);
  assert.equal(d.length, 2);
  assert.deepEqual(d[0].location, { file: "bad.mlir", line: 2, column: 8 });
  assert.equal(d[0].severity, "error");
  assert.equal(d[1].severity, "note");
});

test("parseIRDumps splits per pass and normalises pass names", () => {
  const out = `// -----// IR Dump After CanonicalizerPass: canonicalize{cse-between-iterations=false    max-iterations=10} //----- //
module {
}

// -----// IR Dump After (anonymous namespace)::LowerSchemaToStandardPass: lower-schema-to-std ('builtin.module' operation) //----- //
module attributes {schema.string_pool = []} {
}
`;
  const dumps = parseIRDumps(out);
  assert.deepEqual(
    dumps.map((d) => d.pass),
    [
      "CanonicalizerPass (canonicalize)",
      "LowerSchemaToStandardPass (lower-schema-to-std)",
    ],
  );
  assert.equal(dumps[0].text, "module {\n}");
});

test("parseTiming reads the wall-time table with nesting", () => {
  const out = `  Total Execution Time: 0.0243 seconds

  ----Wall Time----  ----Name----
    0.0105 ( 43.2%)  Parser
    0.0003 (  1.4%)  'func.func' Pipeline
    0.0003 (  1.4%)    (anonymous namespace)::SchemaCanonicalizerPass
    0.0243 (100.0%)  Total`;
  const t = parseTiming(out);
  assert.equal(t.total, 0.0243);
  assert.equal(t.entries.length, 3);
  assert.deepEqual(t.entries[2], {
    name: "SchemaCanonicalizerPass",
    value: 0.0003,
    percent: 1.4,
    depth: 1,
  });
});

test("parseLit reads per-test lines and the summary", () => {
  const out = `-- Testing: 3 tests, 3 workers --
PASS: JSON-SCHEMA-MLIR :: Dialect/Schema/ops.mlir (1 of 3)
PASS: JSON-SCHEMA-MLIR :: Lowering/lower-to-std.mlir (2 of 3)
FAIL: JSON-SCHEMA-MLIR :: Dialect/Schema/schema-canonicalize.mlir (3 of 3)

Total Discovered Tests: 3
  Passed: 2 (66.67%)
  Failed: 1 (33.33%)`;
  const r = parseLit(out);
  assert.equal(r.passed, 2);
  assert.equal(r.failed, 1);
  assert.match(r.log, /FAIL: .*schema-canonicalize/);
});

test("parseVitest reads the Tests summary line", () => {
  const out = [
    " Test Files  8 passed (8)",
    "      Tests  136 passed (136)",
    "   Start at  21:36:01",
  ].join("\n");
  const r = parseVitest(out);
  assert.deepEqual([r.passed, r.failed, r.skipped], [136, 0, 0]);
  const failed = parseVitest(
    "      Tests  2 failed | 133 passed | 1 skipped (136)",
  );
  assert.deepEqual([failed.passed, failed.failed, failed.skipped], [133, 2, 1]);
});

test("parseMojoTests counts a full run and treats an abort as a failure", () => {
  const ok = parseMojoTests(
    "✨ Pixi task (test-mojo): mojo run -I mojo mojo/tests/test_kernels.mojo\nnanodsp: 12 tests passed\n",
    0,
  );
  assert.deepEqual([ok.passed, ok.failed], [12, 0]);
  const aborted = parseMojoTests(
    "Unhandled exception caught during execution: At mojo/tests/test_kernels.mojo:41:21: AssertionError: `left == right` comparison failed:",
    1,
  );
  assert.deepEqual([aborted.passed, aborted.failed], [0, 1]);
});

test("parsePassFailLines counts PASS and FAIL lines only", () => {
  const r = parsePassFailLines(
    "✨ Pixi task (test-reference): c++ ...\nPASS add\nPASS relu\nFAIL matmul\n",
  );
  assert.deepEqual([r.passed, r.failed], [2, 1]);
  assert.equal(r.log, "PASS add\nPASS relu\nFAIL matmul");
});
