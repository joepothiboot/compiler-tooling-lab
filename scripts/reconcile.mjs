#!/usr/bin/env node
// Compares manifest pins with the projects' remotes.
//
//   node scripts/reconcile.mjs
//
// Reports (one JSON object on stdout):
//   updates:  projects with a newer vX.Y.Z release than the pinned one
//   problems: pinned commits that are no longer fetchable, or artifact files
//             captured at a different commit than the manifest pins
// Exit code 1 when there are problems. Updates alone are not an error.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "./build.mjs";
import { describe, lsRemote, releaseTags } from "./lib-git.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @type {{ id: string, ref: string, from: string | null }[]} */
const updates = [];
/** @type {string[]} */
const problems = [];

let manifest;
try {
  manifest = loadContext(ROOT).manifest;
} catch (e) {
  problems.push(String(/** @type {Error} */ (e).message));
  manifest = (await import("../manifest.json", { with: { type: "json" } }))
    .default;
}

for (const p of manifest.projects) {
  try {
    const latest = releaseTags(lsRemote(p.repo))[0];
    if (latest && latest !== p.releaseTag) {
      const { releaseTag } = describe(p.repo, p.commit);
      // Only propose tags newer than what the pin already contains.
      if (releaseTag !== latest)
        updates.push({ id: p.id, ref: latest, from: p.releaseTag });
    } else {
      describe(p.repo, p.commit); // throws if the pinned commit is gone
    }
  } catch (e) {
    problems.push(
      `${p.id}: ${String(/** @type {Error} */ (e).message).split("\n")[0]}`,
    );
  }
}

console.log(JSON.stringify({ updates, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
