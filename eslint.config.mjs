import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  baseDirectory: currentDirectory,
});

const stableImportPatterns = [
  {
    regex: "^\\.\\./",
    message: "Parent-relative imports are not allowed; use a stable source entry point.",
  },
  {
    regex: "^@/core/[^/]+/.+",
    message: "Import core code through @/core/<area>.",
  },
  {
    regex: "^@/platform/(?!persistence/identity$)[^/]+/.+",
    message: "Import platform code through @/platform/<area> or the registered persistence/identity entry.",
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
      "^@/(?!core/[^/]+$|platform/(?:[^/]+|persistence/identity)$|features/[^/]+(?:/ui)?$|app$|ui$|test-support$).+",
    message: "This source alias is not part of the stable entry-point contract.",
  },
  {
    regex: "^@root(?:$|/(?!package\\.json$).+)",
    message: "Only @root/package.json is allowed.",
  },
];

const sourceAreaEntries = [
  ...[
    "calculations",
    "catalog",
    "models",
    "policies",
    "shared",
    "state",
    "validation",
  ].map((area) => ({
    files: [`src/core/${area}/**/*.{ts,tsx}`],
    entry: `@/core/${area}`,
  })),
  ...[
    "coordination",
    "encryption",
    "files",
    "integrations",
    "legacy",
    "persistence",
  ].map((area) => ({
    files: [`src/platform/${area}/**/*.{ts,tsx}`],
    entry: `@/platform/${area}`,
  })),
  ...[
    "backup",
    "charts",
    "fees",
    "market-data",
    "portfolio",
    "prices",
    "trades",
  ].map((feature) => ({
    files: [`src/features/${feature}/**/*.{ts,tsx}`],
    entry: `@/features/${feature}`,
  })),
  ...["app", "test-support", "ui"].map((area) => ({
    files: [`src/${area}/**/*.{ts,tsx}`],
    entry: `@/${area}`,
  })),
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
          patterns: stableImportPatterns,
        },
      ],
    },
  },
  ...sourceAreaEntries.map(({ files, entry }) => ({
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...stableImportPatterns,
            {
              regex: `^${escapeRegex(entry)}(?:$|/)`,
              message: `Code inside ${entry} must use same-directory ./file imports instead of its own stable entry.`,
            },
          ],
        },
      ],
    },
  })),
];

export default eslintConfig;
