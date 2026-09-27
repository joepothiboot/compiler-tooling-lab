// Pure parsers for real tool output (mlir-opt-style drivers, lit).
// Used by scripts/capture.mjs; unit-tested against verbatim output in test/.

const DIAG_LINE = /^(.+?):(\d+):(\d+): (error|warning|note|remark): (.*)$/;

/**
 * Parses MLIR `file:line:col: severity: message` diagnostics.
 * @param {string} text
 * @returns {import("./model.js").DiagnosticEntry[]}
 */
export function parseDiagnostics(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    const m = DIAG_LINE.exec(line);
    if (m) {
      entries.push({
        severity: /** @type {any} */ (m[4]),
        message: m[5],
        location: { file: m[1], line: Number(m[2]), column: Number(m[3]) },
      });
    }
  }
  return entries;
}

const DUMP_HEADER = /^\/\/ -----\/\/ IR Dump After (.+?) \/\/----- \/\/$/gm;

/**
 * Splits `--mlir-print-ir-after-all` output into one entry per pass.
 * @param {string} text
 * @returns {{ pass: string, text: string }[]}
 */
export function parseIRDumps(text) {
  const headers = [...text.matchAll(DUMP_HEADER)];
  return headers.map((h, i) => {
    const start = /** @type {number} */ (h.index) + h[0].length;
    const end =
      i + 1 < headers.length
        ? /** @type {number} */ (headers[i + 1].index)
        : text.length;
    const [cls, rest = ""] = h[1]
      .replace(/\(anonymous namespace\)::/g, "")
      .split(/: (.*)/s);
    // Module-scope dumps may append " ('builtin.module' operation)" to the flag.
    const flag = rest
      .split("{")[0]
      .replace(/\s*\('[^']*' operation\)$/, "")
      .trim();
    return {
      pass: flag ? `${cls} (${flag})` : cls,
      text: text.slice(start, end).trim(),
    };
  });
}

/**
 * Parses the wall-clock table printed by `--mlir-timing`.
 * @param {string} text
 * @returns {{ total: number, entries: import("./model.js").ProfileEntry[] }}
 */
export function parseTiming(text) {
  const total = Number(
    /Total Execution Time: ([\d.]+) seconds/.exec(text)?.[1] ?? NaN,
  );
  const entries = [];
  for (const line of text.split("\n")) {
    const m = /^\s+([\d.]+) \(\s*([\d.]+)%\)(\s+)(.+)$/.exec(line);
    if (!m || m[4] === "Total") continue;
    entries.push({
      name: m[4].replace(/\(anonymous namespace\)::/g, ""),
      value: Number(m[1]),
      percent: Number(m[2]),
      depth: Math.max(0, (m[3].length - 2) / 2),
    });
  }
  return { total, entries };
}

/**
 * Parses `lit -v` output: per-test result lines plus the summary block.
 * @param {string} out
 */
export function parseLit(out) {
  /** @param {string} label */
  const n = (label) =>
    Number(new RegExp(`^\\s*${label}\\s*:\\s*(\\d+)`, "m").exec(out)?.[1] ?? 0);
  const lines = out.split("\n");
  const results = lines.filter((l) =>
    /^(PASS|FAIL|XFAIL|XPASS|UNSUPPORTED|UNRESOLVED): /.test(l),
  );
  const summary = lines.filter((l) =>
    /^(Total Discovered Tests|\s+(Passed|Failed|Unsupported|Unresolved|Expectedly Failed)\s*:)/.test(
      l,
    ),
  );
  return {
    passed: n("Passed"),
    failed: n("Failed") + n("Unresolved"),
    errors: 0,
    skipped: n("Unsupported"),
    log: [...results, "", ...summary].join("\n").trim(),
  };
}
