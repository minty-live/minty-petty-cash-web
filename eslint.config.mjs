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
    // pdf.js's minified worker, copied in by next.config.ts (gitignored; as in Payment Request)
    "public/pdfjs/**",
  ]),
  {
    // No native browser dialog anywhere - alert/confirm/prompt or "Leave site?" (owner, 2026-11-16)
    rules: {
      "no-alert": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value='beforeunload']",
          message: "No native browser dialogs (owner, 2026-11-16): ask in the page instead.",
        },
      ],
    },
  },
]);

export default eslintConfig;
