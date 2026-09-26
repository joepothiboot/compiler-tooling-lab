// Parsers are tested against output copied verbatim from real tool runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseDiagnostics,
  parseIRDumps,
  parseLit,
  parsePytest,
  parseTiming,
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

test("parsePytest reads the summary line including collection errors", () => {
  const r = parsePytest(
    "... \n=== 1 passed, 1 deselected, 2 errors in 0.91s ===",
  );
  assert.deepEqual([r.passed, r.failed, r.errors, r.skipped], [1, 0, 2, 1]);
});
