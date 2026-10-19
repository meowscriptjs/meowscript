// ESLint flat configuration for MeowScript.
//
// ESLint owns code quality (unused bindings, undefined globals, suspicious
// patterns); Prettier owns formatting. `eslint-config-prettier` is applied last
// so the two never disagree about whitespace or layout.
import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  {
    // Vendored reference sources, dependencies and build output are never linted.
    ignores: [
      "**/node_modules/**",
      "reference/**",
      ".freebuff/**",
      "**/build/**",
      "coverage/**",
      "**/dist/**",
      // VS Code web builds downloaded by @vscode/test-web
      "**/.vscode-test-web/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  prettier,
];
