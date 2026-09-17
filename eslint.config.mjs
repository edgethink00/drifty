// Lint gate for the desktop UI and shared TypeScript packages.
//
// Existing violations are frozen in eslint-suppressions.json (ESLint bulk
// suppressions). New code fails CI on any listed rule; fix or, with a reason,
// disable the specific line. Prune resolved entries with:
//   npm run lint -- --prune-suppressions
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/target/**",
      "**/*.d.ts",
      "apps/docs/**",
      "apps/desktop/scripts/**",
      "apps/desktop/public/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["apps/desktop/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // React Compiler rules do not apply to this React 18 codebase.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/immutability": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
);
