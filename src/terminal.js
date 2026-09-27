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

/** @returns {{ text: string, cls?: string }[]} */
function outputOf(/** @type {Json} */ a) {
  if (a.provenance.mode === "unavailable")
    return [{ text: `not available: ${a.provenance.reason}`, cls: "warn" }];
  switch (a.kind) {
    case "source":
    case "ir-snapshot":
      return [{ text: a.text }];
    case "diagnostic":
      return [
        ...a.entries.map((/** @type {Json} */ e) => ({
          text: `${loc(e.location) || "(no location)"}: ${e.severity}: ${e.message}`,
          cls: e.severity === "error" ? "err" : "dim",
        })),
        { text: `exit code ${a.exitCode}`, cls: "dim" },
      ];
    case "execution":
      return [
        { text: a.stdout },
        { text: `exit code ${a.exitCode}`, cls: "dim" },
      ];
    case "test-run":
      return [
        { text: a.log },
        {
          text: `${a.passed} passed, ${a.failed} failed, ${a.errors} errors, ${a.skipped} skipped (${a.runner})`,
          cls: a.failed || a.errors ? "err" : "ok",
        },
      ];
    case "profile": {
      const w = Math.min(
        44,
        Math.max(
          ...a.entries.map(
            (/** @type {Json} */ e) => e.name.length + 2 * e.depth,
          ),
        ),
      );
      const rows = a.entries.map((/** @type {Json} */ e) => {
        const name = `${"  ".repeat(e.depth)}${e.name}`.padEnd(w).slice(0, w);
        return `${name}  ${e.value.toFixed(4).padStart(8)} ${a.unit}  ${e.percent.toFixed(1).padStart(5)}%`;
      });
      return [
        { text: rows.join("\n") },
        { text: `total ${a.total} ${a.unit} (${a.metric})`, cls: "dim" },
      ];
    }
    case "pass-event": {
      const out = [
        {
          text: `pass ${a.pass} (#${a.index}): ${a.changed ? "changed the IR" : "no change"}`,
        },
      ];
      if (a.diff) {
        const sign = { added: "+", removed: "-", changed: "~" };
        out.push({
          text: a.diff.rows
            .map((/** @type {Json} */ r) =>
              r.type === "changed"
                ? `~ ${r.before} -> ${r.after}`
                : `${sign[/** @type {"added" | "removed"} */ (r.type)]} ${r.type === "added" ? r.after : r.before}`,
            )
            .join("\n"),
        });
      }
      return out;
    }
  }
  return [{ text: JSON.stringify(a, null, 2) }];
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
    '<span class="term-glyph" aria-hidden="true">&gt;_</span> Terminal';
  const select = /** @type {HTMLSelectElement} */ (el("select", "term-select"));
  select.id = "term-project";
  select.setAttribute("aria-label", "Project");
  for (const p of projects) {
    const o = /** @type {HTMLOptionElement} */ (el("option", "", p.name));
    o.value = p.id;
    select.append(o);
  }
  const note = el("span", "term-note", "Replays captured output");
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

  const print = (/** @type {string} */ text, cls = "") => {
    out.append(el("pre", cls ? `line ${cls}` : "line", text));
    out.scrollTop = out.scrollHeight;
  };
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
        const b = el("button", "term-chip", a.title);
        b.setAttribute("type", "button");
        b.title = commandOf(a);
        b.addEventListener("click", () => exec(`run ${list.indexOf(a) + 1}`));
        return b;
      }),
    );
    print(
      `${p.name} @ ${short(p.commit)} · ${list.length} recorded outputs. Pick one above, or type "ls".`,
      "dim",
    );
  }

  function run(/** @type {Json} */ a) {
    const file = cache.get(current.id);
    print(`$ ${commandOf(a)}`, "cmd");
    const pv = a.provenance;
    if (pv.mode === "captured")
      print(
        `# replayed from capture · ${current.name}@${short(current.commit)} · ${file.capture.host} · LLVM ${file.capture.toolchain.llvm ?? "?"} · ${file.capture.capturedAt.slice(0, 10)}`,
        "dim",
      );
    else if (pv.mode === "static")
      print(
        `# file read verbatim at ${current.name}@${short(current.commit)}`,
        "dim",
      );
    for (const o of outputOf(a)) print(o.text, o.cls);
  }

  function help() {
    print(
      [
        "help               this list",
        "ls                 every recorded output for the current project",
        "run <n>            replay output n (or just type n)",
        "use <project>      switch project: " +
          projects.map((p) => p.id).join(", "),
        "projects           list projects",
        "clear              clear the screen",
        "Typing the start of a recorded command also replays it.",
      ].join("\n"),
    );
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
      print(
        projects
          .map(
            (p) =>
              `${p.id === current.id ? "*" : " "} ${p.id.padEnd(16)} ${p.name} @ ${short(p.commit)}`,
          )
          .join("\n"),
      );
      return;
    }
    if (cmd === "use") {
      const p = projects.find((x) => x.id === arg || x.name === arg);
      if (!p)
        return print(`use: unknown project "${arg}". Try "projects".`, "err");
      return use(p);
    }
    if (cmd === "ls") {
      print(
        list
          .map(
            (a, i) =>
              `${String(i + 1).padStart(3)}  ${a.kind.padEnd(12)} ${a.title}${a.provenance.mode === "unavailable" ? "  (not available)" : ""}`,
          )
          .join("\n"),
      );
      return;
    }
    const n = Number(cmd === "run" ? arg : line);
    if (Number.isInteger(n)) {
      const a = list[n - 1];
      if (!a) return print(`run: no output ${n}. Try "ls".`, "err");
      return run(a);
    }
    const hit = list.find((a) => commandOf(a).startsWith(line));
    if (hit) return run(hit);
    print(
      `${cmd}: not a recorded command for ${current.name}. Try "ls" or "help".`,
      "err",
    );
  }

  toggle.addEventListener("click", () => setOpen(body.hidden));
  select.addEventListener("change", () => {
    const p = projects.find((x) => x.id === select.value);
    if (p) use(p);
    if (body.hidden) setOpen(true);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = "";
    exec(v);
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
