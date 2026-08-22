import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import money from "./eslint-rules/index.mjs";

/**
 * Float prohibition, layer 2.
 *
 * `_architecture/30-CALCULATIONS.md` §1.3 asks for three layers, because
 * documentation does not prevent this. Types are layer 1 — `Money` exposes no
 * arithmetic operators. `tests/schema-integrity.spec.ts` is layer 3. This is the
 * middle one.
 *
 * Type-aware linting covers `src/**` only. It costs roughly one extra `tsc` pass,
 * and every money path lives under `src/`; `app/` and `components/` render values
 * that `src/ui/format.ts` has already turned into strings.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Frozen v1 snapshot, kept for porting only — never imported, never shipped.
    "_reference/**",
    // Test-runner scratch output (esbuild bundles), not source.
    "tmp/**",
  ]),

  // ── The exact-numeric core: type-aware ────────────────────────────────────
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { money },
    rules: { "money/no-float-money": "error" },
  },

  // ── The one ban that needs no types ──────────────────────────────────────
  // `parseFloat` is never correct on a money path. Everything else that looked
  // like a candidate for a syntactic ban — `Number()`, `Math.round()`,
  // `.toFixed()` — has legitimate non-money uses here: `CalendarDate.parse` does
  // `Number(year)`, and a repository does `Number(row.postingCount)` on a COUNT.
  // Those checks live in the type-aware rule instead, where money can be told
  // apart from an integer.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "parseFloat",
          message:
            "parseFloat produces a float. Money is bigint minor units — use Money.fromRupees(), or Quantity.fromString() for a unit count.",
        },
      ],
    },
  },

  // `core/money.ts` and `core/numeric.ts` implement the exact parsing and
  // rendering that everything else defers to, so they are the one place allowed
  // to convert deliberately between a string, a bigint and a number.
  {
    files: ["src/core/money.ts", "src/core/numeric.ts"],
    rules: { "money/no-float-money": "off" },
  },

  // ── The design system: no raw hex outside tokens.css ─────────────────────
  {
    files: ["components/**/*.tsx", "app/**/*.tsx", "src/ui/**/*.tsx"],
    plugins: { money },
    rules: { "money/no-raw-hex": "error" },
  },

  // ── The schema: no floating-point columns ────────────────────────────────
  {
    files: ["src/infra/db/**/*.ts"],
    plugins: { money },
    rules: { "money/no-float-columns": "error" },
  },

  // Tests generate random inputs and assert on formatted output; the runner and
  // the lint rules themselves are plain scripts.
  {
    files: ["tests/**/*.ts", "scripts/**/*.mjs", "eslint-rules/**/*.mjs"],
    rules: {
      "money/no-float-money": "off",
      "no-restricted-globals": "off",
    },
  },
]);

export default eslintConfig;
