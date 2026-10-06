export const STAGES = /** @type {const} */ ([
  "source",
  "diagnostics",
  "mlir",
  "passes",
  "profiling",
]);

export const STAGE_LABEL = {
  source: "Source",
  diagnostics: "Diagnostics",
  mlir: "MLIR",
  passes: "Pass inspection",
  profiling: "Profiling",
};

export const CHAIN = /** @type {const} */ ([
  "schema-mlir",
  "vizmlir",
  "nano-dsp-mlir",
]);

export const ARTIFACT_KINDS = /** @type {const} */ ([
  "source",
  "diagnostic",
  "ir-snapshot",
  "pass-event",
  "profile",
  "execution",
  "test-run",
  "trace",
]);

export const TRACE_FORMAT = "json-schema-mlir-trace";
export const TRACE_VERSION = 1;
export const AST_KINDS = ["schema", "property", "keyword"];

export const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const LONG_LINES = 40;
export const DIFF_ROWS_COLLAPSED = 12;

export const THEME_KEY = "theme";

export const TERMINAL_KEYS = {
  open: "term-open",
  width: "term-width",
  project: "term-project",
};

export const WIDE_SCREEN = "(min-width: 900px)";
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export const TERMINAL_WIDTH = {
  min: 0.25,
  max: 0.75,
  initial: 0.5,
  step: 0.02,
};

export const HEAT_PERCENT = { hot: 30, warm: 10 };
export const PROFILE_NAME_WIDTH = 44;

export const TYPING = {
  chunks: 28,
  charDelayMs: 14,
  spinnerFrames: 9,
  spinnerDelayMs: 45,
};

export const COPY_RESET_MS = 1500;
