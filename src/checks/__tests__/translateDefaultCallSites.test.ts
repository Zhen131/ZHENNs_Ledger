import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * `translateDefault(...)` always answers in Chinese. Any text it produces that
 * reaches the screen stays Chinese on the English interface (04B). Shipped
 * code should take the interface `t` instead and keep `translateDefault` only
 * as the default value of an optional `t` parameter, which this guard does not
 * count: it looks for calls, not references.
 *
 * Known gap: a caller that forgets to pass `t` silently gets Chinese. This
 * guard cannot see that; the English rendering tests are what catch it.
 *
 * This allowlist may only get shorter. Each entry says why the call stays.
 */
const TRANSLATE_DEFAULT_CALL_ALLOWLIST = new Map<string, string>([
  [
    "app/workspaces/SettingsWorkspace.tsx",
    "PUBLIC_CLEAR_LEDGER_CONFIRMATION_TEXT is read only by SettingsWorkspace.test.tsx; the screen uses t(\"settings.clear.confirmation.phrase\").",
  ],
  [
    "features/portfolio/ledgerProjection.ts",
    "The projection's `issues` field is read only by tests, never by shipped code.",
  ],
]);

describe("translateDefault call sites", () => {
  it("calls translateDefault only in allowlisted shipped files", () => {
    const offenders = callSites()
      .filter(({ file }) => !TRANSLATE_DEFAULT_CALL_ALLOWLIST.has(file))
      .map(({ file, line }) => `${file}:${line}`);

    expect(offenders).toEqual([]);
  });

  it("drops an allowlisted file once it no longer calls translateDefault", () => {
    const filesWithCalls = new Set(callSites().map(({ file }) => file));
    const stale = [...TRANSLATE_DEFAULT_CALL_ALLOWLIST.keys()].filter(
      (file) => !filesWithCalls.has(file),
    );

    expect(stale).toEqual([]);
  });
});

function callSites(): { file: string; line: number }[] {
  return shippedSourceFiles().flatMap((filePath) => {
    const source = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      extname(filePath) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const found: { file: string; line: number }[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "translateDefault"
      ) {
        found.push({
          file: sourcePath(filePath),
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  });
}

function shippedSourceFiles(): string[] {
  return collectTypeScriptFiles(SRC_ROOT).filter((filePath) => {
    const name = filePath.split("/").pop() ?? "";
    return !/\.test\.tsx?$/.test(name) && !/\.testHelpers\.tsx?$/.test(name);
  });
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [entryPath] : [];
  });
}

function sourcePath(filePath: string): string {
  return relative(SRC_ROOT, filePath).split(/[\\/]/).join("/");
}
