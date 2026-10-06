import { esc } from "./esc.js";
import { alignLines, byteSlicer, flattenAst } from "./trace.js";

/** @typedef {import("./trace.js").Trace} Trace */
/** @typedef {import("./trace.js").AstNode} AstNode */
/** @typedef {import("./trace.js").Range} Range */

const loc = (/** @type {Range} */ r) =>
  r.begin.line === r.end.line
    ? `${r.begin.line}:${r.begin.column}-${r.end.column}`
    : `${r.begin.line}:${r.begin.column}-${r.end.line}:${r.end.column}`;

const irLines = (/** @type {string} */ ir) => ir.replace(/\n$/, "").split("\n");

/** @param {unknown} v */
function valueText(v) {
  if (v === undefined) return "";

  const s = JSON.stringify(v);

  return s.length > 36 ? `${s.slice(0, 35)}…` : s;
}

/**
 * @param {Trace} t
 * @param {(a: number, b: number) => string} slice
 */
function renderSource(t, slice) {
  const flat = flattenAst(t.ast);

  /**
   * @param {number} b
   * @param {number} e
   */
  const deepest = (b, e) =>
    flat
      .filter(
        ({ node: n }) => n.range.begin.offset <= b && e <= n.range.end.offset,
      )
      .reduce(
        /** @type {(best: typeof flat[number] | null, x: typeof flat[number]) => typeof flat[number]} */
        (best, x) => (!best || x.depth > best.depth ? x : best),
        null,
      );

  const attrs = (/** @type {number} */ i) => {
    const k = t.tokens[i];
    const { begin, end } = k.range;
    const a = deepest(begin.offset, end.offset);

    return `data-t="${i}" data-b="${begin.offset}" data-e="${end.offset}"${a ? ` data-a="${a.node.id}"` : ""}`;
  };

  let at = 0;
  let src = "";
  /** @type {string[]} */
  const list = [];

  t.tokens.forEach((k, i) => {
    const { begin, end } = k.range;

    if (k.kind === "eof") {
      list.push(
        `<li class="tv-eof"><span class="tk">eof</span><span class="loc">${begin.line}:${begin.column}</span></li>`,
      );

      return;
    }

    src += esc(slice(at, begin.offset));
    src += `<span class="tv-t k-${esc(k.kind)}" ${attrs(i)}>${esc(k.text)}</span>`;
    at = end.offset;

    list.push(
      `<li class="tv-item" ${attrs(i)} data-loc="${loc(k.range)}"><span class="tk">${esc(k.kind)}</span><code>${esc(k.text)}</code><span class="loc">${begin.line}:${begin.column}</span></li>`,
    );
  });

  src += esc(slice(at, new TextEncoder().encode(t.source.text).length));

  return { src, list: list.join("") };
}

/**
 * @param {AstNode} n
 * @returns {string}
 */
function renderNode(n) {
  const { begin, end } = n.range;
  const name = n.keyword ?? n.name;

  const label =
    `<span class="ak">${esc(n.kind)}</span>` +
    (name === undefined ? "" : ` <span class="an">${esc(name)}</span>`) +
    (n.kind === "keyword" && n.value !== undefined
      ? ` <code class="av">${esc(n.spelling ?? valueText(n.value))}</code>`
      : "") +
    ` <span class="aid">#${n.id}</span>`;

  const attrs = `data-a="${n.id}" data-b="${begin.offset}" data-e="${end.offset}" data-loc="${loc(n.range)}"`;

  if (n.children.length === 0) {
    return `<li><div class="tv-item tv-leaf" ${attrs}><span class="tw" aria-hidden="true"></span>${label}</div></li>`;
  }

  return `<li><details open><summary class="tv-item" ${attrs}><span class="tw" aria-hidden="true"></span>${label}</summary><ul>${n.children.map(renderNode).join("")}</ul></details></li>`;
}

/**
 * @param {Trace} t
 * @returns {{ html: string, summary: string }}
 */
function renderIr(t) {
  const before = t.stages.find((s) => s.name === "import");
  const after = t.stages.find((s) => s.name === "schema-canonicalize");

  if (!before || !after) {
    throw new Error(
      "trace has no import and schema-canonicalize stages to show as a diff",
    );
  }

  const bl = irLines(before.ir);
  const al = irLines(after.ir);

  /** @param {import("./trace.js").TraceStage} s */
  const opByLine = (s) =>
    new Map(s.ops.filter((o) => o.irPos).map((o) => [o.irPos?.line ?? 0, o]));

  const bOps = opByLine(before);
  const aOps = opByLine(after);

  const parent = new Map(
    flattenAst(t.ast).map(({ node, parent: p }) => [node.id, p]),
  );

  const rootId = t.ast?.id;

  const covers = (/** @type {number} */ x, /** @type {number} */ y) => {
    if (x === y) return true;
    if (x === rootId) return false;

    for (let p = parent.get(y); p != null; p = parent.get(p)) {
      if (p === x) return true;
    }

    return false;
  };

  /**
   * @param {number[]} xs
   * @param {number[]} ys
   */
  const relates = (xs, ys) => xs.some((x) => ys.some((y) => covers(x, y)));

  const ids = (/** @type {import("./trace.js").Op | undefined} */ o) =>
    o?.astNodes ?? [];

  const rows = alignLines(bl, al, (i, j) =>
    relates(ids(bOps.get(i + 1)), ids(aOps.get(j + 1))),
  );

  const same = new Set(
    rows
      .filter(
        (r) =>
          r.before !== null && r.after !== null && bl[r.before] === al[r.after],
      )
      .map((r) => r.before),
  );

  const sameAfter = new Set(
    rows
      .filter(
        (r) =>
          r.before !== null && r.after !== null && bl[r.before] === al[r.after],
      )
      .map((r) => r.after),
  );

  /**
   * @param {string} stage
   * @param {string[]} lines
   * @param {Map<number, import("./trace.js").Op>} ops
   */
  const line = (
    stage,
    lines,
    ops,
    /** @type {number} */ i,
    /** @type {number | null} */ g,
    /** @type {string} */ state,
  ) => {
    const op = ops.get(i + 1);

    const attrs = op
      ? ` data-a="${op.astNodes.join(" ")}" data-op="${esc(op.name)}"`
      : "";

    return `<div class="tv-line ${state}${g === null ? "" : ` g${g % 4}`}" data-s="${stage}" data-l="${i + 1}"${g === null ? "" : ` data-g="${g}"`}${attrs}>${esc(lines[i])}</div>`;
  };

  const pad = '<div class="tv-line pad" aria-hidden="true"></div>';

  let left = "";
  let right = "";

  for (const r of rows) {
    left +=
      r.before === null
        ? pad
        : line(
            "import",
            bl,
            bOps,
            r.before,
            r.group,
            same.has(r.before) ? "same" : "del",
          );

    right +=
      r.after === null
        ? pad
        : line(
            "canon",
            al,
            aOps,
            r.after,
            r.group,
            sameAfter.has(r.after) ? "same" : "add",
          );
  }

  const removed = bl.length - same.size;
  const added = al.length - sameAfter.size;

  const fused = after.ops.filter((o) => o.astNodes.length > 1);

  const fusedText = fused
    .map(
      (o) =>
        `<code>${esc(o.name)}</code> now carries ${o.astNodes.length} AST nodes (${o.astNodes.map((id) => `#${id}`).join(", ")})`,
    )
    .join("; ");

  const summary = `<p class="tv-diffnote">Canonicalize takes ${before.ops.length} imported ops to ${after.ops.length}. ${fusedText ? `${fusedText}. ` : ""}The line diff below (${removed} lines removed, ${added} added, ${same.size} unchanged) is computed by this site's build from the two captured IR texts; the trace itself records no diff. Rows with the same coloured bar on the left are the imported ops that fused into the result beside them.</p>`;

  const col = (
    /** @type {string} */ cls,
    /** @type {string} */ head,
    /** @type {string} */ meta,
    /** @type {string} */ lines,
  ) =>
    `<div class="tv-col ${cls}"><div class="tv-colh">${head} <span class="meta">${meta}</span></div><div class="tv-lines" tabindex="0" role="group" aria-label="${esc(head)} IR">${lines}</div></div>`;

  return {
    summary,
    html: `<div class="tv-ir">${col("before", "Imported", `${before.ops.length} ops`, left)}${col("after", "Canonicalized", `${after.ops.length} ops`, right)}</div>`,
  };
}

/** @param {Trace} t */
export function renderTraceViewer(t) {
  const slice = byteSlicer(t.source.text);
  const bytes = new TextEncoder().encode(t.source.text).length;
  const { src, list } = renderSource(t, slice);

  const tree = t.ast
    ? `<ul class="tv-tree">${renderNode(t.ast)}</ul>`
    : '<p class="meta">The parser produced no AST for this input.</p>';

  const ir = renderIr(t);

  const diags = t.diagnostics.length
    ? `<p class="tv-diags">${t.diagnostics.length} diagnostic(s): ${t.diagnostics.map((d) => esc(`${d.severity}: ${d.message}`)).join("; ")}</p>`
    : "";

  const nodes = t.ast ? flattenAst(t.ast).length : 0;

  /**
   * @param {string} pane
   * @param {string} title
   * @param {string} meta
   * @param {string} body
   */
  const pane = (pane, title, meta, body) =>
    `<div class="tv-pane" data-pane="${pane}"><h5 class="tv-h">${title} <span class="meta">${meta}</span></h5><div class="pane-scroll">${body}</div></div>`;

  return `<div class="tv" data-trace-viewer>
<p class="tv-help" hidden>Hover or focus anything to see what it maps to. Click, or press Enter, to pin it; click it again or press Esc to release. Arrow keys open and close AST nodes.</p>
<div class="tv-status" role="status" aria-live="polite" hidden></div>
<div class="tv-grid">
${pane("src", "JSON source", `${esc(t.source.file)}, ${bytes} bytes`, `<pre class="tv-src" tabindex="0"><code>${src}</code></pre>`)}
${pane("tok", "Tokens", `${t.tokens.length} from the lexer`, `<ol class="tv-toks">${list}</ol>`)}
${pane("ast", "AST", `${nodes} nodes`, `<div class="tv-tools" hidden><button type="button" data-tree="open">Expand all</button><button type="button" data-tree="close">Collapse all</button></div>${tree}`)}
</div>
${diags}
<div class="tv-irwrap" data-pane="ir">
<h5 class="tv-h">IR: imported, then canonicalized</h5>
${ir.summary}
${ir.html}
</div>
</div>`;
}
