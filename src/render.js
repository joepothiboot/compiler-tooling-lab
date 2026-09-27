// HTML rendering: pure functions from manifest + content + artifacts to strings.
// Output is static HTML with one small progressive-enhancement script.

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
const projectHref = (/** @type {string} */ base, /** @type {string} */ id) =>
  `${base}projects/${id}/index.html`;

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

/** @param {Ctx} ctx @param {string} id @param {number} [level] heading level */
export function renderArtifact(ctx, id, level = 3) {
  const hit = lookup(ctx, id);
  const { artifact: a, project: p } = hit;
  const h = `<h${level} class="artifact-title">${esc(a.title)}</h${level}>`;
  if (a.provenance.mode === "unavailable") {
    return `<section class="artifact" id="${esc(a.id)}">${h}<div class="unavailable" role="note"><span class="badge unavailable">Not available</span> ${esc(a.provenance.reason)}</div></section>`;
  }
  return `<section class="artifact" id="${esc(a.id)}">${h}${renderBody(ctx, hit)}${provenance(hit)}</section>`;
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
// Pages

/**
 * @param {{ title: string, description: string, base: string, project?: string, body: string, ctx: Ctx }} o
 */
export function page({ title, description, base, project, body, ctx }) {
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
<script type="module" src="${base}assets/compact.js"></script>
<script type="module" src="${base}assets/terminal.js"></script>
</head>
<body data-base="${base}"${project ? ` data-project="${esc(project)}"` : ""}>
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

/** @param {Ctx} ctx @param {Project} p @param {string} base */
function pinLine(ctx, p, base) {
  return `<dl class="pin"><div><dt>Version</dt><dd><code>${esc(p.version)}</code></dd></div><div><dt>Commit</dt><dd><a href="${esc(gh(p, "tree"))}"><code>${short(p.commit)}</code></a></dd></div><div><dt>Release</dt><dd>${p.releaseTag ? `<code>${esc(p.releaseTag)}</code>` : "none yet"}</dd></div><div><dt>Stages</dt><dd>${p.stages.map((s) => esc(STAGE_LABEL[s])).join(" · ")}</dd></div></dl>`;
}

/** @param {Ctx} ctx @param {Project} p @param {string} base */
function chainNav(ctx, p, base, suffix = "index.html") {
  const ps = ctx.manifest.projects;
  const i = ps.findIndex((x) => x.id === p.id);
  const prev = ps[i - 1];
  const next = ps[i + 1];
  const link = (
    /** @type {Project} */ x,
    /** @type {string} */ rel,
    /** @type {string} */ label,
  ) =>
    `<a rel="${rel}" href="${base}projects/${x.id}/${suffix}">${label}: ${esc(x.name)}</a>`;
  const home = `<a href="${base}index.html">All projects</a>`;
  return `<nav class="prevnext" aria-label="Project chain"><span>${prev ? link(prev, "prev", "Previous") : ""}</span>${home}<span>${next ? link(next, "next", "Next") : ""}</span></nav>`;
}

/** @param {Ctx} ctx */
export function landingPage(ctx) {
  const base = "";
  const { projects } = ctx.manifest;
  const rows = projects
    .map((p) => {
      const c = ctx.content[p.id];
      const demo = p.liveUrl ? `<a href="${esc(p.liveUrl)}">Open app</a>` : "";
      return `<li class="project"><div class="project-main"><h2><a href="${projectHref(base, p.id)}">${esc(p.name)}</a></h2><p>${esc(c.summary)}</p><p class="meta">${p.stages.map((s) => esc(STAGE_LABEL[s])).join(" · ")} · <code>${short(p.commit)}</code></p></div><p class="links"><a href="${esc(p.demoPath)}">Tour</a>${demo}</p></li>`;
    })
    .join("");
  const body = `
<h1>Compiler Tooling Lab</h1>
<p class="subtitle">Three pinned MLIR projects, one pipeline</p>
<ol class="projects">${rows}</ol>`;
  return page({
    title: "Compiler Tooling Lab",
    description:
      "Source → diagnostics → MLIR → pass inspection → profiling, across three pinned MLIR projects.",
    base,
    body,
    ctx,
  });
}

/** @param {Ctx} ctx @param {Project} p */
export function projectPage(ctx, p) {
  const base = "../../";
  const c = ctx.content[p.id];
  const status = c.status
    ? `<div class="callout" role="note"><p><strong>Status:</strong> ${esc(c.status)}</p>${(c.statusLinks ?? []).map((l) => `<p><a href="${esc(l.href)}">${esc(l.text)}</a></p>`).join("")}</div>`
    : "";
  const live = p.liveUrl
    ? ` · <a href="${esc(p.liveUrl)}">Open ${esc(p.name)}</a>`
    : "";
  const arch = c.architecture
    .map(
      (x) =>
        `<li class="block"><h3>${esc(x.name)}</h3><p>${esc(x.text)}</p><p class="meta"><a href="${esc(gh(p, "blob", x.path))}"><code>${esc(x.path)}</code></a></p></li>`,
    )
    .join("");
  const run = c.run.map((l) => l.replaceAll("{commit}", p.commit)).join("\n");
  const benches = c.benchmarks.length
    ? c.benchmarks.map((id) => renderArtifact(ctx, id, 3)).join("")
    : "<p>No benchmarks are published for this commit.</p>";
  const body = `
<h1>${esc(p.name)}</h1>
${status}
<div class="tabbed">
<div class="panel" id="overview" data-tab="Overview">
<section id="purpose" class="sec" aria-labelledby="h-purpose"><h2 id="h-purpose">Purpose</h2>${c.purpose.map((t) => `<p>${prose(t)}</p>`).join("")}
<ul class="blocks caps">${p.capabilities.map((x) => `<li class="block">${esc(x)}</li>`).join("")}</ul></section>
<section id="quick-demo" class="sec" aria-labelledby="h-demo"><h2 id="h-demo">Quick demo</h2><div class="block cta"><p>${esc(c.quickDemo)}</p><p class="links"><a href="tour.html">Start the guided tour →</a>${live}</p></div></section>
</div>
<div class="panel" id="design" data-tab="Architecture">
<section id="architecture" class="sec" aria-labelledby="h-arch"><h2 id="h-arch">Architecture</h2><ol class="blocks arch">${arch}</ol></section>
</div>
<div class="panel" id="use" data-tab="Run">
<section id="run" class="sec" aria-labelledby="h-run"><h2 id="h-run">Run locally</h2><pre tabindex="0" data-copy aria-label="Commands"><code>${esc(run)}</code></pre><p class="meta">${esc(c.runNote)}</p></section>
<div class="blocks pair">
<section id="source" class="sec block" aria-labelledby="h-src"><h2 id="h-src">Source</h2><p><a href="${esc(gh(p, "tree"))}">github.com/${esc(p.repo)}</a></p><p class="meta">at <code>${short(p.commit)}</code></p></section>
<section id="docs" class="sec block" aria-labelledby="h-docs"><h2 id="h-docs">Technical docs</h2><p><a href="${esc(gh(p, "blob", p.docsPath))}"><code>${esc(p.docsPath)}</code></a></p><p class="meta">at <code>${short(p.commit)}</code></p></section>
</div>
</div>
<div class="panel" id="verify" data-tab="Tests">
<section id="tests" class="sec" aria-labelledby="h-tests"><h2 id="h-tests">Tests and benchmarks</h2>${c.tests.map((id) => renderArtifact(ctx, id, 3)).join("")}${benches}</section>
</div>
</div>
${pinLine(ctx, p, base)}
${chainNav(ctx, p, base)}`;
  return page({
    title: `${p.name} · Compiler Tooling Lab`,
    description: c.summary,
    base,
    project: p.id,
    body,
    ctx,
  });
}

/** @param {Ctx} ctx @param {Project} p */
export function tourPage(ctx, p) {
  const base = "../../";
  const c = ctx.content[p.id];
  const steps = c.tour
    .map((s, i) => {
      const arts = (s.artifacts ?? [])
        .map((id) => renderArtifact(ctx, id, 3))
        .join("");
      const tl = s.timeline ? renderTimeline(ctx, s.timeline) : "";
      return `<li class="step" id="step-${i + 1}"><h2>${esc(s.title)}</h2><p>${prose(s.text)}</p>${tl}${arts}</li>`;
    })
    .join("");
  const live = p.liveUrl
    ? `<p class="callout"><a href="${esc(p.liveUrl)}">Open ${esc(p.name)}</a> on its own site. It deploys from the project's main branch, so it can be newer than the pinned ${short(p.commit)} this tour was captured at.</p>`
    : "";
  const body = `
<h1>${esc(p.name)}: guided tour</h1>
<p class="lede">${esc(c.quickDemo)}</p>
${live}
<ol class="tour">${steps}</ol>
${pinLine(ctx, p, base)}
${chainNav(ctx, p, base, "tour.html")}`;
  return page({
    title: `${p.name} tour · Compiler Tooling Lab`,
    description: c.quickDemo,
    base,
    project: p.id,
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
    body: `<h1>Artifacts</h1><p>One JSON file per project, validated against the shared model in <code>src/model.js</code>.</p><ul>${items}</ul>`,
    ctx,
  });
}
