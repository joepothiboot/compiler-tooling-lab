import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAIN, STAGES } from "../src/constants.js";
import {
  validateArtifact,
  validateArtifactFile,
  validateManifest,
} from "../src/model.js";

const SHA = "a".repeat(40);

const project = (
  /** @type {string} */ id,
  /** @type {import("../src/model.js").Stage[]} */ stages,
) => ({
  id,
  name: id,
  repo: `owner/${id}`,
  version: "v1.0.0",
  releaseTag: "v1.0.0",
  commit: SHA,
  docsPath: "README.md",
  stages,
  capabilities: ["does a thing"],
});

const goodManifest = () => ({
  schemaVersion: 1,
  toolchain: { llvm: "23.1.1", python: "3.11", node: "22" },
  projects: [
    project(CHAIN[0], ["source", "diagnostics", "mlir"]),
    project(CHAIN[1], ["passes"]),
    project(CHAIN[2], ["profiling"]),
  ],
});

test("a complete manifest validates", () => {
  assert.deepEqual(validateManifest(goodManifest()), []);
});

test("manifest rejects branch pins, short SHAs and wrong chain order", () => {
  const m = goodManifest();
  m.projects[0].commit = "main";
  m.projects[1].commit = "46e767b";

  assert.equal(
    validateManifest(m).filter((e) => e.includes("40-hex")).length,
    2,
  );

  const r = goodManifest();
  r.projects.reverse();
  assert.ok(validateManifest(r).some((e) => e.includes("order")));
});

test("manifest requires every pipeline stage to be covered", () => {
  const m = goodManifest();
  m.projects[2].stages = ["mlir"];

  assert.deepEqual(validateManifest(m), [
    'no project covers stage "profiling"',
  ]);

  assert.equal(STAGES.length, 5);
});

test("captured artifacts must record their command; static ones their path", () => {
  const base = {
    id: "x",
    kind: "source",
    title: "t",
    language: "mlir",
    text: "",
  };

  assert.ok(
    validateArtifact({ ...base, provenance: { mode: "captured" } }).some((e) =>
      e.includes("command"),
    ),
  );

  assert.ok(
    validateArtifact({ ...base, provenance: { mode: "static" } }).some((e) =>
      e.includes("source path"),
    ),
  );

  assert.deepEqual(
    validateArtifact({
      ...base,
      provenance: { mode: "static", path: "a.mlir" },
    }),
    [],
  );
});

test("unavailable artifacts need a reason and nothing else", () => {
  assert.deepEqual(
    validateArtifact({
      id: "x",
      kind: "profile",
      title: "t",
      provenance: { mode: "unavailable", reason: "not built" },
    }),
    [],
  );

  assert.ok(
    validateArtifact({
      id: "x",
      kind: "profile",
      title: "t",
      provenance: { mode: "unavailable" },
    }).length,
  );
});

test("diagnostics validate severities and 1-based locations", () => {
  const d = (/** @type {any} */ loc) => ({
    id: "d",
    kind: "diagnostic",
    title: "t",
    tool: "x-opt",
    exitCode: 1,
    entries: [{ severity: "error", message: "bad", location: loc }],
    provenance: { mode: "captured", command: "x-opt a.mlir" },
  });

  assert.deepEqual(
    validateArtifact(d({ file: "a.mlir", line: 2, column: 8 })),
    [],
  );

  assert.deepEqual(validateArtifact(d(null)), []);
  assert.ok(validateArtifact(d({ file: "a.mlir", line: 0 })).length);
});

test("artifact files must match the manifest pin and have unique ids", () => {
  const p = goodManifest().projects[0];

  const a = {
    id: "s",
    kind: "source",
    title: "t",
    language: "x",
    text: "",
    provenance: { mode: "static", path: "f" },
  };

  const file = {
    project: p.id,
    commit: SHA,
    capture: { capturedAt: "2026-01-01", host: "linux-x64" },
    artifacts: [a],
  };

  assert.deepEqual(validateArtifactFile(file, p), []);

  assert.ok(
    validateArtifactFile({ ...file, commit: "b".repeat(40) }, p).some((e) =>
      e.includes("re-run capture"),
    ),
  );

  assert.ok(
    validateArtifactFile({ ...file, artifacts: [a, a] }, p).some((e) =>
      e.includes("duplicate"),
    ),
  );
});
