import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));
const INTERFACE_ROOTS = [join(SRC_ROOT, "app"), join(SRC_ROOT, "features")];
const DEPRECATED_INTERFACE_TERMS = [
  "总花费",
  "盈亏金额",
  "平均购价",
  "涨跌幅",
  "含费平均成本",
  "剩余含费成本",
  "已实现净盈亏",
  "未实现净盈亏",
  "累计买入总支出",
] as const;

describe("interface wording", () => {
  it("removes every deprecated holdings label from app and feature sources", () => {
    const matches = INTERFACE_ROOTS.flatMap(collectTypeScriptFiles).flatMap(
      (filePath) => {
        const source = readFileSync(filePath, "utf8");
        return DEPRECATED_INTERFACE_TERMS.filter((term) =>
          source.includes(term),
        ).map((term) => `${relative(SRC_ROOT, filePath)}: ${term}`);
      },
    );

    expect(matches).toEqual([]);
  });
});

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [entryPath] : [];
  });
}
