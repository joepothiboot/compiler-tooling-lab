import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { CHAIN } from "../src/constants.js";
import { loadContext } from "../scripts/build.mjs";
import { applyPin, resolveRef } from "../scripts/update-manifest.mjs";

const manifest = JSON.parse(
  fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
);

test("manifest, content and artifacts load and cross-validate", () => {
  const ctx = loadContext();

  assert.deepEqual(
    ctx.manifest.projects.map((p) => p.id),
    [...CHAIN],
  );
});

test("every project is pinned to a full SHA with a describe-style version", () => {
  for (const p of manifest.projects) {
    assert.match(p.commit, /^[0-9a-f]{40}$/, p.id);

    const suffix = p.commit.slice(0, 7);

    assert.ok(
      p.version === p.releaseTag || p.version.endsWith(`g${suffix}`),
      `${p.id}: version ${p.version} does not describe ${suffix}`,
    );

    if (p.releaseTag) {
      assert.ok(
        p.version.startsWith(p.releaseTag),
        `${p.id}: version must start with its release tag`,
      );
    }
  }
});

test("each artifact file records where and with what it was captured", () => {
  for (const p of manifest.projects) {
    const f = JSON.parse(
      fs.readFileSync(
        new URL(`../artifacts/${p.id}.json`, import.meta.url),
        "utf8",
      ),
    );

    assert.equal(f.commit, p.commit);
    assert.ok(f.capture.toolchain.llvm && f.capture.toolchain.node, p.id);
  }
});

test("captured output never leaks absolute capture paths", () => {
  for (const p of manifest.projects) {
    const text = fs.readFileSync(
      new URL(`../artifacts/${p.id}.json`, import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(
      text,
      /\/(Users|home|private|var\/folders|tmp)\//,
      p.id,
    );
  }
});

test("applyPin re-pins one project and refuses non-SHA pins", () => {
  const next = applyPin(manifest, "vizmlir", {
    commit: "b".repeat(40),
    version: "v9.9.9",
    releaseTag: "v9.9.9",
  });

  assert.equal(
    next.projects.find((p) => p.id === "vizmlir")?.commit,
    "b".repeat(40),
  );

  assert.equal(
    next.projects.find((p) => p.id === "nano-dsp-mlir")?.commit,
    manifest.projects.find((p) => p.id === "nano-dsp-mlir")?.commit,
  );

  assert.throws(
    () =>
      applyPin(manifest, "vizmlir", {
        commit: "main",
        version: "x",
        releaseTag: null,
      }),
    /non-SHA/,
  );

  assert.throws(
    () =>
      applyPin(manifest, "nope", {
        commit: "b".repeat(40),
        version: "x",
        releaseTag: null,
      }),
    /unknown/,
  );
});

test("resolveRef accepts SHAs offline and rejects shell-unsafe refs", () => {
  assert.equal(resolveRef("o/r", "c".repeat(40)), "c".repeat(40));
  assert.throws(() => resolveRef("o/r", "v1; rm -rf /"), /invalid ref/);
});
