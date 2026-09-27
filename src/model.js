// Shared data model for the lab: the project manifest and the artifacts each
// project contributes. JSDoc types are checked by `tsc`; the validators below
// are what the build, the capture script and the tests actually enforce.

/** The pipeline stages the portal is organised around, in order. */
export const STAGES = /** @type {const} */ ([
  "source",
  "diagnostics",
  "mlir",
  "passes",
  "debugging",
  "profiling",
]);

/** The required cross-link chain; manifest `projects` must appear in this order. */
export const CHAIN = /** @type {const} */ ([
  "schema-mlir",
  "vizmlir",
  "mlir-lldb-tools",
  "nano-dsp-mlir",
]);

export const ARTIFACT_KINDS = /** @type {const} */ ([
  "source",
  "diagnostic",
  "ir-snapshot",
  "pass-event",
  "debug-value",
  "profile",
  "execution",
  "test-run",
]);

/** @typedef {typeof STAGES[number]} Stage */
/** @typedef {typeof ARTIFACT_KINDS[number]} ArtifactKind */

/**
 * @typedef {object} Project
 * @property {string} id            Stable portal id (also the page slug).
 * @property {string} name          Display name.
 * @property {string} repo          GitHub `owner/name`.
 * @property {string} version       `git describe --tags` of `commit`.
 * @property {string | null} releaseTag Newest release tag at or before `commit`, if any.
 * @property {string} commit        Full 40-hex pinned commit. Never a branch.
 * @property {string} demoPath      Portal-relative path of the guided tour.
 * @property {string} docsPath      Repo-relative path of the technical docs.
 * @property {Stage[]} stages       Pipeline stages this project covers.
 * @property {string[]} capabilities Short capability statements.
 * @property {string} [liveUrl] The project's own hosted app (tracks its main branch, not `commit`).
 */

/**
 * @typedef {object} Manifest
 * @property {1} schemaVersion
 * @property {{ llvm: string, python: string, node: string }} toolchain Toolchain used for captures.
 * @property {Project[]} projects   In cross-link order (see CHAIN).
 */

/**
 * `captured`: produced by running the project's own tool at the pinned commit.
 * `static`: a file read verbatim from the project repo (or this repo) at the pinned commit.
 * `unavailable`: deliberately absent; `reason` says why. Never replaced by a mock.
 * @typedef {object} Provenance
 * @property {"captured" | "static" | "unavailable"} mode
 * @property {string} [command] Exact command for `captured`.
 * @property {string} [path]    Repo-relative source path for `static`; `lab:` prefix for this repo.
 * @property {string} [reason]  Required for `unavailable`.
 */

/**
 * @typedef {object} SourceLocation
 * @property {string} file   Repo-relative path, or `lab:`-prefixed for inputs in this repo.
 * @property {number} line   1-based.
 * @property {number} [column] 1-based.
 */

/**
 * @typedef {object} ArtifactBase
 * @property {string} id
 * @property {ArtifactKind} kind
 * @property {string} title
 * @property {Provenance} provenance
 */

/** @typedef {ArtifactBase & { kind: "source", language: string, text: string, location?: SourceLocation }} SourceArtifact */
/** @typedef {{ severity: "error" | "warning" | "note" | "remark", message: string, location: SourceLocation | null }} DiagnosticEntry */
/** @typedef {ArtifactBase & { kind: "diagnostic", tool: string, exitCode: number, entries: DiagnosticEntry[] }} DiagnosticArtifact */
/**
 * @typedef {object} GraphSummary VizMLIR's parse of an IR snapshot.
 * @property {number} nodes
 * @property {number} edges
 * @property {{ message: string, line: number, symbol: string }[]} diagnostics
 */
/** @typedef {ArtifactBase & { kind: "ir-snapshot", stage: string, text: string, location?: SourceLocation, graph?: GraphSummary }} IRSnapshotArtifact */
/** @typedef {{ type: "added" | "removed" | "changed", before?: string, after?: string }} DiffRow */
/**
 * @typedef {ArtifactBase & {
 *   kind: "pass-event", pass: string, index: number, changed: boolean,
 *   before: string | null, after: string | null,
 *   diff?: { tool: string, rows: DiffRow[], beforeGraph?: GraphSummary, afterGraph?: GraphSummary }
 * }} PassEventArtifact
 * `before`/`after` are ids of ir-snapshot artifacts (in any project file; ids are global).
 */
/** @typedef {ArtifactBase & { kind: "debug-value", name: string, type: string, summary: string, location: SourceLocation | null }} DebugValueArtifact */
/** @typedef {{ name: string, value: number, percent: number, depth: number }} ProfileEntry */
/** @typedef {ArtifactBase & { kind: "profile", metric: string, unit: string, total: number, entries: ProfileEntry[] }} ProfileArtifact */
/** @typedef {ArtifactBase & { kind: "execution", exitCode: number, stdout: string, expected?: string[] }} ExecutionArtifact */
/** @typedef {ArtifactBase & { kind: "test-run", runner: string, passed: number, failed: number, errors: number, skipped: number, log: string }} TestRunArtifact */
/** @typedef {ArtifactBase & { provenance: Provenance & { mode: "unavailable" } }} UnavailableArtifact */

/**
 * @typedef {SourceArtifact | DiagnosticArtifact | IRSnapshotArtifact | PassEventArtifact
 *   | DebugValueArtifact | ProfileArtifact | ExecutionArtifact | TestRunArtifact} Artifact
 */

/**
 * One file per project under `artifacts/`. `commit` must equal the manifest pin.
 * @typedef {object} ArtifactFile
 * @property {string} project
 * @property {string} commit
 * @property {{ capturedAt: string, host: string, toolchain: Record<string, string> }} capture
 * @property {Artifact[]} artifacts
 */

const SHA = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** @param {unknown} v */
const isStr = (v) => typeof v === "string" && v.length > 0;

/**
 * @param {unknown} m
 * @returns {string[]} errors; empty when valid
 */
export function validateManifest(m) {
  const errs = [];
  if (!isObj(m)) return ["manifest: not an object"];
  if (m.schemaVersion !== 1) errs.push("manifest.schemaVersion must be 1");
  if (
    !isObj(m.toolchain) ||
    !["llvm", "python", "node"].every((k) => isStr(m.toolchain[k]))
  )
    errs.push("manifest.toolchain needs llvm, python, node");
  if (!Array.isArray(m.projects))
    return [...errs, "manifest.projects must be an array"];

  const ids = m.projects.map((/** @type {any} */ p) => p?.id);
  if (ids.join() !== CHAIN.join())
    errs.push(`manifest.projects order must be ${CHAIN.join(" → ")}`);

  for (const p of m.projects) {
    const at = `project ${p?.id ?? "?"}`;
    if (!isObj(p)) {
      errs.push(`${at}: not an object`);
      continue;
    }
    for (const k of ["id", "name", "repo", "version", "demoPath", "docsPath"])
      if (!isStr(p[k])) errs.push(`${at}: ${k} is required`);
    if (isStr(p.id) && !ID.test(p.id))
      errs.push(`${at}: id must be kebab-case`);
    if (isStr(p.repo) && !/^[\w.-]+\/[\w.-]+$/.test(p.repo))
      errs.push(`${at}: repo must be owner/name`);
    if (!SHA.test(p.commit ?? ""))
      errs.push(`${at}: commit must be a full 40-hex SHA (got ${p.commit})`);
    if (p.releaseTag !== null && !isStr(p.releaseTag))
      errs.push(`${at}: releaseTag must be a string or null`);
    if (
      !Array.isArray(p.stages) ||
      p.stages.length === 0 ||
      !p.stages.every((s) => STAGES.includes(s))
    )
      errs.push(
        `${at}: stages must be a non-empty subset of ${STAGES.join(", ")}`,
      );
    if (
      !Array.isArray(p.capabilities) ||
      p.capabilities.length === 0 ||
      !p.capabilities.every(isStr)
    )
      errs.push(`${at}: capabilities must be non-empty strings`);
    if (
      p.liveUrl !== undefined &&
      !(isStr(p.liveUrl) && p.liveUrl.startsWith("https://"))
    )
      errs.push(`${at}: liveUrl must be an https URL`);
  }
  const covered = new Set(
    m.projects.flatMap((/** @type {any} */ p) => p?.stages ?? []),
  );
  for (const s of STAGES)
    if (!covered.has(s)) errs.push(`no project covers stage "${s}"`);
  return errs;
}

/** @param {unknown} loc @param {string} at @param {string[]} errs */
function checkLocation(loc, at, errs) {
  if (
    !isObj(loc) ||
    !isStr(loc.file) ||
    !Number.isInteger(loc.line) ||
    loc.line < 1
  )
    errs.push(`${at}: location needs file and 1-based line`);
  else if (
    loc.column !== undefined &&
    (!Number.isInteger(loc.column) || loc.column < 1)
  )
    errs.push(`${at}: location.column must be 1-based`);
}

/** Required fields per kind, beyond the common ones. Checked only when not `unavailable`. */
const KIND_FIELDS = {
  source: { language: "string", text: "string" },
  diagnostic: { tool: "string", exitCode: "number", entries: "array" },
  "ir-snapshot": { stage: "string", text: "string" },
  "pass-event": { pass: "string", index: "number", changed: "boolean" },
  "debug-value": { name: "string", type: "string", summary: "string" },
  profile: {
    metric: "string",
    unit: "string",
    total: "number",
    entries: "array",
  },
  execution: { exitCode: "number", stdout: "string" },
  "test-run": {
    runner: "string",
    passed: "number",
    failed: "number",
    errors: "number",
    skipped: "number",
    log: "string",
  },
};

/**
 * @param {unknown} a
 * @returns {string[]}
 */
export function validateArtifact(a) {
  const errs = [];
  if (!isObj(a)) return ["artifact: not an object"];
  const at = `artifact ${a.id ?? "?"}`;
  if (!isStr(a.id) || !ID.test(a.id)) errs.push(`${at}: id must be kebab-case`);
  if (!ARTIFACT_KINDS.includes(a.kind))
    errs.push(`${at}: unknown kind ${a.kind}`);
  if (!isStr(a.title)) errs.push(`${at}: title is required`);

  const pv = a.provenance;
  if (!isObj(pv) || !["captured", "static", "unavailable"].includes(pv.mode)) {
    errs.push(`${at}: provenance.mode must be captured, static or unavailable`);
    return errs;
  }
  if (pv.mode === "captured" && !isStr(pv.command))
    errs.push(`${at}: captured artifacts must record the command`);
  if (pv.mode === "static" && !isStr(pv.path))
    errs.push(`${at}: static artifacts must record the source path`);
  if (pv.mode === "unavailable") {
    if (!isStr(pv.reason))
      errs.push(`${at}: unavailable artifacts must give a reason`);
    return errs;
  }

  const fields = KIND_FIELDS[/** @type {ArtifactKind} */ (a.kind)] ?? {};
  for (const [k, t] of Object.entries(fields)) {
    const ok = t === "array" ? Array.isArray(a[k]) : typeof a[k] === t;
    if (!ok) errs.push(`${at}: ${k} must be ${t}`);
  }
  if (a.location !== undefined) checkLocation(a.location, at, errs);
  if (a.kind === "diagnostic" && Array.isArray(a.entries)) {
    if (a.entries.length === 0)
      errs.push(`${at}: diagnostic must have at least one entry`);
    for (const e of a.entries) {
      if (
        !isObj(e) ||
        !["error", "warning", "note", "remark"].includes(e.severity) ||
        !isStr(e.message)
      )
        errs.push(`${at}: diagnostic entries need severity and message`);
      else if (e.location !== null) checkLocation(e.location, at, errs);
    }
  }
  if (a.kind === "debug-value" && a.location !== null)
    checkLocation(a.location, at, errs);
  if (a.kind === "pass-event") {
    for (const k of ["before", "after"])
      if (a[k] !== null && !isStr(a[k]))
        errs.push(`${at}: ${k} must be an id or null`);
    if (
      a.diff !== undefined &&
      (!isObj(a.diff) || !isStr(a.diff.tool) || !Array.isArray(a.diff.rows))
    )
      errs.push(`${at}: diff needs tool and rows`);
  }
  if (a.kind === "profile" && Array.isArray(a.entries))
    for (const e of a.entries)
      if (
        !isObj(e) ||
        !isStr(e.name) ||
        typeof e.value !== "number" ||
        typeof e.percent !== "number"
      )
        errs.push(`${at}: profile entries need name, value, percent`);
  return errs;
}

/**
 * Validates one artifacts/<id>.json file against the manifest pin.
 * @param {unknown} f
 * @param {Project} project
 * @returns {string[]}
 */
export function validateArtifactFile(f, project) {
  if (!isObj(f)) return [`artifacts/${project.id}.json: not an object`];
  const errs = [];
  if (f.project !== project.id)
    errs.push(`artifacts/${project.id}.json: project is ${f.project}`);
  if (f.commit !== project.commit)
    errs.push(
      `artifacts/${project.id}.json: captured at ${f.commit}, manifest pins ${project.commit} — re-run capture`,
    );
  if (
    !isObj(f.capture) ||
    !isStr(f.capture.capturedAt) ||
    !isStr(f.capture.host)
  )
    errs.push(
      `artifacts/${project.id}.json: capture.capturedAt and capture.host are required`,
    );
  if (!Array.isArray(f.artifacts))
    return [
      ...errs,
      `artifacts/${project.id}.json: artifacts must be an array`,
    ];
  const seen = new Set();
  for (const a of f.artifacts) {
    errs.push(...validateArtifact(a));
    if (seen.has(a?.id))
      errs.push(`artifacts/${project.id}.json: duplicate id ${a.id}`);
    seen.add(a?.id);
  }
  return errs;
}
