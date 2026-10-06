import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../root.mjs";
import { parseVitest } from "../../src/parse.js";
import { run, srcDir, unavailable, withLog } from "./common.mjs";

/** @typedef {import("../../src/model.js").Artifact} Artifact */

/** @returns {Promise<Artifact[]>} */
export async function captureVizmlir() {
  const dir = srcDir("vizmlir");
  const wasm = path.join(dir, "public/mlir_core.wasm");

  if (!fs.existsSync(wasm)) {
    const reason =
      "mlir_core.wasm did not build at the pinned commit; see the capture job log.";

    return [
      unavailable(
        "viz-schema-canonicalize-diff",
        "pass-event",
        "VizMLIR diff",
        reason,
      ),
    ];
  }

  const { MlirEngine } = await import(
    pathToFileURL(path.join(dir, "src/wasm/bridge.js")).href
  );

  const { copySnapshot, diffSnapshots } = await import(
    pathToFileURL(path.join(dir, "src/diff.js")).href
  );

  const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasm), {});
  const engine = new MlirEngine(instance);

  const parse = (/** @type {string} */ text) => {
    const status = engine.parse(text);

    if (status !== 0) {
      throw new Error(`VizMLIR parse failed: ${engine.statusText}`);
    }

    const snap = engine.snapshot();

    return {
      copy: copySnapshot(snap),
      graph: {
        nodes: snap.nodeCount,
        edges: snap.edgeCount,
        diagnostics: snap.diagnostics().map((/** @type {any} */ d) => ({
          message: d.message,
          line: d.line,
          symbol: d.symbol,
        })),
      },
    };
  };

  /** @type {Map<string, any>} */
  const byId = new Map();

  for (const id of ["schema-mlir", "nano-dsp-mlir"]) {
    const f = path.join(ROOT, "artifacts", `${id}.json`);

    if (fs.existsSync(f)) {
      for (const a of JSON.parse(fs.readFileSync(f, "utf8")).artifacts) {
        byId.set(a.id, a);
      }
    }
  }

  const eventFor = (/** @type {string} */ prefix, /** @type {RegExp} */ pass) =>
    [...byId.values()].find(
      (a) =>
        a.kind === "pass-event" &&
        a.id.startsWith(prefix) &&
        pass.test(a.pass) &&
        a.changed,
    );

  const pairs = [
    {
      id: "viz-schema-canonicalize-diff",
      title: "json-schema-mlir canonicalization, diffed by VizMLIR",
      ev: eventFor("schema-pass", /SchemaCanonicalizerPass/),
    },
    {
      id: "viz-schema-lowering-diff",
      title: "json-schema-mlir lowering to std, diffed by VizMLIR",
      ev: eventFor("schema-pass", /LowerSchemaToStandard/),
    },
    {
      id: "viz-nano-linalg-diff",
      title: "nano-dsp-mlir dsp → linalg, diffed by VizMLIR",
      ev: eventFor("nano-pass", /DSPToLinalg|dsp-to-linalg/i),
    },
  ];

  /** @type {Artifact[]} */
  const out = [];

  const command =
    "node scripts/capture.mjs (imports VizMLIR src/wasm/bridge.js, src/diff.js and runs public/mlir_core.wasm)";

  for (const { id, title, ev } of pairs) {
    if (!ev) {
      out.push(
        unavailable(
          id,
          "pass-event",
          title,
          "The upstream pass event was not captured, so there is nothing to diff.",
        ),
      );

      continue;
    }

    const before = parse(byId.get(ev.before).text);
    const after = parse(byId.get(ev.after).text);

    const rows = diffSnapshots(before.copy, after.copy).map(
      (/** @type {any} */ r) => ({
        type: r.type,
        before: r.before?.label,
        after: r.after?.label,
      }),
    );

    out.push({
      id,
      kind: "pass-event",
      title,
      pass: ev.pass,
      index: ev.index,
      changed: true,
      before: ev.before,
      after: ev.after,
      diff: {
        tool: "VizMLIR diffSnapshots",
        rows,
        beforeGraph: before.graph,
        afterGraph: after.graph,
      },
      provenance: { mode: "captured", command },
    });
  }

  const t = run("npx", ["vitest", "run"], {
    cwd: dir,
    env: { CI: "1", NO_COLOR: "1" },
  });

  out.push(
    /** @type {Artifact} */ ({
      id: "viz-tests",
      kind: "test-run",
      title: "Unit tests (vitest)",
      runner: "vitest",
      ...withLog(parseVitest(t.stdout + t.stderr)),
      provenance: { mode: "captured", command: "npx vitest run" },
    }),
  );

  return out;
}
