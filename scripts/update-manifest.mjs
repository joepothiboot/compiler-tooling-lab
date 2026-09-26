#!/usr/bin/env node
// Re-pins one project in manifest.json to a release tag or a full commit SHA.
//
//   node scripts/update-manifest.mjs --project <id> --ref <tag|sha>
//
// Branch names are refused: the manifest must never float with a branch.
// Prints key=value lines (project, from, to, version, release_tag, changed) for
// $GITHUB_OUTPUT. Artifacts must be re-captured afterwards (scripts/capture.sh);
// until then the build fails on the commit mismatch, by design.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "../src/model.js";
import { SHA, describe, lsRemote } from "./lib-git.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Returns a new manifest with `id` pinned to `pin`. Pure; validates the result.
 * @param {import("../src/model.js").Manifest} manifest
 * @param {string} id
 * @param {{ commit: string, version: string, releaseTag: string | null }} pin
 */
export function applyPin(manifest, id, pin) {
  if (!SHA.test(pin.commit))
    throw new Error(`refusing to pin ${id} to non-SHA ${pin.commit}`);
  if (!manifest.projects.some((p) => p.id === id))
    throw new Error(`unknown project ${id}`);
  const next = {
    ...manifest,
    projects: manifest.projects.map((p) =>
      p.id === id
        ? {
            ...p,
            commit: pin.commit,
            version: pin.version,
            releaseTag: pin.releaseTag,
          }
        : p,
    ),
  };
  const errs = validateManifest(next);
  if (errs.length) throw new Error(errs.join("\n"));
  return next;
}

/**
 * Resolves a tag or SHA on the project's remote to a commit. Branches are refused.
 * @param {string} repo @param {string} ref
 */
export function resolveRef(repo, ref) {
  if (!/^[A-Za-z0-9._\/-]+$/.test(ref))
    throw new Error(`invalid ref: ${JSON.stringify(ref)}`);
  if (SHA.test(ref)) return ref;
  const refs = lsRemote(repo);
  const tag = refs.get(`refs/tags/${ref}`);
  if (tag) return tag;
  if (refs.has(`refs/heads/${ref}`))
    throw new Error(
      `${ref} is a branch; pin a release tag or a full commit SHA instead`,
    );
  throw new Error(`${repo} has no tag ${ref}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const argv = process.argv.slice(2);
  const opt = (/** @type {string} */ n) => argv[argv.indexOf(n) + 1];
  const id = argv.includes("--project") ? opt("--project") : "";
  const ref = argv.includes("--ref") ? opt("--ref") : "";
  if (!id || !ref) {
    console.error("usage: update-manifest.mjs --project <id> --ref <tag|sha>");
    process.exit(2);
  }
  try {
    const file = path.join(ROOT, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    const project = manifest.projects.find(
      (/** @type {any} */ p) => p.id === id,
    );
    if (!project) throw new Error(`unknown project ${id}`);
    const commit = resolveRef(project.repo, ref);
    const { version, releaseTag } = describe(project.repo, commit);
    const next = applyPin(manifest, id, { commit, version, releaseTag });
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
    const out = {
      project: id,
      repo: project.repo,
      from: project.commit,
      to: commit,
      version,
      release_tag: releaseTag ?? "",
      changed: String(project.commit !== commit),
    };
    for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
  } catch (e) {
    console.error(String(/** @type {Error} */ (e).message));
    process.exit(1);
  }
}
