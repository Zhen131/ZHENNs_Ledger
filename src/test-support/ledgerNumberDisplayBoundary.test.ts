import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { IDBFactory } from "fake-indexeddb";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { createInitialLedgerData } from "@/core/state";
import {
  createBackupEnvelope,
  parseBackupJson,
  serializeBackupEnvelope,
} from "@/features/backup";
import { createTestLedgerRepository } from "./createTestLedgerRepository";

const SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DISPLAY_ROOTS = [join(SRC_ROOT, "app"), join(SRC_ROOT, "features")];
const SAFE_LEDGER_NUMBER_FORMATTERS = new Set([
  "formatMoney",
  "formatPercent",
  "formatQuantity",
]);
const DECIMAL_MEMBER_NAMES = new Set([
  "adjustmentAmount",
  "amount",
  "assetMarketValue",
  "averageCost",
  "balance",
  "balanceBefore",
  "buyOutflow",
  "cashBalance",
  "cashDeficit",
  "costBasis",
  "currentBalance",
  "deficit",
  "delta",
  "fee",
  "giftIncome",
  "latestPrice",
  "locationQuantities",
  "marketValue",
  "networkFee",
  "nextBalance",
  "price",
  "quantity",
  "rate",
  "ratio",
  "realizedPnl",
  "remainingCostBasis",
  "sellProceeds",
  "targetBalance",
  "totalCostBasis",
  "totalMarketValue",
  "totalValue",
  "unitPrice",
  "unrealizedPnl",
]);
const DECIMAL_IDENTIFIER_NAMES = new Set([
  "assetMarketValue",
  "buyOutflow",
  "cashBalance",
  "cashDeficit",
  "currentBalance",
  "deficit",
  "delta",
  "metricValue",
  "nextBalance",
  "remainingCostBasis",
  "sellProceeds",
  "totalMarketValue",
]);

describe("ledger number display boundary", () => {
  it("keeps save, export and re-import DecimalString values byte-for-byte identical", async () => {
    const original = {
      cashAmount: "1000.000000000000000001",
      transferQuantity: "0.123456789012345678",
      transferUnitPrice: "594.862375883946480045",
    } as const;
    const ledger = createInitialLedgerData();
    ledger.cashEvents.push({
      id: "cash-display-boundary",
      type: "deposit",
      amount: original.cashAmount,
      currency: "USDT",
      occurredAt: "2026-07-20T10:00:00Z",
      timePrecision: "second",
      createdAt: "2026-07-20T10:00:00Z",
      updatedAt: "2026-07-20T10:00:00Z",
    });
    ledger.assetTransfers.push({
      id: "transfer-display-boundary",
      category: "external-in",
      reason: "deposit",
      assetSymbol: "BTC",
      quantity: original.transferQuantity,
      unitPrice: original.transferUnitPrice,
      toLocation: "exchange",
      occurredAt: "2026-07-20T11:00:00Z",
      timePrecision: "second",
      createdAt: "2026-07-20T11:00:00Z",
      updatedAt: "2026-07-20T11:00:00Z",
    });

    const repository = createTestLedgerRepository({
      indexedDBFactory: new IDBFactory(),
      databaseName: "ledger-number-display-boundary",
    });
    await repository.save(ledger);
    const reopened = await repository.load();
    expect(reopened).not.toBeNull();
    if (reopened === null) throw new Error("fictional saved ledger must reload");
    const reopenedCash = reopened.cashEvents[0];
    if (reopenedCash?.type !== "deposit") {
      throw new Error("fictional saved cash event must reload as a deposit");
    }
    expect(reopenedCash.amount).toBe(original.cashAmount);
    expect(reopened.assetTransfers[0]?.quantity).toBe(
      original.transferQuantity,
    );
    expect(reopened.assetTransfers[0]?.unitPrice).toBe(
      original.transferUnitPrice,
    );

    const exported = createBackupEnvelope(
      reopened,
      {
        appVersion: "0.1.0-test",
        exportedAt: "2026-07-21T01:00:00Z",
      },
      "2026-07-23",
    );
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error("fictional export fixture must be valid");

    const imported = parseBackupJson(
      serializeBackupEnvelope(exported.value),
      "2026-07-23",
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) throw new Error("fictional backup must re-import");

    const importedCash = imported.value.ledgerData.cashEvents[0];
    const importedTransfer = imported.value.ledgerData.assetTransfers[0];
    expect(importedCash).toMatchObject({ amount: original.cashAmount });
    expect(importedTransfer).toMatchObject({
      quantity: original.transferQuantity,
      unitPrice: original.transferUnitPrice,
    });
  });

  it("does not interpolate DecimalString facts directly into readonly app or feature JSX", () => {
    const violations = DISPLAY_ROOTS.flatMap((root) =>
      tsxFiles(root).flatMap(scanReadonlyDecimalOutput),
    );

    expect(
      violations,
      `Raw DecimalString displays (${violations.length}):\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("detects cash projection DecimalString members when they are interpolated raw", () => {
    const violations = scanReadonlyDecimalSource(
      `
        export function Sentinel({ projection, cashImpactPreview }) {
          return (
            <>
              <span>{projection.deficit}</span>
              <span>{cashImpactPreview.delta}</span>
            </>
          );
        }
      `,
      "sentinel.tsx",
    );

    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("projection.deficit");
    expect(violations[1]).toContain("cashImpactPreview.delta");
  });
});

function tsxFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return extname(entry.name) === ".tsx" && !entry.name.includes(".test.")
      ? [path]
      : [];
  });
}

function scanReadonlyDecimalOutput(file: string): string[] {
  return scanReadonlyDecimalSource(
    readFileSync(file, "utf8"),
    relative(SRC_ROOT, file),
  );
}

function scanReadonlyDecimalSource(
  sourceText: string,
  sourceLabel: string,
): string[] {
  const source = ts.createSourceFile(
    sourceLabel,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations = new Map<number, string>();

  function record(node: ts.Node) {
    const { line, character } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    violations.set(
      node.getStart(source),
      `${sourceLabel}:${line + 1}:${character + 1}: ${node.getText(source)}`,
    );
  }

  function visit(node: ts.Node) {
    if (ts.isJsxExpression(node) && node.expression) {
      const attribute = ts.isJsxAttribute(node.parent) ? node.parent : undefined;
      if (!attribute || shouldScanDisplayAttribute(attribute)) {
        for (const rawNode of rawDecimalOutputs(node.expression)) {
          record(rawNode);
        }
      }
    }

    if (ts.isTemplateExpression(node) && !hasJsxExpressionAncestor(node)) {
      for (const span of node.templateSpans) {
        for (const rawNode of rawDecimalOutputs(span.expression)) {
          record(rawNode);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return [...violations.values()];
}

function shouldScanDisplayAttribute(attribute: ts.JsxAttribute): boolean {
  if (attribute.name.getText() !== "value") return false;
  const owner = attribute.parent.parent;
  if (!ts.isJsxOpeningElement(owner) && !ts.isJsxSelfClosingElement(owner)) {
    return false;
  }
  const tagName = owner.tagName.getText();
  if (tagName === "LedgerNumber") return false;
  return !["input", "option", "select", "textarea"].includes(tagName);
}

function rawDecimalOutputs(expression: ts.Expression): ts.Node[] {
  if (ts.isParenthesizedExpression(expression)) {
    return rawDecimalOutputs(expression.expression);
  }
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    return rawDecimalOutputs(expression.expression);
  }
  if (ts.isNonNullExpression(expression)) {
    return rawDecimalOutputs(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...rawDecimalOutputs(expression.whenTrue),
      ...rawDecimalOutputs(expression.whenFalse),
    ];
  }
  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return rawDecimalOutputs(expression.right);
    }
    if (
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expression.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return [
        ...rawDecimalOutputs(expression.left),
        ...rawDecimalOutputs(expression.right),
      ];
    }
    return [];
  }
  if (ts.isTemplateExpression(expression)) {
    return expression.templateSpans.flatMap((span) =>
      rawDecimalOutputs(span.expression),
    );
  }
  if (ts.isPrefixUnaryExpression(expression)) {
    return rawDecimalOutputs(expression.operand);
  }
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression.getText();
    return SAFE_LEDGER_NUMBER_FORMATTERS.has(callee)
      ? []
      : callee === "String"
        ? expression.arguments.flatMap(rawDecimalOutputs)
        : [];
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const ownViolation =
      DECIMAL_MEMBER_NAMES.has(expression.name.text) &&
      rootIdentifier(expression) !== "errors"
      ? [expression]
      : [];
    return [...ownViolation, ...rawDecimalOutputs(expression.expression)];
  }
  if (ts.isElementAccessExpression(expression)) {
    return rawDecimalOutputs(expression.expression);
  }
  if (ts.isIdentifier(expression)) {
    return DECIMAL_IDENTIFIER_NAMES.has(expression.text) ? [expression] : [];
  }
  return [];
}

function rootIdentifier(expression: ts.Expression): string | undefined {
  let current = expression;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : undefined;
}

function hasJsxExpressionAncestor(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxExpression(parent)) return true;
    if (ts.isSourceFile(parent)) return false;
  }
  return false;
}
