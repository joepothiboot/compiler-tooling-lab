// Integration test: builds the site into a temp dir and checks the output as a
// whole — required sections, cross-links, provenance labels, internal links,
// pinned external links, and basic accessibility structure.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { build } from "../scripts/build.mjs";
import { expectedCheck } from "../src/render.js";

const manifest = JSON.parse(
  fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
);
/** @type {string} */
let out;
/** @type {string[]} */
let files;
const read = (/** @type {string} */ rel) =>
  fs.readFileSync(path.join(out, rel), "utf8");
const pages = () => files.filter((f) => f.endsWith(".html"));

before(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), "ctl-build-"));
  files = build({ out });
});
after(() => fs.rmSync(out, { recursive: true, force: true }));

test("emits a landing page, and a project page and tour per project", () => {
  assert.ok(files.includes("index.html"));
  for (const p of manifest.projects) {
    assert.ok(files.includes(`projects/${p.id}/index.html`), p.id);
    assert.ok(files.includes(p.demoPath), p.id);
    assert.ok(files.includes(`artifacts/${p.id}.json`), p.id);
  }
});

test("landing page lists every project in pipeline order", () => {
  const html = read("index.html");
  /** @type {number[]} */
  const order = manifest.projects.map((/** @type {any} */ p) =>
    html.indexOf(`<a href="projects/${p.id}/index.html">`),
  );
  assert.ok(
    order.every((i) => i > 0),
    "every project linked",
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    "projects in order",
  );
  for (const p of manifest.projects)
    assert.ok(html.includes(`href="${p.demoPath}"`), `${p.id}: tour link`);
});

test("project pages have every required section", () => {
  for (const p of manifest.projects) {
    const html = read(`projects/${p.id}/index.html`);
    for (const id of [
      "purpose",
      "quick-demo",
      "architecture",
      "run",
      "source",
      "docs",
      "tests",
    ])
      assert.match(
        html,
        new RegExp(`<section id="${id}"`),
        `${p.id} lacks #${id}`,
      );
    assert.ok(
      html.includes(`https://github.com/${p.repo}/tree/${p.commit}`),
      `${p.id}: source link not pinned`,
    );
    assert.ok(
      html.includes(
        `https://github.com/${p.repo}/blob/${p.commit}/${p.docsPath}`,
      ),
      `${p.id}: docs link not pinned`,
    );
    assert.ok(
      html.includes(`git checkout ${p.commit}`),
      `${p.id}: run steps not pinned`,
    );
  }
});

test("cross-links follow schema-mlir → VizMLIR → mlir-lldb-tools → nano-dsp-mlir", () => {
  const ids = manifest.projects.map((/** @type {any} */ p) => p.id);
  for (const [i, id] of ids.entries()) {
    for (const page of [
      `projects/${id}/index.html`,
      `projects/${id}/tour.html`,
    ]) {
      const html = read(page);
      const next = /<a rel="next" href="[^"]*projects\/([^/]+)\//.exec(
        html,
      )?.[1];
      const prev = /<a rel="prev" href="[^"]*projects\/([^/]+)\//.exec(
        html,
      )?.[1];
      assert.equal(next, ids[i + 1], `${page} next`);
      assert.equal(prev, ids[i - 1], `${page} prev`);
    }
  }
});

test("every rendered artifact carries a provenance label", () => {
  for (const page of pages()) {
    const html = read(page);
    for (const m of html.matchAll(
      /<section class="artifact" id="([^"]+)">([\s\S]*?)<\/section>/g,
    ))
      assert.match(
        m[2],
        /class="badge (captured|static|unavailable)"/,
        `${page}#${m[1]}`,
      );
  }
});

test("no link floats on a branch", () => {
  for (const page of pages()) {
    const html = read(page);
    assert.doesNotMatch(
      html,
      /github\.com\/[^"]+\/(tree|blob)\/(main|master)\b/,
      page,
    );
  }
});

test("all internal links and assets resolve", () => {
  for (const page of pages()) {
    const html = read(page);
    for (const m of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      let resolved = path.join(path.dirname(path.join(out, page)), target);
      if (target.endsWith("/")) resolved = path.join(resolved, "index.html");
      assert.ok(fs.existsSync(resolved), `${page} → ${target}`);
    }
  }
});

test("pages have basic accessible structure", () => {
  for (const page of pages()) {
    const html = read(page);
    assert.match(html, /<html lang="en">/, page);
    assert.match(html, /<title>[^<]+<\/title>/, page);
    assert.match(html, /name="viewport"/, page);
    assert.equal(
      (html.match(/<h1[\s>]/g) ?? []).length,
      1,
      `${page}: exactly one h1`,
    );
    assert.match(html, /<a class="skip" href="#main">/, page);
    assert.match(html, /<main id="main">/, page);
    for (const img of html.match(/<img\b[^>]*>/g) ?? [])
      assert.match(img, /\balt="/, page);
  }
});

test("pages stay small and ship no third-party scripts", () => {
  for (const page of pages()) {
    const html = read(page);
    assert.ok(html.length < 100_000, `${page} is ${html.length} bytes`);
    for (const m of html.matchAll(/<script src="([^"]+)"/g))
      assert.doesNotMatch(m[1], /^https?:/, page);
  }
});

test("expectedCheck requires CHECK lines in order", () => {
  assert.match(
    expectedCheck("a\n0\n3\n30", ["0", "3", "30"]),
    /All 3 expected lines/,
  );
  assert.match(
    expectedCheck("30\n3", ["3", "30"]),
    /1 expected line\(s\) not found/,
  );
});
