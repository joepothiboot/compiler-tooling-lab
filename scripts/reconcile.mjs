#!/usr/bin/env node

import path from "node:path";
import { loadContext } from "./build.mjs";
import { describe, lsRemote, releaseTags } from "./lib-git.mjs";
import { ROOT } from "./root.mjs";

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

      if (releaseTag !== latest) {
        updates.push({ id: p.id, ref: latest, from: p.releaseTag });
      }
    } else {
      describe(p.repo, p.commit);
    }
  } catch (e) {
    problems.push(
      `${p.id}: ${String(/** @type {Error} */ (e).message).split("\n")[0]}`,
    );
  }
}

console.log(JSON.stringify({ updates, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
