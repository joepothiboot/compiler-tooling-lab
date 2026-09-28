// HTML rendering: pure functions from manifest + content + artifacts to strings.
// Output is one static article page; small scripts enhance it progressively.

import { STAGES } from "./model.js";

/** @typedef {import("./model.js").Project} Project */
/** @typedef {import("./model.js").Manifest} Manifest */
/** @typedef {import("./model.js").Artifact} Artifact */
/** @typedef {import("./model.js").ArtifactFile} ArtifactFile */
/** @typedef {import("../content/projects.js").ProjectContent} ProjectContent */

/**
 * @typedef {object} Ctx
 * @property {Manifest} manifest
 * @property {Record<string, ProjectContent>} content
 * @property {Record<string, string>} stageText
 * @property {Map<string, { artifact: Artifact, project: Project, file: ArtifactFile }>} artifacts
 */

export const STAGE_LABEL = {
  source: "Source",
  diagnostics: "Diagnostics",
  mlir: "MLIR",
  passes: "Pass inspection",
  profiling: "Profiling",
};

const LONG_LINES = 40;

/** @param {unknown} s */
export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );

/** Renders `code` spans in otherwise escaped prose. */
const prose = (/** @type {string} */ s) =>
  esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

const short = (/** @type {string} */ sha) => sha.slice(0, 7);
const gh = (
  /** @type {Project} */ p,
  /** @type {"tree" | "blob"} */ kind,
  rel = "",
) => `https://github.com/${p.repo}/${kind}/${p.commit}${rel ? `/${rel}` : ""}`;

/** @param {Project} p @param {import("./model.js").SourceLocation} loc */
function locationLink(p, loc) {
  const label = `${loc.file}:${loc.line}${loc.column ? `:${loc.column}` : ""}`;
  if (loc.file.startsWith("lab:")) return `<code>${esc(label.slice(4))}</code>`;
  return `<a href="${esc(gh(p, "blob", loc.file))}#L${loc.line}"><code>${esc(label)}</code></a>`;
}

/** @param {Ctx} ctx @param {string} id */
function lookup(ctx, id) {
  const hit = ctx.artifacts.get(id);
  if (!hit) throw new Error(`unknown artifact id: ${id}`);
  return hit;
}

// ---------------------------------------------------------------------------
// Artifacts

/** @param {{ artifact: Artifact, project: Project, file: ArtifactFile }} hit */
function provenance({ artifact: a, project: p, file }) {
  const pv = a.provenance;
  if (pv.mode === "captured") {
    const tc = file.capture.toolchain;
    return `<p class="prov"><span class="badge captured">Captured</span> Output of <code>${esc(pv.command)}</code> at <a href="${esc(gh(p, "tree"))}">${esc(p.name)}@${short(p.commit)}</a> · ${esc(file.capture.host)}, LLVM ${esc(tc.llvm ?? "?")}, ${esc(file.capture.capturedAt.slice(0, 10))}</p>`;
  }
  if (pv.mode === "static") {
    const path = pv.path ?? "";
    const where = path.startsWith("lab:")
      ? `<code>compiler-tooling-lab/${esc(path.slice(4))}</code>`
      : `<a href="${esc(gh(p, "blob", path))}"><code>${esc(path)}</code></a> at ${esc(p.name)}@${short(p.commit)}`;
    return `<p class="prov"><span class="badge static">Static file</span> ${where}, shown verbatim.</p>`;
  }
  return "";
}

/** @param {string} text @param {string} label */
function codeBlock(text, label) {
  const lines = text.split("\n").length;
  const pre = `<pre tabindex="0" data-copy aria-label="${esc(label)}"><code>${esc(text)}</code></pre>`;
  return lines > LONG_LINES
    ? `<details><summary>Show ${lines} lines</summary>${pre}</details>`
    : pre;
}

/**
 * Artifacts can appear in more than one note (a test run is both a tour step
 * and part of the project's test list), so they carry `data-artifact`, not an id.
 * @param {Ctx} ctx @param {string} id @param {number} [level] heading level
 */
export function renderArtifact(ctx, id, level = 3) {
  const hit = lookup(ctx, id);
  const { artifact: a, project: p } = hit;
  const h = `<h${level} class="artifact-title">${esc(a.title)}</h${level}>`;
  if (a.provenance.mode === "unavailable") {
    return `<section class="artifact" data-artifact="${esc(a.id)}">${h}<div class="unavailable" role="note"><span class="badge unavailable">Not available</span> ${esc(a.provenance.reason)}</div></section>`;
  }
  return `<section class="artifact" data-artifact="${esc(a.id)}">${h}${renderBody(ctx, hit)}${provenance(hit)}</section>`;
}

/** @param {Ctx} ctx @param {{ artifact: Artifact, project: Project }} hit */
function renderBody(ctx, { artifact: a, project: p }) {
  switch (a.kind) {
    case "source":
    case "ir-snapshot": {
      const loc = a.location
        ? `<p class="meta">From ${locationLink(p, a.location)}</p>`
        : "";
      const stage =
        a.kind === "ir-snapshot"
          ? `<p class="meta">Stage: <code>${esc(a.stage)}</code></p>`
          : "";
      return `${stage}${loc}${codeBlock(a.text, a.title)}`;
    }
    case "diagnostic": {
      const items = a.entries
        .map(
          (e) =>
            `<li><span class="sev sev-${esc(e.severity)}">${esc(e.severity)}</span> ${e.location ? locationLink(p, e.location) : '<span class="meta">(no location)</span>'} <span class="msg">${esc(e.message)}</span></li>`,
        )
        .join("");
      return `<ul class="diags">${items}</ul><p class="meta"><code>${esc(a.tool)}</code> exit code ${a.exitCode}</p>`;
    }
    case "pass-event":
      return renderPassEvent(ctx, a);
    case "profile": {
      const max = Math.max(...a.entries.map((e) => e.percent)) || 1;
      const rows = a.entries
        .map(
          (e) =>
            `<tr><td class="depth-${Math.min(e.depth, 3)}">${esc(e.name)}</td><td class="num">${e.value.toFixed(4)}</td><td class="num">${e.percent.toFixed(1)}%</td><td class="plot" aria-hidden="true"><span class="bar" style="--w:${((e.percent / max) * 100).toFixed(1)}%"></span></td></tr>`,
        )
        .join("");
      return `<div class="table-wrap" tabindex="0"><table><caption>${esc(a.metric)} per pass, one run; total ${a.total} ${esc(a.unit)}</caption><thead><tr><th scope="col">Pass</th><th scope="col" class="num">${esc(a.unit)}</th><th scope="col" class="num">Share</th><td class="plot" aria-hidden="true"></td></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    case "execution": {
      const check = a.expected?.length
        ? expectedCheck(a.stdout, a.expected)
        : "";
      return `<p class="meta">Exit code ${a.exitCode}</p>${codeBlock(a.stdout, a.title)}${check}`;
    }
    case "test-run": {
      const counts = `<p class="counts"><strong>${a.passed} passed</strong>, ${a.failed} failed, ${a.errors} errors, ${a.skipped} skipped/deselected <span class="meta">(${esc(a.runner)})</span></p>`;
      return `${counts}<details><summary>Test log</summary><pre tabindex="0"><code>${esc(a.log)}</code></pre></details>`;
    }
  }
}

/** In-order substring check of expected lines against stdout (FileCheck-like, simplified). */
export function expectedCheck(
  /** @type {string} */ stdout,
  /** @type {string[]} */ expected,
) {
  let from = 0;
  const missing = [];
  for (const line of expected) {
    const at = stdout.indexOf(line, from);
    if (at < 0) missing.push(line);
    else from = at + line.length;
  }
  const list = expected.map((l) => `<li><code>${esc(l)}</code></li>`).join("");
  const verdict = missing.length
    ? `<strong class="bad">${missing.length} expected line(s) not found in order</strong>`
    : `<strong class="ok">All ${expected.length} expected lines found in order</strong>`;
  return `<p>${verdict} (checked by the lab build against the test's CHECK lines):</p><ul class="expected">${list}</ul>`;
}

/** @param {Ctx} ctx @param {import("./model.js").PassEventArtifact} a */
function renderPassEvent(ctx, a) {
  const parts = [
    `<p>Pass <code>${esc(a.pass)}</code> (#${a.index}) — ${a.changed ? "changed the IR" : "no change"}.</p>`,
  ];
  if (a.diff) {
    const n = (/** @type {string} */ t) =>
      a.diff?.rows.filter((r) => r.type === t).length ?? 0;
    parts.push(
      `<p><strong>${n("added")} added, ${n("removed")} removed, ${n("changed")} changed</strong> (${esc(a.diff.tool)})</p>`,
    );
    const rows = a.diff.rows.map((r) => {
      const text =
        r.type === "changed"
          ? `~ ${r.before} → ${r.after}`
          : r.type === "added"
            ? `+ ${r.after}`
            : `− ${r.before}`;
      return `<li class="d-${r.type}"><code>${esc(text)}</code></li>`;
    });
    const list = `<ul class="diff">${rows.join("")}</ul>`;
    parts.push(
      rows.length > 12
        ? `<details><summary>Show ${rows.length} diff rows</summary>${list}</details>`
        : list,
    );
    for (const [label, g] of /** @type {const} */ ([
      ["Before", a.diff.beforeGraph],
      ["After", a.diff.afterGraph],
    ])) {
      if (!g) continue;
      const counts = new Map();
      for (const d of g.diagnostics)
        counts.set(
          `${d.message} ${d.symbol}`,
          (counts.get(`${d.message} ${d.symbol}`) ?? 0) + 1,
        );
      const diags = [...counts]
        .map(([k, c]) => `<code>${esc(k)}</code> ×${c}`)
        .join(", ");
      parts.push(
        `<p class="meta">${label}: ${g.nodes} nodes, ${g.edges} edges${diags ? `; VizMLIR diagnostics: ${diags}` : "; no VizMLIR diagnostics"}</p>`,
      );
    }
  }
  const io = [a.before, a.after].filter((x) => x !== null && x !== undefined);
  if (a.diff && io.length) {
    const inner = io
      .map((id) => renderArtifact(ctx, /** @type {string} */ (id), 4))
      .join("");
    parts.push(
      `<details><summary>The IR VizMLIR parsed (paste into its baseline and current editors)</summary>${inner}</details>`,
    );
  }
  return parts.join("");
}

/** @param {Ctx} ctx @param {string} prefix */
function renderTimeline(ctx, prefix) {
  const events = [...ctx.artifacts.values()]
    .map((h) => h.artifact)
    .filter(
      (a) =>
        a.kind === "pass-event" &&
        a.id.startsWith(prefix) &&
        a.provenance.mode !== "unavailable",
    )
    .map((a) => /** @type {import("./model.js").PassEventArtifact} */ (a))
    .sort((x, y) => x.index - y.index);
  if (!events.length) throw new Error(`timeline ${prefix}: no pass events`);
  const hit = lookup(ctx, events[0].id);
  const rows = events
    .map((e) => {
      const after = e.after ? ctx.artifacts.get(e.after)?.artifact : undefined;
      const lines =
        after && "text" in after ? after.text.split("\n").length : "—";
      return `<tr><td class="num">${e.index}</td><td><code>${esc(e.pass)}</code></td><td>${e.changed ? "changed" : '<span class="meta">unchanged</span>'}</td><td class="num">${lines}</td></tr>`;
    })
    .join("");
  return `<div class="table-wrap" tabindex="0"><table><caption>Pass events, in execution order</caption><thead><tr><th scope="col" class="num">#</th><th scope="col">Pass</th><th scope="col">Effect</th><th scope="col" class="num">IR lines after</th></tr></thead><tbody>${rows}</tbody></table></div>${provenance(hit)}`;
}

// ---------------------------------------------------------------------------
// Page

/**
 * @param {{ title: string, description: string, base: string, body: string, ctx: Ctx }} o
 */
export function page({ title, description, base, body, ctx }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<script>try{if(localStorage.getItem("theme")==="dark")document.documentElement.dataset.theme="dark"}catch{}</script>
<link rel="stylesheet" href="${base}assets/site.css">
<script type="module" src="${base}assets/copy.js"></script>
<script type="module" src="${base}assets/theme.js"></script>
<script type="module" src="${base}assets/notes.js"></script>
<script type="module" src="${base}assets/terminal.js"></script>
</head>
<body data-base="${base}">
<a class="skip" href="#main">Skip to content</a>
<header class="site"></header>
<main id="main">
${body}
</main>
<footer class="site"><p>LLVM ${esc(ctx.manifest.toolchain.llvm)} · Python ${esc(ctx.manifest.toolchain.python)} · Node ${esc(ctx.manifest.toolchain.node)}. Versions pinned in <a href="${base}manifest.json">manifest.json</a>. Artifacts: <a href="${base}artifacts/">artifacts/</a>. Nothing here is mocked; gaps are labelled.</p></footer>
</body>
</html>
`;
}

/**
 * A note is supporting material (captured output, architecture, run steps)
 * kept out of the prose. It renders in the appendix; notes.js opens it in a
 * dialog when its link is clicked.
 * @typedef {{ id: string, title: string, from: string, body: string }} Note
 */

/** @param {Note} n */
const noteLink = (n, label = n.title) => `<a href="#${esc(n.id)}">${label}</a>`;

/** @param {Note} n */
function renderNote(n) {
  return `<section class="note" id="${esc(n.id)}" aria-labelledby="${esc(n.id)}-h"><p class="note-from">${esc(n.from)}</p><h3 id="${esc(n.id)}-h">${esc(n.title)}</h3>${n.body}</section>`;
}

/**
 * A small picture of one real artifact for the project list: the first lines
 * of IR, the first diff rows, or the per-pass time bars. Decorative; the same
 * artifact is shown in full in the walkthrough.
 * @param {Ctx} ctx @param {string} id
 */
function renderThumb(ctx, id) {
  const { artifact: a } = lookup(ctx, id);
  if (a.kind === "profile") {
    const top = a.entries.filter((e) => e.depth === 0);
    const max = Math.max(...top.map((e) => e.percent)) || 1;
    const bars = top
      .map(
        (e) =>
          `<span style="--h:${((e.percent / max) * 100).toFixed(1)}%"></span>`,
      )
      .join("");
    return `<span class="thumb-bars">${bars}</span>`;
  }
  if (a.kind === "pass-event" && a.diff) {
    const rows = a.diff.rows.slice(0, 9).map((r) => {
      const text =
        r.type === "changed"
          ? `~ ${r.before} → ${r.after}`
          : r.type === "added"
            ? `+ ${r.after}`
            : `− ${r.before}`;
      return `<span class="d-${r.type}">${esc(text)}</span>`;
    });
    return `<span class="thumb-code">${rows.join("\n")}</span>`;
  }
  const text = "text" in a ? a.text : "stdout" in a ? a.stdout : a.title;
  const lines = text.split("\n").slice(0, 10).join("\n");
  return `<span class="thumb-code">${esc(lines)}</span>`;
}

/**
 * One project as an entry in the list, plus the notes it links to. The
 * walkthrough note carries the long-form text and captured outputs.
 * @param {Ctx} ctx @param {Project} p
 * @returns {{ html: string, notes: Note[] }}
 */
function projectEntry(ctx, p) {
  const c = ctx.content[p.id];
  /** @type {Note[]} */
  const notes = [];
  const note = (
    /** @type {string} */ slug,
    /** @type {string} */ title,
    /** @type {string} */ body,
  ) => {
    const x = { id: `note-${p.id}-${slug}`, title, from: p.name, body };
    notes.push(x);
    return x;
  };

  const status = c.status
    ? `<div class="callout" role="note"><p><strong>Status:</strong> ${esc(c.status)}</p>${(c.statusLinks ?? []).map((l) => `<p><a href="${esc(l.href)}">${esc(l.text)}</a></p>`).join("")}</div>`
    : "";
  const live = p.liveUrl
    ? `<p class="callout">${esc(p.name)} has a live app: <a href="${esc(p.liveUrl)}">${esc(p.liveUrl.replace(/^https:\/\//, ""))}</a>. It deploys from the project's main branch, so it can be newer than the pinned <code>${short(p.commit)}</code> described here.</p>`
    : "";
  const steps = c.tour
    .map((s, i) => {
      const arts = s.artifacts ?? [];
      const body =
        (s.timeline ? renderTimeline(ctx, s.timeline) : "") +
        arts.map((id) => renderArtifact(ctx, id, 5)).join("");
      return `<h4 id="${esc(p.id)}-${i + 1}">${i + 1}. ${esc(s.title)}</h4><p>${prose(s.text)}</p>${body}`;
    })
    .join("");
  const walk = note(
    "walkthrough",
    "Walkthrough",
    `${status}${c.purpose.map((t) => `<p>${prose(t)}</p>`).join("")}${live}<p><em>${esc(c.quickDemo)}</em></p>${steps}`,
  );

  const caps = `<ul class="caps">${p.capabilities.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const arch = c.architecture
    .map(
      (x) =>
        `<li><h4>${esc(x.name)}</h4><p>${esc(x.text)}</p><p class="meta"><a href="${esc(gh(p, "blob", x.path))}"><code>${esc(x.path)}</code></a></p></li>`,
    )
    .join("");
  const archNote = note(
    "architecture",
    "Architecture",
    `${caps}<ol class="arch">${arch}</ol>`,
  );
  const run = c.run.map((l) => l.replaceAll("{commit}", p.commit)).join("\n");
  const runNote = note(
    "run",
    "Run it locally",
    `<pre tabindex="0" data-copy aria-label="Commands"><code>${esc(run)}</code></pre><p class="meta">${esc(c.runNote)}</p>`,
  );
  const benches = c.benchmarks.length
    ? c.benchmarks.map((id) => renderArtifact(ctx, id, 4)).join("")
    : "<p>No benchmarks are published for this commit.</p>";
  const testsNote = note(
    "tests",
    "Tests and benchmarks",
    `${c.tests.map((id) => renderArtifact(ctx, id, 4)).join("")}${benches}`,
  );

  const links = [
    `<a href="${esc(gh(p, "tree"))}">code</a>`,
    `<a href="${esc(gh(p, "blob", p.docsPath))}">docs</a>`,
    ...(p.liveUrl ? [`<a href="${esc(p.liveUrl)}">live app</a>`] : []),
    noteLink(walk, "walkthrough"),
    noteLink(archNote, "architecture"),
    noteLink(runNote, "run"),
    noteLink(testsNote, "tests"),
  ];
  const thumbTitle = lookup(ctx, c.thumb).artifact.title;

  const html = `<section class="project" id="${esc(p.id)}" aria-labelledby="h-${esc(p.id)}">
<a class="thumb" href="#${esc(walk.id)}" tabindex="-1" aria-hidden="true" title="${esc(thumbTitle)}">${renderThumb(ctx, c.thumb)}</a>
<div class="entry">
<h3 id="h-${esc(p.id)}">${esc(p.name)}</h3>
<p class="venue"><em>${p.stages.map((s) => esc(STAGE_LABEL[s])).join(" · ")}</em> <span class="meta">(<code>${esc(p.version)}</code>, pinned at <code>${short(p.commit)}</code>)</span></p>
<p class="links">${links.join(" / ")}</p>
<p>${prose(c.summary)}</p>
</div>
</section>`;
  return { html, notes };
}

/** @param {Ctx} ctx */
export function articlePage(ctx) {
  const { projects } = ctx.manifest;
  const entries = projects.map((p) => projectEntry(ctx, p));
  const captured = [...ctx.artifacts.values()]
    .map((h) => h.file.capture.capturedAt)
    .sort()
    .at(-1);
  const stages = STAGES.map((s) => {
    const by = projects.filter((p) => p.stages.includes(s));
    return `<li><strong>${esc(STAGE_LABEL[s])}.</strong> ${esc(ctx.stageText[s])} <span class="meta">${by.map((p) => `<a href="#${esc(p.id)}">${esc(p.name)}</a>`).join(", ")}</span></li>`;
  }).join("");
  const notes = entries
    .flatMap((s) => s.notes)
    .map(renderNote)
    .join("");
  const body = `<article class="post">
<header class="post-head">
<p class="kicker">MLIR · developer tooling</p>
<h1>Compiler Tooling Lab</h1>
<p class="dek">Three pinned MLIR projects, read as one pipeline: source, diagnostics, MLIR, pass inspection, profiling.</p>
<p class="byline">${captured ? `Outputs captured <time datetime="${esc(captured.slice(0, 10))}">${esc(captured.slice(0, 10))}</time> · ` : ""}LLVM ${esc(ctx.manifest.toolchain.llvm)}</p>
</header>
<p>Each project below is pinned to one commit. Every output shown was captured from the project's own tools at that commit, or is a file shown verbatim from its repository. Where something could not be captured, the page says so instead of filling the gap.</p>
<ol class="stages">${stages}</ol>
<section class="projects" aria-labelledby="h-projects">
<h2 id="h-projects">Projects</h2>
${entries.map((s) => s.html).join("\n")}
</section>
</article>
<section class="appendix" id="notes" aria-labelledby="h-notes">
<h2 id="h-notes">Appendix: walkthroughs and captured outputs</h2>
<p class="meta">The material linked from the project list above, in order.</p>
${notes}
</section>`;
  return page({
    title: "Compiler Tooling Lab",
    description:
      "Source → diagnostics → MLIR → pass inspection → profiling, across three pinned MLIR projects.",
    base: "",
    body,
    ctx,
  });
}

/** Directory listing for /artifacts/ so the footer link resolves on static hosts. */
export function artifactIndex(/** @type {Ctx} */ ctx) {
  const items = ctx.manifest.projects
    .map((p) => `<li><a href="${p.id}.json">${p.id}.json</a></li>`)
    .join("");
  return page({
    title: "Artifacts · Compiler Tooling Lab",
    description: "Machine-readable artifacts per project.",
    base: "../",
    body: `<h1>Artifacts</h1><p>One JSON file per project, validated against the shared model in <code>src/model.js</code>. <a href="../index.html">Back to the article</a>.</p><ul>${items}</ul>`,
    ctx,
  });
}
