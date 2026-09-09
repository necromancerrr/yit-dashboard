import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Scratch checkouts made when running background agents — linting another
    // copy of this repo reports the same findings twice, and its build output.
    ".claude/worktrees/**",
  ]),
  // The service worker runs in a worker global, not a window one, and is not
  // bundled — so it needs its own globals declared here rather than an
  // `/* eslint-env */` comment, which flat config no longer honours.
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        caches: "readonly",
        clients: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        URL: "readonly",
        console: "readonly",
      },
    },
  },
]);

export default eslintConfig;
