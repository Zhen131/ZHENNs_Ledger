import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  baseDirectory: currentDirectory,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^\\.\\./",
              message: "Parent-relative imports are not allowed; use a stable source entry point.",
            },
            {
              regex: "^@/core/[^/]+/.+",
              message: "Import core code through @/core/<area>.",
            },
            {
              regex: "^@/platform/[^/]+/.+",
              message: "Import platform code through @/platform/<area>.",
            },
            {
              regex: "^@/features/[^/]+/(?!ui$).+",
              message: "Import feature logic through @/features/<feature> and UI through its /ui entry.",
            },
            {
              regex: "^@/(?:app|ui|test-support)/.+",
              message: "Import this area through its top-level stable entry.",
            },
            {
              regex:
                "^@/(?!core/[^/]+$|platform/[^/]+$|features/[^/]+(?:/ui)?$|app$|ui$|test-support$).+",
              message: "This source alias is not part of the stable entry-point contract.",
            },
            {
              regex: "^@root(?:$|/(?!package\\.json$).+)",
              message: "Only @root/package.json is allowed.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
