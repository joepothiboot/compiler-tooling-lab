import { AST_KINDS, TRACE_FORMAT, TRACE_VERSION } from "./constants.js";

/**
 * @typedef {object} Pos
 * @property {number} offset
 * @property {number} line
 * @property {number} column
 */
/** @typedef {{ begin: Pos, end: Pos }} Range */
/** @typedef {{ kind: string, text: string, range: Range }} Token */
/**
 * @typedef {object} AstNode
 * @property {number} id
 * @property {"schema" | "property" | "keyword"} kind
 * @property {Range} range
 * @property {AstNode[]} children
 * @property {string} [name]
 * @property {string} [keyword]
 * @property {string} [category]
 * @property {unknown} [value]
 * @property {string} [spelling]
 */
/** @typedef {{ severity: string, message: string, range: Range | null, notes?: Diag[] }} Diag */
/**
 * @typedef {object} Op
 * @property {number} id
 * @property {string} name
 * @property {number | null} parent
 * @property {{ line: number, column: number } | null} irPos
 * @property {number[]} astNodes
 * @property {Range[]} ranges
 */
/** @typedef {{ name: string, ir: string, ops: Op[] }} TraceStage */
/**
 * @typedef {object} Trace
 * @property {"json-schema-mlir-trace"} format
 * @property {number} version
 * @property {{ file: string, text: string }} source
 * @property {Token[]} tokens
 * @property {AstNode | null} ast
 * @property {Diag[]} diagnostics
 * @property {TraceStage[]} stages
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (/** @type {unknown} */ v) => Number.isInteger(v);

/**
 * @param {unknown} t
 * @returns {string[]}
 */
export function validateTrace(t) {
  /** @type {string[]} */
  const errs = [];
  if (!isObj(t)) return ["trace: not an object"];

  if (t.format !== TRACE_FORMAT) {
    errs.push(`trace.format must be "${TRACE_FORMAT}"`);
  }

  if (t.version !== TRACE_VERSION) {
    errs.push(
      `trace.version is ${t.version}; this viewer reads version ${TRACE_VERSION}`,
    );
  }

  if (errs.length) return errs;

  const src = t.source;

  if (
    !isObj(src) ||
    typeof src.file !== "string" ||
    typeof src.text !== "string"
  ) {
    return ["trace.source needs file and text"];
  }

  const bytes = enc.encode(src.text);

  /**
   * @param {any} r
   * @param {string} at
   */
  const checkRange = (r, at) => {
    const ok =
      isObj(r) &&
      ["begin", "end"].every(
        (k) =>
          isObj(r[k]) &&
          isInt(r[k].offset) &&
          r[k].offset >= 0 &&
          isInt(r[k].line) &&
          r[k].line >= 1 &&
          isInt(r[k].column) &&
          r[k].column >= 1,
      ) &&
      r.begin.offset <= r.end.offset &&
      r.end.offset <= bytes.length;

    if (!ok) errs.push(`${at}: bad range ${JSON.stringify(r)}`);

    return ok;
  };

  if (!Array.isArray(t.tokens) || t.tokens.length === 0) {
    errs.push("trace.tokens must be a non-empty array");
  } else {
    let prev = 0;

    t.tokens.forEach((/** @type {any} */ k, /** @type {number} */ i) => {
      const at = `trace.tokens[${i}]`;

      if (
        !isObj(k) ||
        typeof k.kind !== "string" ||
        typeof k.text !== "string"
      ) {
        return void errs.push(`${at}: needs kind and text`);
      }

      if (!checkRange(k.range, at)) return;

      const { begin, end } = k.range;

      if (begin.offset < prev) {
        errs.push(`${at}: tokens must be in source order without overlap`);
      }

      prev = end.offset;

      if (
        k.kind !== "eof" &&
        dec.decode(bytes.subarray(begin.offset, end.offset)) !== k.text
      ) {
        errs.push(`${at}: text does not match the source bytes it covers`);
      }
    });
  }

  /** @type {Set<number>} */
  const astIds = new Set();

  /**
   * @param {any} n
   * @param {string} at
   */
  const walk = (n, at) => {
    if (!isObj(n) || !isInt(n.id) || !AST_KINDS.includes(n.kind)) {
      return void errs.push(`${at}: bad AST node`);
    }

    if (astIds.has(n.id)) errs.push(`${at}: duplicate AST id ${n.id}`);
    astIds.add(n.id);
    checkRange(n.range, `${at}#${n.id}`);

    if (!Array.isArray(n.children)) {
      return void errs.push(`${at}#${n.id}: children must be an array`);
    }

    for (const c of n.children) walk(c, `${at}#${n.id}`);
  };

  if (t.ast !== null) walk(t.ast, "trace.ast");

  if (!Array.isArray(t.diagnostics)) {
    errs.push("trace.diagnostics must be an array");
  } else {
    /**
     * @param {any} d
     * @param {string} at
     */
    const diag = (d, at) => {
      if (
        !isObj(d) ||
        typeof d.severity !== "string" ||
        typeof d.message !== "string"
      ) {
        return void errs.push(`${at}: needs severity and message`);
      }

      if (d.range !== null) checkRange(d.range, at);
      for (const n of d.notes ?? []) diag(n, `${at}.notes`);
    };

    t.diagnostics.forEach((/** @type {any} */ d, /** @type {number} */ i) =>
      diag(d, `trace.diagnostics[${i}]`),
    );
  }

  if (!Array.isArray(t.stages)) {
    errs.push("trace.stages must be an array");
  } else {
    for (const s of t.stages) {
      const at = `trace.stages[${s?.name}]`;

      if (
        !isObj(s) ||
        typeof s.name !== "string" ||
        typeof s.ir !== "string" ||
        !Array.isArray(s.ops)
      ) {
        errs.push(`${at}: needs name, ir and ops`);
        continue;
      }

      const lines = s.ir.replace(/\n$/, "").split("\n").length;
      const ids = new Set();

      for (const op of s.ops) {
        const o = `${at}.ops#${op?.id}`;

        if (!isObj(op) || !isInt(op.id) || typeof op.name !== "string") {
          errs.push(`${o}: bad op`);
          continue;
        }

        if (ids.has(op.id)) errs.push(`${o}: duplicate op id`);

        if (op.parent !== null && !ids.has(op.parent)) {
          errs.push(`${o}: parent ${op.parent} does not precede it`);
        }

        ids.add(op.id);

        if (
          op.irPos !== null &&
          !(
            isObj(op.irPos) &&
            isInt(op.irPos.line) &&
            op.irPos.line >= 1 &&
            op.irPos.line <= lines
          )
        ) {
          errs.push(`${o}: irPos is outside the IR text`);
        }

        if (
          !Array.isArray(op.astNodes) ||
          !Array.isArray(op.ranges) ||
          op.astNodes.length !== op.ranges.length
        ) {
          errs.push(`${o}: astNodes and ranges must be arrays of equal length`);
          continue;
        }

        for (const id of op.astNodes) {
          if (!astIds.has(id)) errs.push(`${o}: no AST node ${id}`);
        }

        op.ranges.forEach((/** @type {any} */ r) => checkRange(r, o));
      }
    }
  }

  return errs;
}

/** @param {string} text */
export function byteSlicer(text) {
  const bytes = enc.encode(text);

  return (/** @type {number} */ a, /** @type {number} */ b) =>
    dec.decode(bytes.subarray(a, b));
}

/**
 * @param {AstNode | null} ast
 * @returns {{ node: AstNode, parent: number | null, depth: number }[]}
 */
export function flattenAst(ast) {
  /** @type {{ node: AstNode, parent: number | null, depth: number }[]} */
  const out = [];

  /**
   * @param {AstNode} n
   * @param {number | null} parent
   * @param {number} depth
   */
  const go = (n, parent, depth) => {
    out.push({ node: n, parent, depth });
    for (const c of n.children) go(c, n.id, depth + 1);
  };

  if (ast) go(ast, null, 0);

  return out;
}

/**
 * @param {string[]} before
 * @param {string[]} after
 * @param {(i: number, j: number) => boolean} related
 * @returns {{ before: number | null, after: number | null, group: number | null }[]}
 */
export function alignLines(before, after, related = () => false) {
  const n = before.length;
  const m = after.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        before[i] === after[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  /** @type {{ before: number | null, after: number | null, group: number | null }[]} */
  const rows = [];
  let groups = 0;
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      rows.push({ before: i++, after: j++, group: null });
      continue;
    }

    /** @type {number[]} */
    const del = [];
    /** @type {number[]} */
    const add = [];

    while ((i < n || j < m) && !(i < n && j < m && before[i] === after[j])) {
      if (j >= m || (i < n && lcs[i + 1][j] >= lcs[i][j + 1])) del.push(i++);
      else add.push(j++);
    }

    /** @type {Map<number, number>} */
    const placed = new Map();

    for (const d of del) {
      const targets = add.filter((a) => related(d, a));
      const fresh = targets.find((a) => !placed.has(a));
      const first = fresh ?? targets[0];

      if (first !== undefined && fresh === undefined) {
        rows.push({ before: d, after: null, group: placed.get(first) ?? null });
      } else if (fresh !== undefined) {
        placed.set(fresh, groups);
        rows.push({ before: d, after: fresh, group: groups++ });
      } else {
        rows.push({ before: d, after: null, group: null });
      }
    }

    for (const a of add) {
      if (!placed.has(a)) rows.push({ before: null, after: a, group: null });
    }
  }

  return rows;
}
