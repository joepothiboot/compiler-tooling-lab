import {
  REDUCED_MOTION,
  TERMINAL_KEYS,
  TERMINAL_WIDTH,
  TYPING,
  WIDE_SCREEN,
} from "./constants.js";
import {
  P,
  commandOf,
  featured,
  iconOf,
  outputOf,
  plain,
} from "./terminal-output.js";

/** @typedef {any} Json */
/** @typedef {import("./terminal-output.js").Part} Part */
/** @typedef {import("./terminal-output.js").Line} Line */

const base = document.body.dataset.base ?? "";
const root = document.documentElement;

const RESIZE_STEP = /** @type {Record<string, number>} */ ({
  ArrowLeft: TERMINAL_WIDTH.step,
  ArrowRight: -TERMINAL_WIDTH.step,
});

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
    } catch {}
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

function createDock(/** @type {Json[]} */ projects) {
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
  handle.setAttribute("aria-valuemin", String(TERMINAL_WIDTH.min * 100));
  handle.setAttribute("aria-valuemax", String(TERMINAL_WIDTH.max * 100));
  handle.tabIndex = 0;
  handle.title = "Drag to resize, double-click to reset";
  dock.append(handle, bar, body);
  document.body.append(dock);
  document.body.classList.add("has-term");

  return { dock, toggle, select, body, chips, out, input, form, handle };
}

function bindResize(/** @type {HTMLElement} */ handle) {
  const setWidth = (/** @type {number} */ f, save = true) => {
    const w = Math.min(TERMINAL_WIDTH.max, Math.max(TERMINAL_WIDTH.min, f));
    root.style.setProperty("--term-w", `${(w * 100).toFixed(1)}vw`);
    handle.setAttribute("aria-valuenow", String(Math.round(w * 100)));
    if (save) store.set(TERMINAL_KEYS.width, String(w));

    return w;
  };

  let width = setWidth(
    Number(store.get(TERMINAL_KEYS.width)) || TERMINAL_WIDTH.initial,
    false,
  );

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("term-dragging");
  });

  handle.addEventListener("pointermove", (e) => {
    if (handle.hasPointerCapture(e.pointerId)) {
      width = setWidth(1 - e.clientX / innerWidth);
    }
  });

  const endDrag = () => document.body.classList.remove("term-dragging");
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  handle.addEventListener(
    "dblclick",
    () => (width = setWidth(TERMINAL_WIDTH.initial)),
  );

  handle.addEventListener("keydown", (e) => {
    const d = RESIZE_STEP[e.key];
    if (!d) return;
    e.preventDefault();
    width = setWidth(width + d);
  });
}

async function start() {
  /** @type {Json} */
  const manifest = await fetch(`${base}manifest.json`).then((r) => r.json());
  const projects = /** @type {Json[]} */ (manifest.projects);
  /** @type {Map<string, Json>} */
  const cache = new Map();

  let current =
    projects.find((p) => p.id === document.body.dataset.project) ??
    projects.find((p) => p.id === store.get(TERMINAL_KEYS.project)) ??
    projects[0];

  /** @type {Json[]} */
  let list = [];
  /** @type {string[]} */
  const history = [];
  let hist = 0;

  const { dock, toggle, select, body, chips, out, input, form, handle } =
    createDock(projects);

  bindResize(handle);

  const calm = matchMedia(REDUCED_MOTION);

  const wait = (/** @type {number} */ ms) =>
    new Promise((r) => setTimeout(r, ms));

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
    store.set(TERMINAL_KEYS.open, open ? "1" : "0");
    if (open && focus) input.focus({ preventScroll: true });
  };

  async function use(/** @type {Json} */ p) {
    current = p;
    select.value = p.id;
    store.set(TERMINAL_KEYS.project, p.id);

    if (!cache.has(p.id)) {
      cache.set(
        p.id,
        await fetch(`${base}artifacts/${p.id}.json`).then((r) => r.json()),
      );
    }

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

    const text = commandOf(a);
    const cmd = show({ parts: [P("$ ", "c-prompt")] });
    cmd.classList.add("cmd");

    const typed = el("span", "c-cmdtext");
    cmd.append(typed);

    if (!hurry()) {
      cmd.classList.add("typing");

      const step = Math.max(1, Math.ceil(text.length / TYPING.chunks));

      for (let i = step; i < text.length && !hurry(); i += step) {
        typed.textContent = text.slice(0, i);
        scroll();
        await wait(TYPING.charDelayMs);
      }

      cmd.classList.remove("typing");
    }

    typed.textContent = text;

    if (!hurry()) {
      const spin = show(plain("", "dim spin"));
      const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

      for (let i = 0; i < TYPING.spinnerFrames && !hurry(); i++) {
        spin.textContent = `${frames[i % frames.length]} replaying captured output…`;
        await wait(TYPING.spinnerDelayMs);
      }

      spin.remove();
    }

    const pv = a.provenance;
    /** @type {Line[]} */
    const lines = [];

    if (pv.mode === "captured") {
      lines.push(
        plain(
          `📼 replayed from capture · ${current.name}@${short(current.commit)} · ${file.capture.host} · LLVM ${file.capture.toolchain.llvm ?? "?"} · ${file.capture.capturedAt.slice(0, 10)}`,
          "dim",
        ),
      );
    } else if (pv.mode === "static") {
      lines.push(
        plain(
          `📄 file read verbatim at ${current.name}@${short(current.commit)}`,
          "dim",
        ),
      );
    }

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

      if (!p) {
        return print(`✘ use: unknown project "${arg}". Try "projects".`, "err");
      }

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
    if (projects.some((x) => x.id === select.value)) {
      enqueue(`use ${select.value}`);
    }

    if (body.hidden) setOpen(true);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const v = input.value;
    input.value = "";
    enqueue(v);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && hist > 0) {
      input.value = history[--hist];
    } else if (e.key === "ArrowDown" && hist < history.length) {
      input.value = history[++hist] ?? "";
    } else if (e.key === "Escape") {
      setOpen(false);
    } else {
      return;
    }

    e.preventDefault();
  });

  addEventListener("keydown", (e) => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (e.key !== "`" || e.altKey || e.ctrlKey || e.metaKey) return;
    if (t.closest("input, textarea, select")) return;
    e.preventDefault();
    setOpen(body.hidden);
  });

  const saved = store.get(TERMINAL_KEYS.open);

  setOpen(
    saved === null ? matchMedia(WIDE_SCREEN).matches : saved === "1",
    false,
  );

  await use(current);
}

start().catch(() => {});

export {};
