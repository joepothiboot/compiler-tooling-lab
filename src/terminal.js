// Progressive enhancement: a floating terminal docked at the bottom of every
// page. It replays the outputs captured at each project's pinned commit
// (artifacts/*.json); nothing runs live and nothing is invented. Each result
// is headed by the exact command and where the capture came from.

/** @typedef {any} Json */

const base = document.body.dataset.base ?? "";
const root = document.documentElement;
/** Wide enough for the side-by-side split; must match the CSS breakpoint. */
const WIDE = "(min-width: 900px)";
/** Bounds for the terminal's share of the window width. */
const MIN = 0.25;
const MAX = 0.75;
const store = {
  get: (/** @type {string} */ k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (/** @type {string} */ k, /** @type {string} */ v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Storage can be blocked; the terminal still works for this page view.
    }
  },
};

const el = (
  /** @type {string} */ tag,
  /** @type {string} */ cls = "",
  /** @type {string} */ text = "",
) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

// ---------------------------------------------------------------------------
// Formatting captured artifacts as terminal text

const lab = (/** @type {string} */ p) =>
  p.startsWith("lab:") ? `compiler-tooling-lab/${p.slice(4)}` : p;

/** The command a reader would type to reproduce this artifact. */
function commandOf(/** @type {Json} */ a) {
  const pv = a.provenance;
  if (pv.mode === "captured") return pv.command;
  if (pv.mode === "static") return `cat ${lab(pv.path ?? "")}`;
  return `# ${a.title}`;
}

const loc = (/** @type {Json} */ l) =>
  l ? `${lab(l.file)}:${l.line}${l.column ? `:${l.column}` : ""}` : "";

/**
 * A run of text with an optional colour class. Emoji parts use "emo", which
 * hides them from screen readers since the words next to them say the same.
 * @typedef {{ t: string, c?: string }} Part
 * @typedef {{ parts: Part[], cls?: string }} Line
 */

const P = (/** @type {string} */ t, /** @type {string} */ c = "") =>
  /** @type {Part} */ ({ t, c });
const plain = (/** @type {string} */ t, /** @type {string} */ cls = "") =>
  /** @type {Line} */ ({ parts: [P(t)], cls });

/** Emoji per artifact kind, used on chips and in "ls". */
const ICON = /** @type {Record<string, string>} */ ({
  source: "📜",
  "ir-snapshot": "🧬",
  diagnostic: "🩺",
  execution: "⚡",
  "test-run": "🧪",
  profile: "📊",
  "pass-event": "🔀",
});
const iconOf = (/** @type {Json} */ a) =>
  a.provenance.mode === "unavailable" ? "🚫" : (ICON[a.kind] ?? "📄");

/**
 * Split text into parts, colouring each match of `re` by which of its capture
 * groups matched. Only ever sets textContent later, so nothing is parsed as HTML.
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

/** A 12-cell bar for a percentage, in eighths so small shares still show. */
function meter(/** @type {number} */ pct) {
  const eighths = Math.round((Math.max(0, Math.min(100, pct)) / 100) * 96);
  const partial = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"][eighths % 8];
  return ("█".repeat(Math.floor(eighths / 8)) + partial).padEnd(12);
}

/** @returns {Line[]} */
function outputOf(/** @type {Json} */ a) {
  if (a.provenance.mode === "unavailable")
    return [
      {
        parts: [P("🚫 ", "emo"), P(`not available: ${a.provenance.reason}`)],
        cls: "warn",
      },
    ];
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
        44,
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
        const heat =
          e.percent >= 30 ? "c-fail" : e.percent >= 10 ? "c-skip" : "c-pass";
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
              const body =
                type === "changed"
                  ? `${r.before} -> ${r.after}`
                  : type === "added"
                    ? r.after
                    : r.before;
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

/** Artifacts offered as one-click chips: the ones people usually want. */
function featured(/** @type {Json[]} */ list) {
  const main = list.filter(
    (a) => a.kind !== "ir-snapshot" && a.kind !== "pass-event",
  );
  return main.length >= 3
    ? main
    : [...main, ...list.filter((a) => a.kind === "pass-event")];
}

// ---------------------------------------------------------------------------
// The dock

async function start() {
  /** @type {Json} */
  const manifest = await fetch(`${base}manifest.json`).then((r) => r.json());
  const projects = /** @type {Json[]} */ (manifest.projects);
  /** @type {Map<string, Json>} */
  const cache = new Map();
  let current =
    projects.find((p) => p.id === document.body.dataset.project) ??
    projects.find((p) => p.id === store.get("term-project")) ??
    projects[0];
  /** @type {Json[]} */
  let list = [];
  /** @type {string[]} */
  const history = [];
  let hist = 0;

  const dock = el("section", "term");
  dock.setAttribute("aria-label", "Terminal");
  const bar = el("div", "term-bar");
  const toggle = el("button", "term-toggle");
  toggle.setAttribute("type", "button");
  toggle.innerHTML =
    '<span class="term-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
    '<span class="term-glyph" aria-hidden="true">&gt;<span class="term-caret">_</span></span> Terminal';
  const select = /** @type {HTMLSelectElement} */ (el("select", "term-select"));
  select.id = "term-project";
  select.setAttribute("aria-label", "Project");
  for (const p of projects) {
    const o = /** @type {HTMLOptionElement} */ (el("option", "", p.name));
    o.value = p.id;
    select.append(o);
  }
  const note = el("span", "term-note", "📼 Replays captured output");
  bar.append(toggle, select, note);

  const body = el("div", "term-body");
  body.id = "term-body";
  toggle.setAttribute("aria-controls", body.id);
  const chips = el("div", "term-chips");
  const out = el("div", "term-out");
  out.setAttribute("role", "log");
  out.setAttribute("aria-live", "polite");
  out.tabIndex = 0;
  const form = el("form", "term-in");
  const input = /** @type {HTMLInputElement} */ (el("input"));
  input.id = "term-input";
  input.setAttribute("aria-label", "Command");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "help, ls, run 1, use vizmlir";
  form.append(el("span", "term-prompt", "$"), input);
  body.append(chips, out, form);
  const handle = el("div", "term-resize");
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize terminal");
  handle.setAttribute("aria-valuemin", String(MIN * 100));
  handle.setAttribute("aria-valuemax", String(MAX * 100));
  handle.tabIndex = 0;
  handle.title = "Drag to resize, double-click to reset";
  dock.append(handle, bar, body);
  document.body.append(dock);
  document.body.classList.add("has-term");

  // Side-by-side split on wide screens: the terminal's share of the window.
  const setWidth = (/** @type {number} */ f, save = true) => {
    const w = Math.min(MAX, Math.max(MIN, f));
    root.style.setProperty("--term-w", `${(w * 100).toFixed(1)}vw`);
    handle.setAttribute("aria-valuenow", String(Math.round(w * 100)));
    if (save) store.set("term-width", String(w));
    return w;
  };
  let width = setWidth(Number(store.get("term-width")) || 0.5, false);
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("term-dragging");
  });
  handle.addEventListener("pointermove", (e) => {
    if (handle.hasPointerCapture(e.pointerId))
      width = setWidth(1 - e.clientX / innerWidth);
  });
  const endDrag = () => document.body.classList.remove("term-dragging");
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("dblclick", () => (width = setWidth(0.5)));
  handle.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowLeft" ? 0.02 : e.key === "ArrowRight" ? -0.02 : 0;
    if (!d) return;
    e.preventDefault();
    width = setWidth(width + d);
  });

  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const wait = (/** @type {number} */ ms) =>
    new Promise((r) => setTimeout(r, ms));
  // Commands run one at a time so animated output never interleaves. Anything
  // waiting behind the current one makes it finish its animation at once.
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  let waiting = 0;
  const hurry = () => waiting > 0 || calm.matches;
  const enqueue = (/** @type {string} */ line) => {
    waiting++;
    queue = queue
      .then(() => {
        waiting--;
        return exec(line);
      })
      .catch(() => {
        out.removeAttribute("aria-busy");
      });
  };

  const fill = (
    /** @type {HTMLElement} */ node,
    /** @type {Part[]} */ parts,
  ) => {
    for (const { t, c } of parts) {
      if (!c) {
        node.append(t);
        continue;
      }
      const s = el("span", c, t);
      if (c === "emo") s.setAttribute("aria-hidden", "true");
      node.append(s);
    }
    return node;
  };
  const scroll = () => (out.scrollTop = out.scrollHeight);
  /** Print a line; `order` staggers its fade-in after a replayed command. */
  const show = (/** @type {Line} */ line, order = -1) => {
    const pre = el("pre", line.cls ? `line ${line.cls}` : "line");
    fill(pre, line.parts);
    if (order >= 0 && !hurry()) {
      pre.classList.add("enter");
      pre.style.setProperty("--i", String(Math.min(order, 8)));
    }
    out.append(pre);
    scroll();
    return pre;
  };
  const print = (/** @type {string} */ text, cls = "") =>
    show(plain(text, cls));
  const short = (/** @type {string} */ sha) => sha.slice(0, 7);

  const setOpen = (/** @type {boolean} */ open, focus = true) => {
    body.hidden = !open;
    dock.classList.toggle("open", open);
    document.body.classList.toggle("term-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    store.set("term-open", open ? "1" : "0");
    if (open && focus) input.focus({ preventScroll: true });
  };

  async function use(/** @type {Json} */ p) {
    current = p;
    select.value = p.id;
    store.set("term-project", p.id);
    if (!cache.has(p.id))
      cache.set(
        p.id,
        await fetch(`${base}artifacts/${p.id}.json`).then((r) => r.json()),
      );
    const file = cache.get(p.id);
    list = file.artifacts;
    chips.replaceChildren(
      ...featured(list).map((a) => {
        const b = fill(el("button", "term-chip"), [
          P(`${iconOf(a)} `, "emo"),
          P(a.title),
        ]);
        b.setAttribute("type", "button");
        b.title = commandOf(a);
        b.addEventListener("click", () =>
          enqueue(`run ${list.indexOf(a) + 1}`),
        );
        return b;
      }),
    );
    show({
      parts: [
        P("📦 ", "emo"),
        P(p.name, "c-sym"),
        P(
          ` @ ${short(p.commit)} · ${list.length} recorded outputs. Pick one above, or type "ls".`,
        ),
      ],
      cls: "dim",
    });
  }

  async function run(/** @type {Json} */ a) {
    const file = cache.get(current.id);
    out.setAttribute("aria-busy", "true");
    // Type the command out, then a short spinner, then the recorded output.
    const text = commandOf(a);
    const cmd = show({ parts: [P("$ ", "c-prompt")] });
    cmd.classList.add("cmd");
    const typed = el("span", "c-cmdtext");
    cmd.append(typed);
    if (!hurry()) {
      cmd.classList.add("typing");
      const step = Math.max(1, Math.ceil(text.length / 28));
      for (let i = step; i < text.length && !hurry(); i += step) {
        typed.textContent = text.slice(0, i);
        scroll();
        await wait(14);
      }
      cmd.classList.remove("typing");
    }
    typed.textContent = text;
    if (!hurry()) {
      const spin = show(plain("", "dim spin"));
      const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
      for (let i = 0; i < 9 && !hurry(); i++) {
        spin.textContent = `${frames[i % frames.length]} replaying captured output…`;
        await wait(45);
      }
      spin.remove();
    }

    const pv = a.provenance;
    /** @type {Line[]} */
    const lines = [];
    if (pv.mode === "captured")
      lines.push(
        plain(
          `📼 replayed from capture · ${current.name}@${short(current.commit)} · ${file.capture.host} · LLVM ${file.capture.toolchain.llvm ?? "?"} · ${file.capture.capturedAt.slice(0, 10)}`,
          "dim",
        ),
      );
    else if (pv.mode === "static")
      lines.push(
        plain(
          `📄 file read verbatim at ${current.name}@${short(current.commit)}`,
          "dim",
        ),
      );
    lines.push(...outputOf(a));
    lines.forEach((l, i) => show(l, i));
    out.removeAttribute("aria-busy");
  }

  function help() {
    const rows = [
      ["help", "this list"],
      ["ls", "every recorded output for the current project"],
      ["run <n>", "replay output n (or just type n)"],
      [
        "use <project>",
        `switch project: ${projects.map((p) => p.id).join(", ")}`,
      ],
      ["projects", "list projects"],
      ["clear", "clear the screen"],
    ];
    show({
      parts: [
        ...rows.flatMap(([c, d]) => [P(c.padEnd(19), "c-op"), P(`${d}\n`)]),
        P("💡 ", "emo"),
        P("Typing the start of a recorded command also replays it.", "dim"),
      ],
    });
  }

  async function exec(/** @type {string} */ raw) {
    const line = raw.trim();
    if (!line) return;
    history.push(line);
    hist = history.length;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(" ");
    if (cmd === "help") return help();
    if (cmd === "clear") return out.replaceChildren();
    if (cmd === "projects") {
      show({
        parts: projects.flatMap((p, i) => [
          P(`${i ? "\n" : ""}${p.id === current.id ? "▶" : " "} `, "c-prompt"),
          P(p.id.padEnd(16), p.id === current.id ? "c-sym" : ""),
          P(` ${p.name} @ ${short(p.commit)}`, "dim"),
        ]),
      });
      return;
    }
    if (cmd === "use") {
      const p = projects.find((x) => x.id === arg || x.name === arg);
      if (!p)
        return print(`✘ use: unknown project "${arg}". Try "projects".`, "err");
      return use(p);
    }
    if (cmd === "ls") {
      show({
        parts: list.flatMap((a, i) => [
          P(`${i ? "\n" : ""}${String(i + 1).padStart(3)}  `, "c-num"),
          P(`${iconOf(a)} `, "emo"),
          P(a.kind.padEnd(12), "c-op"),
          P(` ${a.title}`),
          ...(a.provenance.mode === "unavailable"
            ? [P("  (not available)", "c-skip")]
            : []),
        ]),
      });
      return;
    }
    const n = Number(cmd === "run" ? arg : line);
    if (Number.isInteger(n)) {
      const a = list[n - 1];
      if (!a) return print(`✘ run: no output ${n}. Try "ls".`, "err");
      return run(a);
    }
    const hit = list.find((a) => commandOf(a).startsWith(line));
    if (hit) return run(hit);
    print(
      `✘ ${cmd}: not a recorded command for ${current.name}. Try "ls" or "help".`,
      "err",
    );
  }

  toggle.addEventListener("click", () => setOpen(body.hidden));
  select.addEventListener("change", () => {
    if (projects.some((x) => x.id === select.value))
      enqueue(`use ${select.value}`);
    if (body.hidden) setOpen(true);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = "";
    enqueue(v);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && hist > 0) input.value = history[--hist];
    else if (e.key === "ArrowDown" && hist < history.length)
      input.value = history[++hist] ?? "";
    else if (e.key === "Escape") setOpen(false);
    else return;
    e.preventDefault();
  });
  addEventListener("keydown", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (e.key !== "`" || e.altKey || e.ctrlKey || e.metaKey) return;
    if (t.closest("input, textarea, select")) return;
    e.preventDefault();
    setOpen(body.hidden);
  });

  const saved = store.get("term-open");
  setOpen(saved === null ? matchMedia(WIDE).matches : saved === "1", false);
  await use(current);
}

start().catch(() => {
  // Without the manifest there is nothing to replay; the page stays as is.
});

// Loaded as an ES module so each script keeps its own scope.
export {};
