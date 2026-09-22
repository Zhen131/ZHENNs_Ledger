import { FlatCompat } from "@eslint/eslintrc";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  baseDirectory: currentDirectory,
});

function directoryNames(relativeDirectory) {
  return readdirSync(path.join(currentDirectory, relativeDirectory), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

const featureNames = directoryNames("src/features");
const appAreas = directoryNames("src/app").filter((name) => name !== "fonts");
const appAreaPattern =
  appAreas.length > 0 ? `(?:${appAreas.map(escapeRegex).join("|")})` : "(?!)";

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
    regex: "^@/(?:ui|test-support)/.+",
    message: "Import this area through its top-level stable entry.",
  },
  {
    regex: `^@/app/(?!${appAreaPattern}$).+`,
    message: "Import app code through @/app or an app area entry @/app/<area>.",
  },
  {
    regex: `^@/(?!core/[^/]+$|platform/(?:[^/]+|persistence/identity)$|features/[^/]+(?:/ui)?$|app(?:/${appAreaPattern})?$|ui$|test-support$).+`,
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
  ...featureNames.map((feature) => ({
    files: [`src/features/${feature}/**/*.{ts,tsx}`],
    entry: `@/features/${feature}`,
  })),
  ...["test-support", "ui"].map((area) => ({
    files: [`src/${area}/**/*.{ts,tsx}`],
    entry: `@/${area}`,
  })),
  {
    files: ["src/app/*.{ts,tsx}"],
    entry: "@/app",
    selfImportRegexes: ["^@/app$"],
  },
  ...appAreas.map((area) => ({
    files: [`src/app/${area}/**/*.{ts,tsx}`],
    entry: `@/app/${area}`,
    selfImportRegexes: ["^@/app$", `^${escapeRegex(`@/app/${area}`)}(?:$|/)`],
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
  ...sourceAreaEntries.map(({ files, entry, selfImportRegexes }) => ({
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...stableImportPatterns,
            ...(selfImportRegexes ?? [`^${escapeRegex(entry)}(?:$|/)`]).map(
              (regex) => ({
                regex,
                message: `Code inside ${entry} must use same-directory ./file imports instead of its own stable entry.`,
              }),
            ),
          ],
        },
      ],
    },
  })),
];

export default eslintConfig;
