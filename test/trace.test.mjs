// The trace viewer's inputs: the validator, the line alignment, and the claim
// the page makes about the captured Person trace (three allOf branches fuse
// into one canonical op). The trace under test is the captured artifact, not
// a hand-written copy.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { renderTraceViewer } from "../src/render-trace.js";
import {
  alignLines,
  byteSlicer,
  flattenAst,
  validateTrace,
} from "../src/trace.js";

/** @returns {import("../src/trace.js").Trace} */
const captured = () =>
  structuredClone(
    JSON.parse(
      fs.readFileSync(
        new URL("../artifacts/schema-mlir.json", import.meta.url),
        "utf8",
      ),
    ).artifacts.find((/** @type {any} */ a) => a.id === "schema-trace").trace,
  );

test("the captured trace is valid", () => {
  assert.deepEqual(validateTrace(captured()), []);
});

test("validateTrace rejects unknown versions and inconsistent data", () => {
  assert.match(validateTrace({ ...captured(), version: 2 })[0], /version is 2/);
  assert.match(validateTrace({ format: "x" })[0], /format/);
  const badToken = captured();
  badToken.tokens[1].text = "nope";
  assert.match(validateTrace(badToken).join(), /does not match the source/);
  const badRange = captured();
  badRange.tokens[0].range.end.offset = 99999;
  assert.match(validateTrace(badRange).join(), /bad range/);
  const badOp = captured();
  badOp.stages[0].ops[2].astNodes = [999];
  badOp.stages[0].ops[2].ranges = [badOp.tokens[0].range];
  assert.match(validateTrace(badOp).join(), /no AST node 999/);
  const badParent = captured();
  badParent.stages[0].ops[1].parent = 7;
  assert.match(validateTrace(badParent).join(), /does not precede/);
  const badLine = captured();
  badLine.stages[1].ops[1].irPos = { line: 500, column: 1 };
  assert.match(validateTrace(badLine).join(), /outside the IR text/);
});

test("byteSlicer slices by UTF-8 byte offsets", () => {
  const slice = byteSlicer('{"é": 1}');
  assert.equal(slice(1, 5), '"é"');
  assert.equal(slice(0, 1), "{");
});

test("flattenAst lists nodes in pre-order with parents", () => {
  const flat = flattenAst(captured().ast);
  assert.deepEqual(
    flat.map((f) => f.node.id),
    [...flat.keys()],
  );
  assert.equal(flat[0].parent, null);
  assert.equal(flat[15].parent, 13);
});

test("alignLines pairs equal lines and stacks lines that merged", () => {
  const before = ["a", "x1", "x2", "x3", "z"];
  const after = ["a", "X", "z"];
  const rows = alignLines(before, after, (i, j) => j === 1 && i >= 1 && i <= 3);
  assert.deepEqual(rows, [
    { before: 0, after: 0, group: null },
    { before: 1, after: 1, group: 0 },
    { before: 2, after: null, group: 0 },
    { before: 3, after: null, group: 0 },
    { before: 4, after: 2, group: null },
  ]);
});

test("alignLines keeps every line exactly once", () => {
  const before = ["m", "p", "q", "r", "s"];
  const after = ["m", "q2", "n", "s", "t"];
  const rows = alignLines(before, after, () => false);
  assert.deepEqual(
    rows.flatMap((r) => (r.before === null ? [] : [r.before])),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    rows.flatMap((r) => (r.after === null ? [] : [r.after])).sort(),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    alignLines([], [], () => false),
    [],
  );
});

test("canonicalization fuses the three allOf branches of `age` into one op", () => {
  const t = captured();
  const flat = flattenAst(t.ast);
  const age = flat.find((f) => f.node.name === "age")?.node;
  assert.ok(age);
  const branches = flat.filter(
    (f) => f.parent !== null && flat[f.parent].node.keyword === "allOf",
  );
  assert.equal(branches.length, 3, "three allOf branches");
  const inner = new Set(
    branches.flatMap((b) => b.node.children.map((c) => c.id)),
  );

  const [imported, canon] = ["import", "schema-canonicalize"].map((n) => {
    const s = t.stages.find((x) => x.name === n);
    assert.ok(s, n);
    return s;
  });
  const numbers = (/** @type {typeof imported} */ s) =>
    s.ops.filter((o) => o.name === "schema.validate_number");
  assert.equal(numbers(imported).length, 6);
  const fused = numbers(canon);
  assert.equal(fused.length, 1, "one validate_number after canonicalize");
  assert.deepEqual(new Set(fused[0].astNodes), inner);
  const under = new Set(flattenAst(age).map((f) => f.node.id));
  assert.ok(fused[0].astNodes.every((id) => under.has(id)));
  assert.ok(imported.ops.length > canon.ops.length);
});

test("the viewer renders every pane from the trace", () => {
  const t = captured();
  const html = renderTraceViewer(t);
  assert.equal(
    (html.match(/class="tv-item" data-t=/g) ?? []).length,
    t.tokens.length - 1,
    "one list entry per token, bar eof",
  );
  assert.equal(
    (html.match(/<(summary|div) class="tv-item[^"]*" data-a=/g) ?? []).length,
    flattenAst(t.ast).length,
    "one AST row per node",
  );
  assert.match(html, /<div class="tv-col before">/);
  assert.match(html, /<div class="tv-col after">/);
  assert.doesNotMatch(html, /<section/, "no nested sections in the artifact");
  assert.match(html, /computed by this site's build/);
});

test("the viewer refuses a trace without the two IR stages", () => {
  const t = captured();
  t.stages = t.stages.slice(0, 1);
  assert.throws(() => renderTraceViewer(t), /import and schema-canonicalize/);
});
