#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateArtifactFile } from "../src/model.js";
import { ROOT } from "./root.mjs";
import { args, manifest, run, srcDir, tool } from "./capture/common.mjs";
import { captureNanoDsp } from "./capture/nano-dsp.mjs";
import { captureSchemaMlir } from "./capture/schema-mlir.mjs";
import { captureVizmlir } from "./capture/vizmlir.mjs";

/** @typedef {import("../src/model.js").Artifact} Artifact */

function mojoVersion() {
  const ids = [args.project, ...manifest.projects.map((p) => p.id)];

  for (const id of ids) {
    const toml = id && path.join(srcDir(id), "pixi.toml");
    if (!toml || !fs.existsSync(toml)) continue;

    const r = run("pixi", [
      "run",
      "--manifest-path",
      toml,
      "mojo",
      "--version",
    ]);

    const m = /Mojo ([\w.]+)/.exec(r.stdout + r.stderr);
    if (m) return m[1];
  }

  return "unknown";
}

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
    mojo: mojoVersion(),
    rustc: v("rustc", ["--version"], /rustc ([\w.]+)/),
  };
}

/** @type {Record<string, () => Artifact[] | Promise<Artifact[]>>} */
const CAPTURES = {
  "schema-mlir": captureSchemaMlir,
  "nano-dsp-mlir": captureNanoDsp,
  vizmlir: captureVizmlir,
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

  if (head !== project.commit) {
    throw new Error(
      `${id}: checkout is ${head}, manifest pins ${project.commit}`,
    );
  }

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
