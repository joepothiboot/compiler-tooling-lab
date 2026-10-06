import { REDUCED_MOTION } from "./constants.js";

const ITEM = ".tv-t, .tv-toks .tv-item, .tv-tree .tv-item, .tv-line[data-a]";
const LINE_LABEL = { import: "imported", canon: "canonicalized" };

function targetIndex(
  /** @type {string} */ key,
  /** @type {number} */ at,
  /** @type {number} */ count,
) {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;

  const step = key === "ArrowDown" ? 1 : -1;

  return Math.min(count - 1, Math.max(0, at + step));
}

/** @typedef {{ b: number, e: number, els: HTMLElement[] }} Tok */
/** @typedef {{ el: HTMLElement, stage: string, ids: number[], group: string | null }} Line */
/**
 * @typedef {object} Sel
 * @property {string} key
 * @property {HTMLElement[]} origin
 * @property {Set<number>} tokens
 * @property {Set<number>} asts
 * @property {Set<HTMLElement>} lines
 * @property {string} head
 * @property {string} where
 */

const reduceMotion = matchMedia(REDUCED_MOTION);
let suppressCancel = false;

document.addEventListener(
  "cancel",
  (e) => {
    if (suppressCancel && e.target instanceof HTMLDialogElement) {
      e.preventDefault();
    }
  },
  true,
);

/**
 * @param {HTMLElement} box
 * @param {HTMLElement} el
 */
function nudge(box, el) {
  const c = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < c.top) box.scrollTop -= c.top - r.top + 8;
  else if (r.bottom > c.bottom) box.scrollTop += r.bottom - c.bottom + 8;
  if (r.left < c.left) box.scrollLeft -= c.left - r.left + 8;
  else if (r.right > c.right) box.scrollLeft += r.right - c.right + 8;
}

/** @param {HTMLElement} el */
function reveal(el) {
  for (const sel of [".tv-src, .tv-lines", ".pane-scroll, .tv-ir"]) {
    const box = /** @type {HTMLElement | null} */ (el.closest(sel));
    if (box) nudge(box, el);
  }
}

/** @param {Element} el */
function outerDetails(el) {
  const own = el.tagName === "SUMMARY";

  return (own ? el.parentElement?.parentElement : el.parentElement)?.closest(
    "details",
  );
}

/** @param {HTMLElement} el */
function astHidden(el) {
  for (let d = outerDetails(el); d; d = outerDetails(d)) {
    if (!d.open) return true;
  }

  return false;
}

/** @param {HTMLElement} root */
function init(root) {
  root.classList.add("live");

  for (const el of root.querySelectorAll("[hidden]")) {
    el.removeAttribute("hidden");
  }

  const num = (/** @type {string | undefined} */ v) => Number(v);

  /** @type {Tok[]} */
  const toks = [];

  for (const el of root.querySelectorAll("[data-t]")) {
    const h = /** @type {HTMLElement} */ (el);

    const t = (toks[num(h.dataset.t)] ??= {
      b: num(h.dataset.b),
      e: num(h.dataset.e),
      els: [],
    });

    t.els.push(h);
  }

  const astItems = /** @type {HTMLElement[]} */ ([
    ...root.querySelectorAll(".tv-tree .tv-item"),
  ]);

  /** @type {Map<number, HTMLElement>} */
  const astById = new Map(astItems.map((el) => [num(el.dataset.a), el]));

  /** @type {Map<number, Set<number>>} */
  const subtree = new Map(
    astItems.map((el) => [
      num(el.dataset.a),
      new Set(
        [...(el.closest("li")?.querySelectorAll(".tv-item") ?? [])].map((x) =>
          num(/** @type {HTMLElement} */ (x).dataset.a),
        ),
      ),
    ]),
  );

  /** @type {Line[]} */
  const lines = [...root.querySelectorAll(".tv-line[data-s]")].map((el) => {
    const h = /** @type {HTMLElement} */ (el);

    return {
      el: h,
      stage: h.dataset.s ?? "",
      ids: (h.dataset.a ?? "").split(" ").filter(Boolean).map(Number),
      group: h.dataset.g ?? null,
    };
  });

  const lineOf = new Map(lines.map((l) => [l.el, l]));

  /**
   * @param {number} b
   * @param {number} e
   */
  const tokensIn = (b, e) =>
    toks.flatMap((t, i) => (t && t.b >= b && t.e <= e ? [i] : []));

  /** @param {number} id */
  const rangeOf = (id) => {
    const el = astById.get(id);

    return el ? tokensIn(num(el.dataset.b), num(el.dataset.e)) : [];
  };

  /**
   * @param {HTMLElement} el
   * @returns {Sel | null}
   */
  function relate(el) {
    if (el.dataset.t !== undefined) {
      const i = num(el.dataset.t);
      const focus = el.dataset.a === undefined ? null : num(el.dataset.a);
      const kind = toks[i].els.find((x) => x.classList.contains("tv-item"));
      const head = `Token ${kind?.querySelector(".tk")?.textContent ?? ""} ${kind?.querySelector("code")?.textContent ?? ""}`;
      const under = focus === null ? null : subtree.get(focus);

      return {
        key: `t${i}`,
        origin: toks[i].els,
        tokens: new Set(focus === null ? [i] : rangeOf(focus)),
        asts: new Set(focus === null ? [] : [focus]),
        lines: new Set(
          lines
            .filter((l) => under && l.ids.some((x) => under.has(x)))
            .map((l) => l.el),
        ),
        head,
        where: `at ${el.dataset.loc ?? ""}`,
      };
    }

    const line = lineOf.get(el);

    if (line) {
      const ids = new Set(line.ids);

      const rel = lines.filter(
        (l) =>
          l.ids.some((x) => ids.has(x)) ||
          (line.group !== null && l.group === line.group),
      );

      return {
        key: `l${line.stage}:${el.dataset.l}`,
        origin: [el],
        tokens: new Set(line.ids.flatMap(rangeOf)),
        asts: ids,
        lines: new Set(rel.map((l) => l.el)),
        head: `IR ${LINE_LABEL[/** @type {"import" | "canon"} */ (line.stage)]} line ${el.dataset.l}: ${el.dataset.op}`,
        where: "",
      };
    }

    if (el.dataset.a !== undefined && astById.has(num(el.dataset.a))) {
      const id = num(el.dataset.a);
      const under = subtree.get(id) ?? new Set();

      return {
        key: `a${id}`,
        origin: [el],
        tokens: new Set(rangeOf(id)),
        asts: new Set([id]),
        lines: new Set(
          lines.filter((l) => l.ids.some((x) => under.has(x))).map((l) => l.el),
        ),
        head: `AST ${(el.textContent ?? "").replace(/\s+/g, " ").trim()}`,
        where: `at ${el.dataset.loc ?? ""}`,
      };
    }

    return null;
  }

  const status = /** @type {HTMLElement} */ (root.querySelector(".tv-status"));
  const chips = document.createElement("div");
  chips.className = "tv-chips";

  for (const [pane, label] of [
    ["src", "Source"],
    ["tok", "Tokens"],
    ["ast", "AST"],
    ["ir", "IR"],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;

    b.addEventListener("click", () =>
      root.querySelector(`[data-pane="${pane}"]`)?.scrollIntoView({
        block: "start",
        behavior: reduceMotion.matches ? "auto" : "smooth",
      }),
    );

    chips.append(b);
  }

  const text = document.createElement("div");
  text.className = "tv-st";
  status.append(text, chips);

  /** @type {Element[]} */
  let marked = [];
  /** @type {Sel | null} */
  let pinned = null;
  /** @type {Sel | null} */
  let hover = null;

  /** @param {Sel | null} sel */
  function paint(sel) {
    for (const el of marked) el.classList.remove("hl", "sel", "has-hl");
    marked = [];

    /**
     * @param {Element | undefined} el
     * @param {string} c
     */
    const mark = (el, c) => {
      if (!el) return;
      el.classList.add(c);
      marked.push(el);
    };

    text.replaceChildren();

    if (!sel) {
      text.append(
        Object.assign(document.createElement("p"), {
          className: "tv-empty",
          textContent: pinned
            ? ""
            : "Hover or tap an item to see what it maps to.",
        }),
      );

      return;
    }

    for (const i of sel.tokens) for (const el of toks[i].els) mark(el, "hl");

    for (const id of sel.asts) {
      const el = astById.get(id);
      mark(el, "hl");

      for (
        let d = el && outerDetails(el);
        d;
        d = d.parentElement?.closest("details")
      ) {
        if (!d.open) {
          mark(d.querySelector(":scope > summary") ?? undefined, "has-hl");
        }
      }
    }

    for (const el of sel.lines) mark(el, "hl");
    for (const el of sel.origin) mark(el, "sel");

    const count = (/** @type {string} */ stage) =>
      [...sel.lines].filter((l) => l.dataset.s === stage).length;

    const b = count("import");
    const a = count("canon");
    const head = document.createElement("p");
    head.className = "tv-st-head";
    head.textContent = sel.head;

    const facts = document.createElement("p");
    facts.className = "tv-st-facts";

    facts.textContent = [
      sel.where,
      `${sel.tokens.size} token(s)`,
      `${sel.asts.size} AST node(s)`,
      `IR: ${b} imported, ${a} canonicalized line(s)`,
    ]
      .filter(Boolean)
      .join(" · ");

    text.append(head, facts);

    if (sel === pinned) {
      const note = document.createElement("p");
      note.className = "tv-st-pin";
      note.textContent = "Pinned. Click it again or press Esc to release.";
      text.append(note);
    }
  }

  const show = () => {
    for (const el of root.querySelectorAll("[aria-pressed]")) {
      el.removeAttribute("aria-pressed");
    }

    for (const el of pinned?.origin ?? []) {
      el.setAttribute("aria-pressed", "true");
    }

    paint(hover ?? pinned);
  };

  function unpin() {
    pinned = null;
    show();
  }

  /** @param {HTMLElement} el */
  function pin(el) {
    const sel = relate(el);
    if (!sel) return;
    if (pinned?.key === sel.key) return unpin();
    pinned = sel;
    hover = null;

    for (const id of sel.asts) {
      const item = astById.get(id);

      for (
        let d = item && outerDetails(item);
        d;
        d = d.parentElement?.closest("details")
      ) {
        d.open = true;
      }
    }

    show();

    const from = el.closest("[data-pane]");

    for (const pane of root.querySelectorAll("[data-pane]")) {
      if (pane === from) continue;

      const first = pane.querySelector(".hl");
      if (first) reveal(/** @type {HTMLElement} */ (first));
    }
  }

  const itemAt = (/** @type {EventTarget | null} */ t) =>
    t instanceof Element
      ? /** @type {HTMLElement | null} */ (t.closest(ITEM))
      : null;

  for (const el of root.querySelectorAll(ITEM)) {
    const h = /** @type {HTMLElement} */ (el);
    if (h.classList.contains("tv-t")) continue;
    h.setAttribute("role", "button");
    if (h.tagName !== "SUMMARY") h.tabIndex = -1;
  }

  for (const group of root.querySelectorAll(".tv-toks, .tv-lines")) {
    group.removeAttribute("tabindex");

    const first = group.querySelector(ITEM);
    if (first instanceof HTMLElement) first.tabIndex = 0;
  }

  for (const el of astItems) if (el.tagName !== "SUMMARY") el.tabIndex = 0;

  root.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;

    const el = itemAt(e.target);
    hover = el ? relate(el) : null;
    show();
  });

  root.addEventListener("pointerleave", () => {
    hover = null;
    show();
  });

  root.addEventListener("focusin", (e) => {
    const el = itemAt(e.target);
    if (!el) return;
    hover = relate(el);
    show();
  });

  root.addEventListener("focusout", () => {
    hover = null;
    show();
  });

  root.addEventListener("click", (e) => {
    const el = itemAt(e.target);
    if (!el) return;

    if (el.tagName === "SUMMARY") {
      e.preventDefault();

      const d = /** @type {HTMLDetailsElement} */ (el.parentElement);

      if (e.target instanceof Element && e.target.closest(".tw")) {
        d.open = !d.open;
        show();

        return;
      }
    }

    pin(el);
  });

  root.addEventListener("keydown", (e) => {
    const el = itemAt(e.target);

    if (e.key === "Escape" && pinned) {
      e.preventDefault();
      suppressCancel = true;
      setTimeout(() => (suppressCancel = false), 0);
      unpin();

      return;
    }

    if (!el || e.altKey || e.ctrlKey || e.metaKey) return;

    if (
      (e.key === "Enter" || e.key === " ") &&
      el.tagName !== "SUMMARY" &&
      !el.classList.contains("tv-t")
    ) {
      e.preventDefault();
      pin(el);

      return;
    }

    const inTree = el.closest(".tv-tree");
    const group = inTree ?? el.closest(".tv-toks, .tv-lines");
    if (!group) return;

    const d =
      el.tagName === "SUMMARY"
        ? /** @type {HTMLDetailsElement} */ (el.parentElement)
        : null;

    if (inTree && e.key === "ArrowRight" && d && !d.open) {
      d.open = true;
    } else if (inTree && e.key === "ArrowLeft" && d?.open) {
      d.open = false;
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      const all = /** @type {HTMLElement[]} */ ([
        ...group.querySelectorAll(ITEM),
      ]).filter((x) => !astHidden(x));

      const at = all.indexOf(el);

      const next = targetIndex(e.key, at, all.length);

      for (const x of all) {
        if (x.tagName !== "SUMMARY") x.tabIndex = x === all[next] ? 0 : -1;
      }

      all[next].focus();
    } else {
      return;
    }

    e.preventDefault();
    show();
  });

  for (const b of root.querySelectorAll("[data-tree]")) {
    b.addEventListener("click", () => {
      const open = /** @type {HTMLElement} */ (b).dataset.tree === "open";

      for (const d of root.querySelectorAll(".tv-tree details")) {
        /** @type {HTMLDetailsElement} */ (d).open = open;
      }

      show();
    });
  }

  show();
}

for (const el of document.querySelectorAll(".no-js-only")) el.remove();

for (const root of document.querySelectorAll("[data-trace-viewer]")) {
  init(/** @type {HTMLElement} */ (root));
}

export {};
