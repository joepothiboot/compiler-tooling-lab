import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../root.mjs";
import { parseLit, parseMojoTests } from "../../src/parse.js";

/** @typedef {import("../../src/model.js").Artifact} Artifact */
/** @typedef {import("../../src/model.js").Manifest} Manifest */

export const args = Object.fromEntries(
  process.argv.slice(2).reduce((/** @type {string[][]} */ acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]]);

    return acc;
  }, []),
);

if (!args.work || !args.llvm) {
  console.error(
    "usage: capture.mjs --work <dir> --llvm <prefix> [--project <id>]",
  );

  process.exit(2);
}

export const WORK = path.resolve(args.work);
export const LLVM = path.resolve(args.llvm);
export const TMP = path.join(WORK, "tmp");
fs.mkdirSync(TMP, { recursive: true });

/** @type {Manifest} */
export const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"),
);

export const srcDir = (/** @type {string} */ id) => path.join(WORK, "src", id);

/**
 * @param {string} cmd
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: Record<string, string>, input?: string }} [opts]
 */
export function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  return {
    code: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: (r.stderr ?? "") + (r.error ? String(r.error.message) : ""),
  };
}

export function relativize(/** @type {string} */ text) {
  let out = text;

  for (const p of manifest.projects) {
    out = out
      .split(`${srcDir(p.id)}/build/bin/`)
      .join("")
      .split(`${srcDir(p.id)}/`)
      .join("");
  }

  return out
    .split(`${ROOT}/`)
    .join("lab:")
    .split(`${TMP}/`)
    .join("")
    .split(`${LLVM}/bin/`)
    .join("")
    .split(`${LLVM}/lib/`)
    .join("$LLVM/lib/")
    .split(`${WORK}/`)
    .join("");
}

const shellWord = (/** @type {string} */ w) =>
  /^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`;

export const display = (
  /** @type {string} */ cmd,
  /** @type {string[]} */ argv,
) => relativize([cmd, ...argv].map(shellWord).join(" "));

export function tool(/** @type {string} */ name) {
  const inLlvm = path.join(LLVM, "bin", name);

  return fs.existsSync(inLlvm) ? inLlvm : name;
}

/**
 * @template {{ log: string }} T
 * @param {T} r
 * @returns {T}
 */
export const withLog = (r) => ({ ...r, log: relativize(r.log) });

/** @returns {Artifact} */
export function unavailable(
  /** @type {string} */ id,
  /** @type {any} */ kind,
  /** @type {string} */ title,
  /** @type {string} */ reason,
) {
  return /** @type {Artifact} */ ({
    id,
    kind,
    title,
    provenance: { mode: "unavailable", reason },
  });
}

/** @type {[string, RegExp][]} */
const STAGE_PATTERNS = [
  ["llvm", /\bllvm\./],
  ["dsp", /\bdsp\./],
  ["schema", /\bschema\.validate|schema\.struct/],
  ["linalg", /\blinalg\./],
];

export function stageOf(/** @type {string} */ ir) {
  const match = STAGE_PATTERNS.find(([, pattern]) => pattern.test(ir));

  return match ? match[0] : "arith/scf/memref";
}

const slug = (/** @type {string} */ s) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * @param {string} prefix
 * @param {string} inputId
 * @param {string} inputText
 * @param {{ pass: string, text: string }[]} dumps
 * @param {string} command
 */
export function passArtifacts(prefix, inputId, inputText, dumps, command) {
  /** @type {Artifact[]} */
  const out = [];
  let prevId = inputId;
  let prevText = inputText;

  dumps.forEach((d, i) => {
    const changed = d.text !== prevText;
    let afterId = prevId;

    if (changed) {
      afterId = `${prefix}-ir-${i + 1}-${slug(d.pass)}`;

      out.push({
        id: afterId,
        kind: "ir-snapshot",
        title: `IR after ${d.pass}`,
        stage: stageOf(d.text),
        text: d.text,
        provenance: { mode: "captured", command },
      });
    }

    out.push({
      id: `${prefix}-pass-${i + 1}-${slug(d.pass)}`,
      kind: "pass-event",
      title: d.pass,
      pass: d.pass,
      index: i + 1,
      changed,
      before: prevId,
      after: afterId,
      provenance: { mode: "captured", command },
    });

    prevId = afterId;
    prevText = d.text;
  });

  return out;
}

/**
 * @param {string} opt
 * @param {string[]} argv
 * @param {string} prefix
 * @param {string} name
 * @param {string} [cwd]
 */
export function parsedInput(opt, argv, prefix, name, cwd) {
  const r = run(opt, argv, { cwd });

  if (r.code !== 0) {
    throw new Error(`${name} could not parse its input:\n${r.stderr}`);
  }

  const text = r.stdout.trim();

  /** @type {Artifact} */
  const artifact = {
    id: `${prefix}-ir-0-parsed`,
    kind: "ir-snapshot",
    title: `Input as parsed and printed by ${name}`,
    stage: stageOf(text),
    text,
    provenance: { mode: "captured", command: display(name, argv) },
  };

  return { artifact, text };
}

export function litRun(
  /** @type {string} */ dir,
  /** @type {string} */ id,
  /** @type {string} */ title,
) {
  const lit = fs.existsSync(path.join(LLVM, "bin", "llvm-lit"))
    ? path.join(LLVM, "bin", "llvm-lit")
    : "lit";

  const r = run(lit, ["-v", "build/test"], {
    cwd: dir,
    env: { PATH: `${LLVM}/bin:${process.env.PATH}` },
  });

  return /** @type {Artifact} */ ({
    id,
    kind: "test-run",
    title,
    runner: "lit",
    ...withLog(parseLit(r.stdout + r.stderr)),
    provenance: { mode: "captured", command: "lit -v build/test" },
  });
}

export function pixiTask(
  /** @type {string} */ dir,
  /** @type {string} */ task,
) {
  const r = run("pixi", ["run", "--color", "never", task], {
    cwd: dir,
    env: { NO_COLOR: "1" },
  });

  return r.code === -1 && /ENOENT/.test(r.stderr) ? null : r;
}

export const NO_PIXI =
  "pixi (which installs the project's pinned Mojo toolchain) is not installed on the capture host.";

/** @returns {Artifact} */
export function mojoTestRun(
  /** @type {string} */ dir,
  /** @type {string} */ id,
  /** @type {string} */ title,
) {
  const r = pixiTask(dir, "test-mojo");
  if (!r) return unavailable(id, "test-run", title, NO_PIXI);

  return /** @type {Artifact} */ ({
    id,
    kind: "test-run",
    title,
    runner: "mojo",
    ...withLog(parseMojoTests(r.stdout + r.stderr, r.code)),
    provenance: { mode: "captured", command: "pixi run test-mojo" },
  });
}
