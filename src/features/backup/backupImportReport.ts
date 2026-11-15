/**
 * 这个文件管一件事：把预检结果写成一份可以复制的 Markdown 报告。
 * 预检本身在 `backupImportPreflight.ts`，界面上的报告在 `PreflightReportView.tsx`。
 * 不显然的决定：报告第一段先提醒里面有隐私；2026-07-31 定（W11 03A 第 4.4 节）。
 */
import type { BackupImportPreflightResult } from "./backupImportPreflightResult";
import type {
  BackupPreflightHardError,
  BackupPreflightSuspiciousDetail,
  BackupTradeSummary,
} from "./backupImportPreflightTypes";
import { translateDefault, type Translate } from "@/ui";

/**
 * 这个函数回答：这次预检的报告写成 Markdown 是什么样？
 * 依次是隐私提醒、总数、文件情况、提醒。
 * 然后是没做的检查和每条详情。
 * 详情最多 1000 条，超了在末尾写明截断。
 * 举例：1200 条详情 → 报告写前 1000 条，并说第 1001 条后已截断。
 * `t` 不传时用中文；复制按钮要传当前界面语言的 `t`。
 * 不会出错。
 */
export function formatBackupImportReportMarkdown(
  result: BackupImportPreflightResult,
  t: Translate = translateDefault,
): string {
  const lines: string[] = [
    t("backup.markdown.title"),
    "",
    t("backup.markdown.privacy"),
    "",
    t("backup.markdown.summary"),
    "",
    t("backup.markdown.contentSha") + "\`" + result.contentIdentity.sha256 + "\`",
    t("backup.markdown.byteLength") + result.contentIdentity.utf8ByteLength,
    t("backup.markdown.selectionGeneration") + result.selectionGeneration,
    t("backup.markdown.hardErrors") + result.hardErrorCount,
    t("backup.markdown.warnings") + result.warningCount,
    t("backup.markdown.suspiciousGroups") + result.suspiciousGroupCount,
    t("backup.markdown.details") + result.totalDetailCount,
    t("backup.markdown.retainedDetails") + result.retainedDetailCount,
    t("backup.markdown.suspiciousIdentity") + "\`" + result.suspiciousGroupIdentity + "\`",
    t("backup.markdown.conclusion") + formatConclusion(result, t),
  ];

  if (result.metadata) {
    lines.push(
      "",
      t("backup.markdown.metadata"),
      "",
      t("backup.markdown.sourceFile") + textOrUnavailable(result.metadata.sourceFileName, t),
      t("backup.markdown.formatVersion") + numberOrUnavailable(result.metadata.backupFormatVersion, t),
      t("backup.markdown.appVersion") + textOrUnavailable(result.metadata.appVersion, t),
      t("backup.markdown.exportedAt") + textOrUnavailable(result.metadata.exportedAt, t),
      t("backup.markdown.schemaVersion") + numberOrUnavailable(result.metadata.ledgerSchemaVersion, t),
      t("backup.markdown.assets") + numberOrUnavailable(result.metadata.assetCount, t),
      t("backup.markdown.trades") + numberOrUnavailable(result.metadata.tradeCount, t),
      t("backup.markdown.cashEvents") + numberOrUnavailable(result.metadata.cashEventCount, t),
      t("backup.markdown.assetTransfers") + numberOrUnavailable(result.metadata.assetTransferCount, t),
      t("backup.markdown.priceSnapshots") + numberOrUnavailable(result.metadata.priceSnapshotCount, t),
      t("backup.markdown.feeRules") + numberOrUnavailable(result.metadata.feeRuleCount, t),
      t("backup.markdown.cashBalance") + textOrUnavailable(result.metadata.cashBalance, t),
      t("backup.markdown.cashDeficit") + textOrUnavailable(result.metadata.cashDeficit, t),
      t("backup.markdown.missingMappings") + formatMissingMappings(result.metadata.missingMappingSymbols, t),
    );
  }

  if (result.warnings.length > 0) {
    lines.push("", "## Warnings", "");
    result.warnings.forEach((warning) => {
      lines.push(
        `- \`${inline(warning.code)}\`${t("backup.markdown.lineColonSeparator")}${singleLine(warning.message)}`,
      );
    });
  }

  if (result.skippedChecks.length > 0) {
    lines.push("", t("backup.markdown.skippedChecks"), "");
    result.skippedChecks.forEach(({ check, reason }) => {
      lines.push(`- \`${inline(check)}\`${t("backup.markdown.lineColonSeparator")}${singleLine(reason)}`);
    });
  }

  lines.push("", t("backup.markdown.detailsHeading"), "");
  if (result.retainedDetails.length === 0) {
    lines.push(t("backup.markdown.noDetails"));
  } else {
    result.retainedDetails.forEach((detail, index) => {
      if (detail.kind === "hard-error") {
        appendHardError(lines, detail, index + 1, t);
      } else {
        appendSuspiciousGroup(lines, detail, index + 1, t);
      }
    });
  }

  if (result.truncated) {
    lines.push(
      "",
      t("backup.markdown.truncationPrefix") +
        result.totalDetailCount +
        t("backup.markdown.truncationMiddle") +
        result.retainedDetailCount +
        t("backup.markdown.truncationSuffix"),
    );
  }

  lines.push(
    "",
    t("backup.markdown.noMutationNotice"),
    "",
  );
  return lines.join("\n");
}

function appendHardError(
  lines: string[],
  error: BackupPreflightHardError,
  number: number,
  t: Translate,
): void {
  lines.push(
    t("backup.markdown.hardErrorPrefix") +
      number +
      t("backup.markdown.hardErrorSuffix"),
    "",
    t("backup.markdown.code") + "\`" + inline(error.code) + "\`",
    t("backup.markdown.path") + "\`" + inline(error.path) + "\`",
    t("backup.markdown.description") + singleLine(error.message),
  );
  if (error.line !== undefined && error.column !== undefined) {
    lines.push(
      t("backup.markdown.jsonLocationPrefix") +
        error.line +
        t("backup.markdown.jsonLocationMiddle") +
        error.column +
        t("backup.markdown.jsonLocationSuffix"),
    );
  }
  if (error.limit !== undefined && error.actual !== undefined) {
    lines.push(
      t("backup.markdown.resourceLimitPrefix") +
        error.limit +
        t("backup.markdown.resourceLimitMiddle") +
        error.actual,
    );
  }
  if (error.summary) {
    lines.push(
      t("backup.markdown.tradeSummary") +
        formatTradeSummary(error.summary, t),
    );
  }
  lines.push("");
}

function appendSuspiciousGroup(
  lines: string[],
  detail: BackupPreflightSuspiciousDetail,
  number: number,
  t: Translate,
): void {
  lines.push(
    `### ${number}. ${
      detail.group.level === "high"
        ? t("backup.markdown.highSuspicion")
        : t("backup.markdown.normalSuspicion")
    }${t("backup.markdown.duplicateGroupSuffix")}`,
    "",
    `${t("backup.markdown.sourcePaths")}${detail.group.tradeIndices
      .map((index) => `\`trades[${index}]\``)
      .join(t("backup.markdown.listSeparator"))}`,
    `${t("backup.markdown.tradeIds")}${detail.group.tradeIds
      .map((id) => `\`${inline(id)}\``)
      .join(t("backup.markdown.listSeparator"))}`,
    `${t("backup.markdown.triggerRelations")}${detail.group.triggerEdges
      .map(
        (edge) =>
          `\`trades[${edge.leftIndex}]\` ↔ \`trades[${edge.rightIndex}]\`（${
            edge.relation === "same-exact-time"
              ? t("backup.markdown.exactTime")
              : t("backup.markdown.sameDay")
          }）`,
      )
      .join(t("backup.markdown.summarySeparator"))}`,
  );
  detail.summaries.forEach((summary, index) => {
    lines.push(
      `- trades[${detail.group.tradeIndices[index]}]${t("backup.markdown.summarySuffix")}${formatTradeSummary(
        summary,
        t,
      )}`,
    );
  });
  lines.push(
    t("backup.markdown.description") + singleLine(detail.message),
    "",
  );
}

function formatConclusion(result: BackupImportPreflightResult, t: Translate): string {
  if (result.hardErrorCount > 0) {
    return t("backup.markdown.blocked");
  }
  if (result.suspiciousGroupCount > 0) {
    return t("backup.markdown.confirmSuspicious");
  }
  return t("backup.markdown.passed");
}

function formatTradeSummary(summary: BackupTradeSummary, t: Translate): string {
  const values = [
    summary.occurredAt
      ? t("backup.markdown.datePrefix") +
        singleLine(summary.occurredAt)
      : undefined,
    summary.assetSymbol
      ? t("backup.markdown.assetPrefix") +
        singleLine(summary.assetSymbol)
      : undefined,
    summary.type
      ? t("backup.markdown.directionPrefix") +
        (summary.type === "buy"
          ? t("backup.markdown.buy")
          : t("backup.markdown.sell"))
      : undefined,
    summary.quantity
      ? t("backup.markdown.quantityPrefix") +
        singleLine(summary.quantity)
      : undefined,
    summary.price
      ? t("backup.markdown.pricePrefix") +
        singleLine(summary.price)
      : undefined,
    summary.totalValue
      ? t("backup.markdown.totalPrefix") +
        singleLine(summary.totalValue) +
        (summary.currency ? ` ${singleLine(summary.currency)}` : "")
      : undefined,
  ].filter((value): value is string => value !== undefined);
  return values.length > 0
    ? values.join(t("backup.markdown.summarySeparator"))
    : t("backup.markdown.noSafeSummary");
}

function textOrUnavailable(value: string | undefined, t: Translate): string {
  return value === undefined
    ? t("backup.markdown.unavailable")
    : singleLine(value);
}

function numberOrUnavailable(value: number | undefined, t: Translate): string {
  return value === undefined
    ? t("backup.markdown.unavailable")
    : String(value);
}

function formatMissingMappings(value: readonly string[] | undefined, t: Translate): string {
  if (value === undefined) return t("backup.markdown.unavailable");
  return value.length === 0
    ? t("backup.markdown.none")
    : value.map((symbol) => `\`${inline(symbol)}\``).join(t("backup.markdown.listSeparator"));
}

function inline(value: string): string {
  return singleLine(value).replaceAll("`", "ˋ");
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
