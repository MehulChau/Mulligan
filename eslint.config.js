// Flat config (ESLint 9+), one file for the whole monorepo -- "keep it
// simple," per Part F's own brief, rather than a config per workspace.
// typescript-eslint's plain `recommended` (not `recommendedTypeChecked`):
// the type-checked variant needs each package's tsconfig wired through
// `parserOptions.project`, which is real setup cost for a CI gate whose
// job is catching obvious mistakes fast, not doing tsc's job a second way
// -- `tsc --noEmit` (already a separate CI/build step) is what actually
// owns type correctness.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts", "apps/web/dev-dist/**", "**/bundle/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Deliberately off, not just unenforced: every RawShotEvent/ShotEvent
      // field the codebase leaves unused on purpose (e.g. a device
      // capability a v1 rig doesn't send) is already handled by real
      // optional-field types, not by a lint escape hatch.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // apps/web only -- the packages are plain TS with no React/browser APIs.
    // Only the two classic rules (rules-of-hooks, exhaustive-deps) --
    // eslint-plugin-react-hooks 6+'s "recommended" config folds in a set
    // of new React-Compiler-oriented rules (react-hooks/purity,
    // react-hooks/refs) that flag long-established, runtime-safe patterns
    // this codebase already relies on throughout (a ref updated in the
    // render body for a rAF loop to read later, a ref value passed
    // straight into JSX): real patterns, not bugs, just patterns those new
    // rules are stricter than this codebase's actual target (today's
    // React, not a future compiler pass) needs to be.
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["tools/**/*.ts", "**/*.config.ts", "*.config.js", "verify-m0.ts"],
    languageOptions: { globals: globals.node },
  },
);
