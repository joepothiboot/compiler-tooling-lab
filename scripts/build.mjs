#!/usr/bin/env node
// Builds the static site into dist/ (or --out). Fails on any invalid manifest,
// stale artifact file, or content that references a missing artifact.
//
//   node scripts/build.mjs [--out dir] [--vizmlir-dist dir]
//
// --vizmlir-dist: a VizMLIR build of the pinned commit (scripts/build-vizmlir.sh),
// copied to the project's `embeddedDemo` path.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtifactFile, validateManifest } from "../src/model.js";
import {
  artifactIndex,
  landingPage,
  projectPage,
  tourPage,
} from "../src/render.js";
import { PROJECTS, STAGE_TEXT } from "../content/projects.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Loads and cross-validates everything the site is built from.
 * @param {string} root
 * @returns {import("../src/render.js").Ctx}
 */
export function loadContext(root = ROOT) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const errs = validateManifest(manifest);
  /** @type {import("../src/render.js").Ctx["artifacts"]} */
  const artifacts = new Map();
  for (const project of manifest.projects ?? []) {
    const file = path.join(root, "artifacts", `${project.id}.json`);
    if (!fs.existsSync(file)) {
      errs.push(
        `missing artifacts/${project.id}.json — run scripts/capture.sh`,
      );
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    errs.push(...validateArtifactFile(data, project));
    for (const artifact of data.artifacts ?? []) {
      if (artifacts.has(artifact.id))
        errs.push(`artifact id ${artifact.id} is not globally unique`);
      artifacts.set(artifact.id, { artifact, project, file: data });
    }
  }
  for (const project of manifest.projects ?? []) {
    const c = /** @type {Record<string, any>} */ (PROJECTS)[project.id];
    if (!c) {
      errs.push(`content/projects.js has no entry for ${project.id}`);
      continue;
    }
    const refs = [
      ...c.tests,
      ...c.benchmarks,
      ...c.tour.flatMap((/** @type {any} */ s) => s.artifacts ?? []),
    ];
    for (const id of refs)
      if (!artifacts.has(id))
        errs.push(`${project.id}: content references missing artifact ${id}`);
    for (const a of artifacts.values()) {
      const pe = a.artifact;
      if (pe.kind === "pass-event" && pe.provenance.mode !== "unavailable")
        for (const ref of [pe.before, pe.after])
          if (ref && !artifacts.has(ref))
            errs.push(`${pe.id}: references missing snapshot ${ref}`);
    }
    if (project.demoPath !== `projects/${project.id}/tour.html`)
      errs.push(
        `${project.id}: demoPath must be projects/${project.id}/tour.html`,
      );
  }
  if (errs.length)
    throw new Error(
      `build input is invalid:\n  ${[...new Set(errs)].join("\n  ")}`,
    );
  return {
    manifest,
    content: PROJECTS,
    stageText: STAGE_TEXT,
    artifacts,
    embedded: new Set(),
  };
}

/**
 * @param {{ out: string, vizmlirDist?: string, root?: string }} opts
 * @returns {string[]} written files, relative to out
 */
export function build({ out, vizmlirDist, root = ROOT }) {
  const ctx = loadContext(root);
  fs.rmSync(out, { recursive: true, force: true });
  /** @type {string[]} */
  const written = [];
  const write = (
    /** @type {string} */ rel,
    /** @type {string | Buffer} */ data,
  ) => {
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
    fs.writeFileSync(path.join(out, rel), data);
    written.push(rel);
  };

  if (vizmlirDist) {
    const viz = ctx.manifest.projects.find((p) => p.id === "vizmlir");
    if (!viz?.embeddedDemo)
      throw new Error("manifest: vizmlir has no embeddedDemo path");
    if (!fs.existsSync(path.join(vizmlirDist, "index.html")))
      throw new Error(`${vizmlirDist} is not a VizMLIR build`);
    fs.cpSync(vizmlirDist, path.join(out, viz.embeddedDemo), {
      recursive: true,
    });
    ctx.embedded.add(viz.id);
  }

  write("index.html", landingPage(ctx));
  for (const p of ctx.manifest.projects) {
    write(`projects/${p.id}/index.html`, projectPage(ctx, p));
    write(p.demoPath, tourPage(ctx, p));
    write(
      `artifacts/${p.id}.json`,
      fs.readFileSync(path.join(root, "artifacts", `${p.id}.json`)),
    );
  }
  write("artifacts/index.html", artifactIndex(ctx));
  write("manifest.json", fs.readFileSync(path.join(root, "manifest.json")));
  write("assets/site.css", fs.readFileSync(path.join(root, "src/site.css")));
  write("assets/copy.js", fs.readFileSync(path.join(root, "src/copy.js")));
  write("assets/theme.js", fs.readFileSync(path.join(root, "src/theme.js")));
  write(
    "assets/compact.js",
    fs.readFileSync(path.join(root, "src/compact.js")),
  );
  write(
    "assets/terminal.js",
    fs.readFileSync(path.join(root, "src/terminal.js")),
  );
  write(".nojekyll", "");
  return written;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const argv = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const out = path.resolve(opt("--out") ?? path.join(ROOT, "dist"));
  const vizmlirDist = opt("--vizmlir-dist") ?? process.env.VIZMLIR_DIST;
  try {
    const files = build({
      out,
      vizmlirDist: vizmlirDist && path.resolve(vizmlirDist),
    });
    console.log(
      `built ${files.length} files into ${path.relative(process.cwd(), out) || "."}${vizmlirDist ? " (with pinned VizMLIR demo)" : ""}`,
    );
  } catch (e) {
    console.error(String(/** @type {Error} */ (e).message));
    process.exit(1);
  }
}
