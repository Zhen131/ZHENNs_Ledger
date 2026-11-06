import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_LIMIT = 400;
const TESTS_LIMIT = 600;
const MESSAGE_TABLE = /^ui\/i18nMessages\.[^/]+\.ts$/u;

const OVER_LIMIT_ALLOWLIST: readonly { file: string; codeLines: number }[] = [
  { file: "app/dashboard/DashboardShell.tsx", codeLines: 646 },
  { file: "app/file-access/ledgerFileAccessController.ts", codeLines: 871 },
  { file: "app/gate/LedgerAccessGate.tsx", codeLines: 787 },
  { file: "app/gate/ledgerAccessGateActions.ts", codeLines: 442 },
  { file: "app/persistence/usePersistentLedger.ts", codeLines: 776 },
  { file: "app/persistence/usePersistentLedgerImport.ts", codeLines: 441 },
  { file: "app/persistence/usePersistentLedgerLifecycle.ts", codeLines: 729 },
  { file: "app/persistence/usePersistentLedgerPersistence.ts", codeLines: 465 },
  { file: "app/workspaces/TransactionsWorkspace.tsx", codeLines: 539 },
  { file: "app/workspaces/transactionsWorkspaceDeletion.ts", codeLines: 401 },
  { file: "core/calculations/positionReplay.ts", codeLines: 435 },
  { file: "core/validation/__tests__/tradeValidator.test.ts", codeLines: 668 },
  { file: "core/validation/resourcePolicy.ts", codeLines: 406 },
  { file: "features/asset-transfers/assetTransferService.ts", codeLines: 431 },
  { file: "features/backup/BackupControls.tsx", codeLines: 593 },
  { file: "features/backup/__tests__/BackupControls.test.tsx", codeLines: 1582 },
  { file: "features/backup/__tests__/backupImportPreflight.test.ts", codeLines: 616 },
  { file: "features/backup/backupControlsActions.ts", codeLines: 528 },
  { file: "features/backup/backupControlsPairing.ts", codeLines: 536 },
  { file: "features/cash/cashEventPanelActions.ts", codeLines: 421 },
  { file: "features/market-data/MarketDataControls.tsx", codeLines: 492 },
  { file: "features/market-data/marketDataControlsAssetActions.ts", codeLines: 471 },
  { file: "features/portfolio/__tests__/HoldingsOverview.test.tsx", codeLines: 724 },
  { file: "features/portfolio/ledgerProjection.ts", codeLines: 429 },
  { file: "features/trades/TradeForm.tsx", codeLines: 534 },
  { file: "platform/coordination/ledgerFileSessionCoordinator.ts", codeLines: 535 },
  { file: "platform/files/__tests__/ledgerFileRepository.clear.test.ts", codeLines: 683 },
  { file: "platform/files/__tests__/ledgerFileRepository.import.test.ts", codeLines: 894 },
  { file: "platform/files/__tests__/ledgerFileRepository.testHelpers.ts", codeLines: 653 },
  { file: "platform/files/ledgerFileChunkedContainerV3Parse.ts", codeLines: 668 },
  { file: "platform/files/ledgerFileCrypto.ts", codeLines: 490 },
  { file: "platform/files/ledgerFileHandleAdapter.ts", codeLines: 592 },
  { file: "platform/files/ledgerFileRepository.ts", codeLines: 1573 },
  { file: "platform/files/ledgerFileRepositoryVerify.ts", codeLines: 642 },
  { file: "platform/files/ledgerFileSlotContainerV3Parse.ts", codeLines: 564 },
  { file: "platform/persistence/__tests__/ledgerRepository.test.ts", codeLines: 683 },
  { file: "platform/persistence/ledgerRepository.ts", codeLines: 532 },
  { file: "test-support/readLedgerFileForTest.ts", codeLines: 746 },
];

describe("source file length", () => {
  it("keeps every file outside the allowlist within its code-line limit", () => {
    const allowlisted = new Set(OVER_LIMIT_ALLOWLIST.map(({ file }) => file));
    const offenders = measuredFiles()
      .filter(({ file }) => !allowlisted.has(file))
      .filter(({ codeLines, limit }) => codeLines > limit)
      .map(({ file, codeLines, limit }) => `${file}: ${codeLines} > ${limit}`);

    expect(offenders).toEqual([]);
  });

  it("keeps every allowlisted file present and no longer than recorded", () => {
    const measured = new Map(
      measuredFiles().map(({ file, codeLines }) => [file, codeLines]),
    );
    const problems = OVER_LIMIT_ALLOWLIST.flatMap(({ file, codeLines }) => {
      const actual = measured.get(file);
      if (actual === undefined) {
        return [`${file}: listed but not measured`];
      }
      return actual > codeLines ? [`${file}: ${actual} > recorded ${codeLines}`] : [];
    });

    expect(problems).toEqual([]);
  });

  it("drops an allowlisted file once it is back within its limit", () => {
    const measured = new Map(
      measuredFiles().map(({ file, codeLines, limit }) => [file, { codeLines, limit }]),
    );
    const withinLimit = OVER_LIMIT_ALLOWLIST.flatMap(({ file }) => {
      const actual = measured.get(file);
      return actual !== undefined && actual.codeLines <= actual.limit
        ? [`${file}: ${actual.codeLines} <= ${actual.limit}`]
        : [];
    });

    expect(withinLimit).toEqual([]);
  });

  it("keeps the allowlist sorted without duplicates", () => {
    const files = OVER_LIMIT_ALLOWLIST.map(({ file }) => file);

    expect(files).toEqual([...new Set(files)].sort());
  });
});

function measuredFiles(): { file: string; codeLines: number; limit: number }[] {
  return sourceFiles(SRC_ROOT)
    .map((path) => ({ path, file: sourcePath(path) }))
    .filter(({ file }) => !MESSAGE_TABLE.test(file))
    .map(({ path, file }) => ({
      file,
      codeLines: codeLineCount(path),
      limit: file.includes("/__tests__/") ? TESTS_LIMIT : SOURCE_LIMIT,
    }))
    .sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
}

function codeLineCount(path: string): number {
  const text = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = new Set<number>();

  function mark(start: number, end: number): void {
    const first = sourceFile.getLineAndCharacterOfPosition(start).line;
    const last = sourceFile.getLineAndCharacterOfPosition(end - 1).line;
    for (let line = first; line <= last; line += 1) {
      lines.add(line);
    }
  }

  function visit(node: ts.Node): void {
    if (
      node.kind >= ts.SyntaxKind.FirstJSDocNode &&
      node.kind <= ts.SyntaxKind.LastJSDocNode
    ) {
      return;
    }
    const children = node.getChildren(sourceFile);
    if (children.length > 0) {
      children.forEach(visit);
      return;
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken) {
      return;
    }
    if (node.kind === ts.SyntaxKind.JsxText) {
      const raw = text.slice(node.pos, node.end);
      const leading = raw.length - raw.trimStart().length;
      const trailing = raw.length - raw.trimEnd().length;
      if (raw.trim().length > 0) {
        mark(node.pos + leading, node.end - trailing);
      }
      return;
    }
    const start = node.getStart(sourceFile);
    if (start < node.end) {
      mark(start, node.end);
    }
  }

  visit(sourceFile);
  return lines.size;
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

function sourcePath(file: string): string {
  return relative(SRC_ROOT, file).split(sep).join("/");
}
