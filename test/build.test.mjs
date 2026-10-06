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

test("emits one article page and the artifact files", () => {
  assert.deepEqual(pages().sort(), ["artifacts/index.html", "index.html"]);

  for (const p of manifest.projects) {
    assert.ok(files.includes(`artifacts/${p.id}.json`), p.id);
  }
});

test("the article covers every project in pipeline order", () => {
  const html = read("index.html");

  /** @type {number[]} */
  const order = manifest.projects.map((/** @type {any} */ p) =>
    html.indexOf(`<section class="project" id="${p.id}"`),
  );

  assert.ok(
    order.every((i) => i > 0),
    "every project has a section",
  );

  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    "projects in order",
  );

  for (const p of manifest.projects) {
    assert.ok(html.includes(`href="#${p.id}"`), `${p.id}: contents link`);
  }
});

test("each project links its walkthrough, architecture, run steps and tests", () => {
  const html = read("index.html");

  for (const p of manifest.projects) {
    for (const note of ["walkthrough", "architecture", "run", "tests"]) {
      const id = `note-${p.id}-${note}`;
      assert.ok(html.includes(`href="#${id}"`), `${p.id}: no link to ${note}`);
      assert.match(html, new RegExp(`<section class="note" id="${id}"`), id);
    }

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

test("json-schema-mlir has a trace viewer note with provenance and a static fallback", () => {
  const html = read("index.html");
  assert.ok(html.includes('href="#note-schema-mlir-trace"'), "linked");

  assert.match(
    html,
    /<section class="note" id="note-schema-mlir-trace" data-wide /,
    "wide note",
  );

  const note = html.slice(html.indexOf('id="note-schema-mlir-trace"'));

  const art = note.slice(
    0,
    note.indexOf("</section>", note.indexOf("data-artifact")),
  );

  assert.match(art, /data-artifact="schema-trace"/);
  assert.match(art, /class="badge captured"/);
  assert.match(art, /--emit-trace=person\.trace\.json/);

  for (const pane of ["src", "tok", "ast", "ir"]) {
    assert.ok(art.includes(`data-pane="${pane}"`), pane);
  }

  assert.match(art, /<details open>/, "AST is expanded without JS");
  assert.match(art, /Without JavaScript/);
  assert.match(html, /assets\/trace-viewer\.js/);
});

test("in-page links resolve and ids are unique", () => {
  for (const page of pages()) {
    const html = read(page);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${page}: duplicate ids`);

    for (const m of html.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(ids.includes(m[1]), `${page} → #${m[1]}`);
    }
  }
});

test("every rendered artifact carries a provenance label", () => {
  for (const page of pages()) {
    const html = read(page);

    for (const m of html.matchAll(
      /<section class="artifact" data-artifact="([^"]+)">([\s\S]*?)<\/section>/g,
    )) {
      assert.match(
        m[2],
        /class="badge (captured|static|unavailable)"/,
        `${page}#${m[1]}`,
      );
    }
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

    for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
      assert.match(img, /\balt="/, page);
    }
  }
});

test("pages stay small and ship no third-party scripts", () => {
  for (const page of pages()) {
    const html = read(page);
    assert.ok(html.length < 250_000, `${page} is ${html.length} bytes`);

    for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
      assert.doesNotMatch(m[1], /^https?:/, page);
    }
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
