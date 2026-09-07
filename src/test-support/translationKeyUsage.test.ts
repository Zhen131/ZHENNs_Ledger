import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));

const APPROVED_SHARED_TRANSLATION_KEYS = new Set<string>([
  // The repeated access buttons all use the same Back label.
  "access.action.back",
  // The repeated access buttons all use the same Recheck label.
  "access.action.recheck",
  // Both reconnect prompts offer the same Forget action.
  "access.reconnectPrompt.forget",
  // Both reconnect prompts offer the same Reselect action.
  "access.reconnectPrompt.reselect",
  // Activity detail variants share the Created-at label.
  "activity.details.createdAt",
  // Activity detail variants share the Fact-ID label.
  "activity.details.factId",
  // Activity detail variants share the occurred-at label.
  "activity.details.occurredAt",
  // Activity detail variants share the occurred-time-zone label.
  "activity.details.occurredTimeZone",
  // Activity detail variants share the Note label.
  "activity.details.note",
  // Activity detail variants use the same not-filled placeholder.
  "activity.details.notFilled",
  // Activity detail variants share the time-precision label.
  "activity.details.timePrecision",
  // Activity detail variants share the Updated-at label.
  "activity.details.updatedAt",
  // Activity table contexts share the Amount column label.
  "activity.table.amount",
  // Activity table contexts share the Asset column label.
  "activity.table.asset",
  // Activity table contexts share the same dash placeholder.
  "activity.table.dash",
  // Activity table contexts share the Date column label.
  "activity.table.date",
  // Activity table contexts share the Fee column label.
  "activity.table.fee",
  // Activity table contexts share the Quantity column label.
  "activity.table.quantity",
  // Activity table contexts share the Type column label.
  "activity.table.type",
  // Transfer controls and summaries use the same external-in category name.
  "assetTransfers.category.externalIn",
  // Transfer controls and summaries use the same external-out category name.
  "assetTransfers.category.externalOut",
  // Transfer controls and summaries use the same gain category name.
  "assetTransfers.category.gain",
  // Transfer controls and summaries use the same internal category name.
  "assetTransfers.category.internal",
  // Transfer form and details use the same Quantity field label.
  "assetTransfers.field.quantity",
  // Transfer locations use the same cold-wallet name.
  "assetTransfers.location.coldWallet",
  // Transfer locations use the same cold-wallet-earn name.
  "assetTransfers.location.coldWalletEarn",
  // Transfer locations use the same exchange name.
  "assetTransfers.location.exchange",
  // Transfer locations use the same outside-ledger name.
  "assetTransfers.location.outsideLedger",
  // Transfer failure states use the same ledger-not-writable sentence.
  "assetTransfers.status.ledgerNotWritable",
  // Backup dialogs all expose the same Cancel action.
  "backup.action.cancel",
  // Backup error summaries share the same Found prefix.
  "backup.errors.foundPrefix",
  // Backup error summaries share the same item suffix.
  "backup.errors.suffix",
  // Backup pairing lists use the same item separator.
  "backup.pairing.separator",
  // Backup report locations share the same hard-errors heading.
  "backup.report.hardErrors",
  // Both negative-cash confirmations require the same confirmation text.
  "cash.negativeConfirmation.defaultConfirm",
  // Backup report detail lines both use the original "- 说明：" label.
  "backup.markdown.description",
  // Backup report warning and skipped-check lines both use the original colon.
  "backup.markdown.lineColonSeparator",
  // Backup report lists use the original Chinese list separator.
  "backup.markdown.listSeparator",
  // Backup report summaries use the original Chinese summary separator.
  "backup.markdown.summarySeparator",
  // Backup report fallbacks all use the original unavailable marker.
  "backup.markdown.unavailable",
  // Oversize-file skipped checks all use the original JSON-not-parsed sentence.
  "backup.preflight.jsonNotParsed",
  // JSON parse-error skipped checks all use the original JSON-syntax sentence.
  "backup.preflight.jsonSyntaxError",
  // Version-boundary skipped checks all use the original stopped suffix.
  "backup.preflight.versionStageStoppedSuffix",
  // Cash save paths share the same ledger-not-writable sentence.
  "cash.status.ledgerNotWritable",
  // Activity and cash panels use the same balance-adjustment type name.
  "cash.type.balanceAdjustment",
  // Activity and cash panels use the same deposit type name.
  "cash.type.deposit",
  // Activity and cash panels use the same external-expense type name.
  "cash.type.externalExpense",
  // Activity and cash panels use the same withdrawal type name.
  "cash.type.withdrawal",
  // Allocation chart labels use the same join separator.
  "charts.allocation.joinSeparator",
  // Allocation chart labels use the same period text.
  "charts.allocation.period",
  // Heatmap home descriptions use the same aria separator.
  "charts.heatmap.home.ariaSeparator",
  // Heatmap summary and cell descriptions use the same empty-day text.
  "charts.heatmap.home.emptyDay",
  // Heatmap tooltip and aria text use the same buy prefix.
  "charts.heatmap.tooltip.buyPrefix",
  // Heatmap tooltip and aria text use the same sell prefix.
  "charts.heatmap.tooltip.sellPrefix",
  // Heatmap tooltip and aria text use the same total prefix.
  "charts.heatmap.tooltip.totalPrefix",
  // Heatmap tooltip and aria text use the same trade-count suffix.
  "charts.heatmap.tooltip.tradesSuffix",
  // History chart series use the same cost-basis label.
  "charts.option.history.costBasisSeries",
  // History chart labels use the same list separator.
  "charts.option.history.listSeparator",
  // History chart series use the same total-assets label.
  "charts.option.history.totalAssetsSeries",
  // Dashboard controls all expose the same Cancel action.
  "dashboard.action.cancel",
  // Dashboard asset rows use the same unreliable marker.
  "dashboard.assets.unreliable",
  // Dashboard delete paths use the same ledger-not-writable sentence.
  "dashboard.delete.ledgerNotWritable",
  // Dashboard future-fact rows use the same colon separator.
  "dashboard.futureFacts.colonSeparator",
  // Future-fact delete confirmation variants share the Delete-all text.
  "dashboard.futureFacts.deleteAll",
  // Future-fact delete confirmation variants share the asset-transfer text.
  "dashboard.futureFacts.deleteAssetTransfer",
  // Future-fact delete confirmation variants share the price text.
  "dashboard.futureFacts.deletePrice",
  // Future-fact delete confirmation variants share the trade text.
  "dashboard.futureFacts.deleteTrade",
  // Future-fact rows use the same Quantity label.
  "dashboard.futureFacts.quantity",
  // Dashboard summaries use the same realized-PnL label.
  "dashboard.pnl.realized",
  // Dashboard summaries use the same remaining-cost-basis label.
  "dashboard.pnl.remainingCostBasis",
  // Dashboard summaries use the same unrealized-PnL label.
  "dashboard.pnl.unrealized",
  // Dashboard headings use the same trade-list title.
  "dashboard.section.tradeList",
  // Fee-rule save paths share the same ID-exhausted error.
  "fees.error.idGenerationExhausted",
  // Fee replacement controls use the same Amount label.
  "fees.field.amount",
  // Fee replacement controls use the same Rate label.
  "fees.field.rate",
  // Fee replacement controls use the same New-version prefix.
  "fees.history.newVersion",
  // Market-data save paths share the same mapping-saved fetching message.
  "marketData.assetFeedback.mappingSavedFetching",
  // Market-data save paths share the same price-not-persisted message.
  "marketData.assetFeedback.priceNotPersisted",
  // Market-data failure paths share the same refresh-failed prefix.
  "marketData.assetFeedback.refreshFailedPrefix",
  // Backup and market-data flows share the same validation-unavailable message.
  "marketData.failure.validationUnavailable",
  // Every future-fact import error shares the same later-than-today middle.
  "policy.import.futureFactMiddle",
  // Assets, trades, and price snapshots share the same valuation-currency error.
  "policy.import.unsupportedValuationCurrency",
  // Holding detail entries use the same accessible detail label.
  "portfolio.details.ariaLabel",
  // Holding detail rows use the same dash separator.
  "portfolio.details.dash",
  // Holding detail variants use the same unreliable marker.
  "portfolio.details.unreliable",
  // Holding overview variants use the same missing-price marker.
  "portfolio.overview.missingPrice",
  // Holding overview variants use the same unreliable marker.
  "portfolio.overview.unreliable",
  // Valuation paths both use the original missing-current-price suffix.
  "portfolio.issue.missingCurrentPrice",
  // Valuation paths all use the original unsupported-currency middle text.
  "portfolio.issue.unsupportedCurrencyMiddle",
  // Price form areas use the same Current-price field label.
  "prices.field.currentPrice",
  // Price form areas use the same Date field label.
  "prices.field.date",
  // Price form areas use the same Note field label.
  "prices.field.note",
  // Price form areas use the same Place field label.
  "prices.field.timeZone",
  // Both language selectors use the same language label.
  "settings.language.label",
  // Workspace navigation uses the same Home label.
  "shared.shell.home",
  // Workspace navigation uses the same Record label.
  "shared.shell.record",
  // Workspace navigation uses the same Settings label.
  "shared.shell.settings",
  // Workspace navigation uses the same Transactions label.
  "shared.shell.transactions",
  // Workspace navigation uses the same Transfer label.
  "shared.shell.transfer",
  // Trade-form saving variants use the same Saving action text.
  "trades.form.action.saving",
  // Trade-form validation paths use the same invalid-input sentence.
  "trades.form.error.invalidInput",
  // Trade-form fields use the same Total-value label.
  "trades.form.field.totalValue",
  // Trade table contexts use the same Actions column label.
  "trades.table.actions",
  // Trade table contexts use the same Asset column label.
  "trades.table.asset",
  // Trade table contexts use the same buy-outflow label.
  "trades.table.buyOutflow",
  // Trade table contexts use the same cash-impact label.
  "trades.table.cashImpact",
  // Trade table contexts use the same Date column label.
  "trades.table.date",
  // Trade table confirmations use the same delete prefix.
  "trades.table.deletePrefix",
  // Trade table contexts use the same Manual marker.
  "trades.table.manual",
  // Trade table contexts use the same not-filled placeholder.
  "trades.table.notFilled",
  // Trade table contexts use the same Quantity column label.
  "trades.table.quantity",
  // Trade table contexts use the same sell-proceeds label.
  "trades.table.sellProceeds",
  // Trade table contexts use the same Type column label.
  "trades.table.type",
  // Trade table contexts use the same unconverted-fee label.
  "trades.table.unconvertedFee",
  // Trade table contexts use the same unreliable prefix.
  "trades.table.unreliablePrefix",
  // Trade table contexts use the same unreliable separator.
  "trades.table.unreliableSeparator",
  // Dashboard, activity, forms, and tables use the same Buy type name.
  "trades.type.buy",
  // Dashboard, activity, forms, and tables use the same Sell type name.
  "trades.type.sell",
  // Transaction deletion paths use the same cash-fact-deleted sentence.
  "transactions.delete.cashFactDeleted",
  // Transaction deletion paths use the same countdown-cancelled prefix.
  "transactions.delete.countdownCancelledPrefix",
  // Transaction deletion paths use the same missing-fact sentence.
  "transactions.delete.factMissing",
  // Transaction deletion paths use the same no-longer-in-ledger sentence.
  "transactions.delete.noLongerInLedger",
  // Transaction deletion paths use the same trade-deleted sentence.
  "transactions.delete.tradeDeleted",
  // Transaction filters use the same cash-USDT category label.
  "transactions.filter.cashUsdt",
  // Transaction summaries use the same cash-fact item name.
  "transactions.item.cashFact",
  // Transaction summaries use the same trade item name.
  "transactions.item.trade",
  // Transaction filters use the same one-year range label.
  "transactions.time.1y",
  // Transaction filters use the same seven-day range label.
  "transactions.time.7d",
  // Transaction filters use the same all-time range label.
  "transactions.time.all",
  // Transaction filters use the same today range label.
  "transactions.time.today",
  // Transaction filters use the same balance-adjustment type name.
  "transactions.type.balanceAdjustment",
  // Transaction filters use the same deposit type name.
  "transactions.type.deposit",
  // Transaction filters use the same external-expense type name.
  "transactions.type.externalExpense",
  // Transaction filters use the same withdrawal type name.
  "transactions.type.withdrawal",
]);

describe("translation key usage", () => {
  it("requires explicit approval before a translation key is reused", () => {
    const usages = translationKeyUsages();
    const reusedKeys = [...usages.entries()]
      .filter(([, callSites]) => callSites.length >= 2)
      .sort(([left], [right]) => left.localeCompare(right));
    const unapprovedKeys = reusedKeys.filter(
      ([key]) => !APPROVED_SHARED_TRANSLATION_KEYS.has(key),
    );
    const staleApprovals = [...APPROVED_SHARED_TRANSLATION_KEYS]
      .filter((key) => (usages.get(key)?.length ?? 0) < 2)
      .sort();

    expect(
      unapprovedKeys,
      `Translation keys reused without explicit approval:\n${formatUsages(unapprovedKeys)}`,
    ).toEqual([]);
    expect(staleApprovals, "Stale shared translation-key approvals").toEqual([]);
  });
});

function translationKeyUsages(): Map<string, string[]> {
  const usages = new Map<string, string[]>();

  for (const filePath of collectTypeScriptFiles(SRC_ROOT)) {
    const source = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      extname(filePath) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ["t", "translateDefault"].includes(node.expression.text) &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const key = node.arguments[0].text;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;
        const callSite = `${relative(SRC_ROOT, filePath)}:${line}`;
        usages.set(key, [...(usages.get(key) ?? []), callSite]);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return usages;
}

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(entryPath);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [entryPath] : [];
  });
}

function formatUsages(entries: readonly [string, string[]][]): string {
  return entries
    .map(([key, callSites]) => `- ${key}: ${callSites.join(", ")}`)
    .join("\n");
}
