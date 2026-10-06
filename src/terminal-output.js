import { HEAT_PERCENT, PROFILE_NAME_WIDTH } from "./constants.js";

const lab = (/** @type {string} */ p) =>
  p.startsWith("lab:") ? `compiler-tooling-lab/${p.slice(4)}` : p;

export function commandOf(/** @type {Json} */ a) {
  const pv = a.provenance;
  if (pv.mode === "captured") return pv.command;
  if (pv.mode === "static") return `cat ${lab(pv.path ?? "")}`;

  return `# ${a.title}`;
}

const loc = (/** @type {Json} */ l) =>
  l ? `${lab(l.file)}:${l.line}${l.column ? `:${l.column}` : ""}` : "";

/** @typedef {any} Json */
/** @typedef {{ t: string, c?: string }} Part */
/** @typedef {{ parts: Part[], cls?: string }} Line */

export const P = (/** @type {string} */ t, /** @type {string} */ c = "") =>
  /** @type {Part} */ ({ t, c });

export const plain = (
  /** @type {string} */ t,
  /** @type {string} */ cls = "",
) => /** @type {Line} */ ({ parts: [P(t)], cls });

const ICON = /** @type {Record<string, string>} */ ({
  source: "📜",
  "ir-snapshot": "🧬",
  diagnostic: "🩺",
  execution: "⚡",
  "test-run": "🧪",
  profile: "📊",
  "pass-event": "🔀",
  trace: "🧾",
});

export const iconOf = (/** @type {Json} */ a) =>
  a.provenance.mode === "unavailable" ? "🚫" : (ICON[a.kind] ?? "📄");

/**
 * @param {string} text
 * @param {[RegExp, string[]]} rule
 * @returns {Part[]}
 */
function paint(text, [re, classes]) {
  /** @type {Part[]} */
  const parts = [];
  let at = 0;

  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) parts.push(P(text.slice(at, i)));
    parts.push(P(m[0], classes[m.slice(1).findIndex((g) => g !== undefined)]));
    at = i + m[0].length;
  }

  if (at < text.length) parts.push(P(text.slice(at)));

  return parts;
}

/** @type {[RegExp, string[]]} */
const MLIR = [
  /(\/\/.*)|("(?:[^"\\\n]|\\.)*")|([%^][\w.$#-]+)|(@[\w.$-]+)|\b((?:[a-z_]\w*\.)+[a-z_]\w*|return|module)\b|(![\w.]+|\b(?:i\d+|f\d+|bf16|index|memref|tensor|vector|none)\b)|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\btrue\b|\bfalse\b)/g,
  ["c-com", "c-str", "c-ssa", "c-sym", "c-op", "c-type", "c-num"],
];

/** @type {[RegExp, string[]]} */
const LOG = [
  /(✓|\bPASS(?:ED)?\b|\bok\b|\b[Pp]assed\b)|(✗|×|\bFAIL(?:ED)?\b|\bUNRESOLVED\b|\bERROR\b)|(\bUNSUPPORTED\b|\bXFAIL\b|\b[Ss]kipped\b)|(\b\d+(?:\.\d+)?\s?m?s\b)/g,
  ["c-pass", "c-fail", "c-skip", "c-num"],
];

/** @type {[RegExp, string[]]} */
const NUM = [/(-?\b\d+(?:\.\d+)?\b)/g, ["c-num"]];

const SEVERITY = /** @type {Record<string, [string, string]>} */ ({
  error: ["❌", "c-fail"],
  warning: ["⚠️", "c-skip"],
  note: ["💡", "c-sym"],
  remark: ["💬", "c-sym"],
});

const exit = (/** @type {number} */ code) =>
  /** @type {Line} */ ({
    parts: [
      P(code === 0 ? "✔ " : "✘ ", code === 0 ? "c-pass" : "c-fail"),
      P(`exit code ${code}`),
    ],
    cls: "dim",
  });

function heatClass(/** @type {number} */ percent) {
  if (percent >= HEAT_PERCENT.hot) return "c-fail";
  if (percent >= HEAT_PERCENT.warm) return "c-skip";

  return "c-pass";
}

function meter(/** @type {number} */ pct) {
  const eighths = Math.round((Math.max(0, Math.min(100, pct)) / 100) * 96);
  const partial = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"][eighths % 8];

  return ("█".repeat(Math.floor(eighths / 8)) + partial).padEnd(12);
}

/** @returns {Line[]} */
export function outputOf(/** @type {Json} */ a) {
  if (a.provenance.mode === "unavailable") {
    return [
      {
        parts: [P("🚫 ", "emo"), P(`not available: ${a.provenance.reason}`)],
        cls: "warn",
      },
    ];
  }

  switch (a.kind) {
    case "source":
    case "ir-snapshot":
      return [{ parts: paint(a.text, MLIR) }];
    case "diagnostic":
      return [
        ...a.entries.map((/** @type {Json} */ e) => {
          const [emo, c] = SEVERITY[e.severity] ?? ["•", ""];

          return /** @type {Line} */ ({
            parts: [
              P(`${emo} `, "emo"),
              P(loc(e.location) || "(no location)", "c-loc"),
              P(": "),
              P(e.severity, c),
              P(": "),
              P(e.message),
            ],
            cls: e.severity === "error" ? "" : "dim",
          });
        }),
        exit(a.exitCode),
      ];
    case "execution":
      return [{ parts: paint(a.stdout, NUM) }, exit(a.exitCode)];

    case "test-run": {
      const bad = a.failed || a.errors;

      return [
        { parts: paint(a.log, LOG) },
        {
          parts: [
            P(bad ? "❌ " : "✅ ", "emo"),
            P(`${a.passed} passed`, "c-pass"),
            P(", "),
            P(`${a.failed} failed`, a.failed ? "c-fail" : "dim"),
            P(", "),
            P(`${a.errors} errors`, a.errors ? "c-fail" : "dim"),
            P(", "),
            P(`${a.skipped} skipped`, a.skipped ? "c-skip" : "dim"),
            P(` (${a.runner})`, "dim"),
          ],
          cls: "summary",
        },
      ];
    }

    case "profile": {
      const w = Math.min(
        PROFILE_NAME_WIDTH,
        Math.max(
          ...a.entries.map(
            (/** @type {Json} */ e) => e.name.length + 2 * e.depth,
          ),
        ),
      );

      /** @type {Part[]} */
      const parts = [];

      a.entries.forEach((/** @type {Json} */ e, /** @type {number} */ i) => {
        const name = `${"  ".repeat(e.depth)}${e.name}`.padEnd(w).slice(0, w);

        const heat = heatClass(e.percent);

        parts.push(
          P(`${i ? "\n" : ""}${name}  `),
          P(`${e.value.toFixed(4).padStart(8)} ${a.unit}`, "c-num"),
          P("  "),
          P(`${e.percent.toFixed(1).padStart(5)}%`, heat),
          P(` ${meter(e.percent)}`, heat),
        );
      });

      return [
        { parts },
        plain(`⏱️ total ${a.total} ${a.unit} (${a.metric})`, "dim"),
      ];
    }

    case "trace": {
      const t = a.trace;

      const count = (/** @type {Json | null} */ n) =>
        n
          ? 1 +
            n.children.reduce(
              (/** @type {number} */ sum, /** @type {Json} */ c) =>
                sum + count(c),
              0,
            )
          : 0;

      return [
        plain(
          `${t.source.file}: ${t.tokens.length} tokens, ${count(t.ast)} AST nodes, ${t.diagnostics.length} diagnostics`,
        ),
        ...t.stages.map((/** @type {Json} */ s) =>
          plain(
            `${s.name}: ${s.ops.length} ops, ${s.ir.trimEnd().split("\n").length} IR lines`,
          ),
        ),
        plain("Open the trace viewer on the page to explore it.", "dim"),
      ];
    }

    case "pass-event": {
      /** @type {Line[]} */
      const out = [
        {
          parts: [
            P("🔧 ", "emo"),
            P("pass "),
            P(a.pass, "c-op"),
            P(` (#${a.index}): `, "dim"),
            a.changed ? P("changed the IR", "c-skip") : P("no change", "dim"),
          ],
        },
      ];

      if (a.diff) {
        const sign = { added: "+", removed: "-", changed: "~" };
        const cls = { added: "c-pass", removed: "c-fail", changed: "c-skip" };

        out.push({
          parts: a.diff.rows.map(
            (/** @type {Json} */ r, /** @type {number} */ i) => {
              const type = /** @type {"added" | "removed" | "changed"} */ (
                r.type
              );

              const body = {
                changed: `${r.before} -> ${r.after}`,
                added: r.after,
                removed: r.before,
              }[type];

              return P(`${i ? "\n" : ""}${sign[type]} ${body}`, cls[type]);
            },
          ),
        });
      }

      return out;
    }
  }

  return [plain(JSON.stringify(a, null, 2))];
}

export function featured(/** @type {Json[]} */ list) {
  const main = list.filter(
    (a) => a.kind !== "ir-snapshot" && a.kind !== "pass-event",
  );

  return main.length >= 3
    ? main
    : [...main, ...list.filter((a) => a.kind === "pass-event")];
}
