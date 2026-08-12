import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_AREAS = [
  "app",
  "core",
  "features",
  "platform",
  "test-support",
  "ui",
] as const;
const LEGACY_TOP_LEVEL_AREAS = [
  "adapters",
  "backup",
  "calculators",
  "components",
  "composition",
  "coordination",
  "data",
  "encryption",
  "hooks",
  "marketData",
  "models",
  "policies",
  "repositories",
  "services",
  "state",
  "test",
  "utils",
  "validators",
] as const;
const FEATURES = [
  "backup",
  "charts",
  "fees",
  "market-data",
  "portfolio",
  "prices",
  "trades",
] as const;
const CORE_AREAS = [
  "calculations",
  "catalog",
  "models",
  "policies",
  "shared",
  "state",
  "validation",
] as const;
const PLATFORM_AREAS = [
  "coordination",
  "encryption",
  "files",
  "integrations",
  "legacy",
  "persistence",
] as const;

describe("source layout", () => {
  it("keeps only the six responsibility areas and README at the src root", () => {
    const entries = readdirSync(SRC_ROOT, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();

    expect(entries).toEqual([...SOURCE_AREAS, "README.md"].sort());
  });

  it("does not restore any legacy top-level area", () => {
    const entries = new Set(readdirSync(SRC_ROOT));

    for (const area of LEGACY_TOP_LEVEL_AREAS) {
      expect(entries.has(area), area).toBe(false);
    }
  });

  it("keeps every feature flat with separate logic and UI entries", () => {
    for (const feature of FEATURES) {
      const featureRoot = join(SRC_ROOT, "features", feature);
      const entries = readdirSync(featureRoot, { withFileTypes: true });

      expect(entries.some((entry) => entry.name === "index.ts"), feature).toBe(
        true,
      );
      expect(entries.some((entry) => entry.name === "ui.ts"), feature).toBe(
        true,
      );
      expect(
        entries.filter((entry) => entry.isDirectory()),
        `${feature} must remain flat`,
      ).toEqual([]);
    }
  });

  it("keeps every stable entry point", () => {
    for (const area of CORE_AREAS) {
      expect(fileNames(join(SRC_ROOT, "core", area))).toContain("index.ts");
    }
    for (const area of PLATFORM_AREAS) {
      expect(fileNames(join(SRC_ROOT, "platform", area))).toContain(
        "index.ts",
      );
    }
    for (const area of ["app", "ui", "test-support"] as const) {
      expect(fileNames(join(SRC_ROOT, area))).toContain("index.ts");
    }
  });

  it("keeps tracked TypeScript imports on the stable source contract", () => {
    const violations: string[] = [];

    for (const file of sourceFiles(SRC_ROOT)) {
      const source = readFileSync(file, "utf8");
      const importPattern = /(?:\bfrom\s+|\bimport\s*\()\s*["']([^"']+)["']/g;

      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1];
        const reason = importViolation(specifier);
        if (reason) {
          violations.push(
            `${file.slice(SRC_ROOT.length + 1)}: ${specifier} (${reason})`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

function fileNames(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function importViolation(specifier: string): string | undefined {
  if (specifier.startsWith("../")) {
    return "parent-relative import";
  }
  if (/^@\/core\/[^/]+\/.+/.test(specifier)) {
    return "deep core import";
  }
  if (/^@\/platform\/[^/]+\/.+/.test(specifier)) {
    return "deep platform import";
  }
  if (/^@\/features\/[^/]+\/(?!ui$).+/.test(specifier)) {
    return "deep feature import";
  }
  if (/^@\/(?:app|ui|test-support)\/.+/.test(specifier)) {
    return "deep top-level entry import";
  }
  if (
    specifier.startsWith("@/") &&
    !/^@\/(?:core\/[^/]+|platform\/[^/]+|features\/[^/]+(?:\/ui)?|app|ui|test-support)$/.test(
      specifier,
    )
  ) {
    return "unsupported source alias";
  }
  if (specifier.startsWith("@root") && specifier !== "@root/package.json") {
    return "unsupported root import";
  }
  return undefined;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) {
      return [];
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}
