import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-electron/**",
      "release/**",
      "node_modules/**",
      "native-host/**",
      "native-window/**",
      "video-engine/**",
      ".tools/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn"
    }
  },
  {
    files: ["electron/**/*.ts"],
    languageOptions: { globals: globals.node },
    // Native addons and optional packages are loaded lazily with require().
    rules: { "@typescript-eslint/no-require-imports": "off" }
  },
  {
    files: ["**/*.cjs", "scripts/**/*.js", "build/**/*.js"],
    languageOptions: { globals: globals.node, sourceType: "commonjs" },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      // `const crypto = require("node:crypto")` intentionally shadows the Node global.
      "no-redeclare": ["error", { builtinGlobals: false }],
      // Fixture cleanup guards throw from `finally` on purpose to refuse unsafe deletes.
      "no-unsafe-finally": "off"
    }
  },
  {
    // Visual tests ship functions into the renderer via executeJavaScript.
    files: ["tests/visual/**/*.cjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    // Source-text assertions match exact indentation.
    files: ["tests/**/*.cjs"],
    rules: { "no-regex-spaces": "off" }
  },
  {
    rules: {
      // TypeScript already reports unused locals/parameters via tsconfig.
      "@typescript-eslint/no-unused-vars": "off",
      // Empty catch blocks are used deliberately for best-effort cleanup.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Handlers declared early and assigned later are read inside cleanup closures.
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
      // `cond ? a() : b()` is an established statement style in this codebase.
      "@typescript-eslint/no-unused-expressions": ["error", { allowTernary: true, allowShortCircuit: true }],
      // Existing `any` usages are tracked as warnings until they are typed.
      "@typescript-eslint/no-explicit-any": "warn",
      // `if (false)` / `{false && ...}` mark retained dead code; flag it without blocking.
      "no-constant-condition": "warn",
      "no-constant-binary-expression": "warn"
    }
  }
);
