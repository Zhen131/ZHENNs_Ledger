import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SOURCE_README = readFileSync(join(SRC_ROOT, "README.md"), "utf8");
const ROOT_README = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
const TESTS_DIRECTORY = "__tests__";

describe("source README", () => {
  it("lists exactly the top-level source areas", () => {
    expect(codeBlockDirectories(SOURCE_README, "src/")).toEqual(
      directoryNames(SRC_ROOT),
    );
  });

  it("lists exactly the app areas", () => {
    expect(codeBlockDirectories(SOURCE_README, "app/")).toEqual(
      directoryNames(join(SRC_ROOT, "app")),
    );
  });

  it("describes exactly the core areas", () => {
    expect(sectionEntries(SOURCE_README, "### `core`")).toEqual(
      directoryNames(join(SRC_ROOT, "core")),
    );
  });

  it("describes exactly the platform areas", () => {
    expect(sectionEntries(SOURCE_README, "### `platform`")).toEqual(
      directoryNames(join(SRC_ROOT, "platform")),
    );
  });

  it("names exactly the features in the root README source layout", () => {
    expect(featureTableNames(ROOT_README)).toEqual(
      directoryNames(join(SRC_ROOT, "features")),
    );
  });
});

function codeBlockDirectories(markdown: string, firstLinePrefix: string): string[] {
  const block = codeBlocks(markdown).find((lines) =>
    (lines[0] ?? "").startsWith(firstLinePrefix),
  );
  expect(block, `code block starting with ${firstLinePrefix}`).toBeDefined();
  return sortedNames(
    (block ?? []).flatMap((line) => {
      const match = /^ {2}([^\s/]+)\//u.exec(line);
      return match ? [match[1]] : [];
    }),
  );
}

function codeBlocks(markdown: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] | undefined;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      if (current === undefined) {
        current = [];
      } else {
        blocks.push(current);
        current = undefined;
      }
    } else if (current !== undefined) {
      current.push(line);
    }
  }
  return blocks;
}

function sectionEntries(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,3} /u.test(line));
  return sortedNames(
    (end === -1 ? rest : rest.slice(0, end)).flatMap((line) => {
      const match = /^- `([^`]+)`/u.exec(line);
      return match ? [match[1]] : [];
    }),
  );
}

function featureTableNames(markdown: string): string[] {
  const row = markdown
    .split("\n")
    .find((line) => /^\|\s*`src\/features`\s*\|/u.test(line));
  expect(row, "root README row for src/features").toBeDefined();
  const description = (row ?? "").split("|")[2] ?? "";
  const afterColon = description.slice(description.indexOf(":") + 1);
  return sortedNames(
    [...afterColon.matchAll(/`([^`]+)`/gu)].map((match) => match[1]),
  );
}

function directoryNames(directory: string): string[] {
  return sortedNames(
    readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          entry.name !== TESTS_DIRECTORY,
      )
      .map((entry) => entry.name),
  );
}

function sortedNames(names: string[]): string[] {
  return [...names].sort();
}
