import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @param {string} repo */
export function repoUrl(repo) {
  const base = process.env.REPO_BASE;

  return base
    ? path.join(base, repo.split("/")[1])
    : `https://github.com/${repo}.git`;
}

/**
 * @param {string[]} args
 * @param {string} [cwd]
 */
export function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * @param {string} repo
 * @returns {Map<string, string>}
 */
export function lsRemote(repo) {
  const refs = new Map();

  for (const line of git(["ls-remote", "--tags", "--heads", repoUrl(repo)])
    .split("\n")
    .filter(Boolean)) {
    const [sha, ref] = line.split("\t");
    if (ref.endsWith("^{}")) refs.set(ref.slice(0, -3), sha);
    else if (!refs.has(ref)) refs.set(ref, sha);
  }

  return refs;
}

/** @param {Map<string, string>} refs */
export function releaseTags(refs) {
  const parse = (/** @type {string} */ t) =>
    /** @type {number[]} */ (
      /^v(\d+)\.(\d+)\.(\d+)$/.exec(t)?.slice(1).map(Number)
    );

  return [...refs.keys()]
    .filter((r) => r.startsWith("refs/tags/"))
    .map((r) => r.slice("refs/tags/".length))
    .filter((t) => parse(t))
    .sort((a, b) => {
      const [x, y] = [parse(a), parse(b)];

      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
}

/**
 * @param {string} repo
 * @param {string} commit
 */
export function describe(repo, commit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctl-describe-"));

  try {
    git(["init", "-q", dir]);
    git(["remote", "add", "origin", repoUrl(repo)], dir);

    git(
      [
        "fetch",
        "-q",
        "--filter=blob:none",
        "origin",
        commit,
        "+refs/tags/*:refs/tags/*",
      ],
      dir,
    );

    const version = git(
      ["describe", "--tags", "--always", "--abbrev=7", commit],
      dir,
    );

    let releaseTag = null;

    try {
      releaseTag = git(
        ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", commit],
        dir,
      );
    } catch {}

    return {
      version: /^[0-9a-f]{7}$/.test(version) ? `g${version}` : version,
      releaseTag,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
