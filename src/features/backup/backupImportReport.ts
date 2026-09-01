import type {
  BackupImportPreflightResult,
  BackupPreflightHardError,
  BackupPreflightSuspiciousDetail,
  BackupTradeSummary,
} from "./backupImportPreflight";
import { translateDefault } from "@/ui";

export function formatBackupImportReportMarkdown(
  result: BackupImportPreflightResult,
): string {
  const lines: string[] = [
    translateDefault("backup.markdown.title"),
    "",
    translateDefault("backup.markdown.privacy"),
    "",
    translateDefault("backup.markdown.summary"),
    "",
    translateDefault("backup.markdown.contentSha") + "\`" + result.contentIdentity.sha256 + "\`",
    translateDefault("backup.markdown.byteLength") + result.contentIdentity.utf8ByteLength,
    translateDefault("backup.markdown.selectionGeneration") + result.selectionGeneration,
    translateDefault("backup.markdown.hardErrors") + result.hardErrorCount,
    translateDefault("backup.markdown.warnings") + result.warningCount,
    translateDefault("backup.markdown.suspiciousGroups") + result.suspiciousGroupCount,
    translateDefault("backup.markdown.details") + result.totalDetailCount,
    translateDefault("backup.markdown.retainedDetails") + result.retainedDetailCount,
    translateDefault("backup.markdown.suspiciousIdentity") + "\`" + result.suspiciousGroupIdentity + "\`",
    translateDefault("backup.markdown.conclusion") + formatConclusion(result),
  ];

  if (result.metadata) {
    lines.push(
      "",
      translateDefault("backup.markdown.metadata"),
      "",
      translateDefault("backup.markdown.sourceFile") + textOrUnavailable(result.metadata.sourceFileName),
      translateDefault("backup.markdown.formatVersion") + numberOrUnavailable(result.metadata.backupFormatVersion),
      translateDefault("backup.markdown.appVersion") + textOrUnavailable(result.metadata.appVersion),
      translateDefault("backup.markdown.exportedAt") + textOrUnavailable(result.metadata.exportedAt),
      translateDefault("backup.markdown.schemaVersion") + numberOrUnavailable(result.metadata.ledgerSchemaVersion),
      translateDefault("backup.markdown.assets") + numberOrUnavailable(result.metadata.assetCount),
      translateDefault("backup.markdown.trades") + numberOrUnavailable(result.metadata.tradeCount),
      translateDefault("backup.markdown.cashEvents") + numberOrUnavailable(result.metadata.cashEventCount),
      translateDefault("backup.markdown.assetTransfers") + numberOrUnavailable(result.metadata.assetTransferCount),
      translateDefault("backup.markdown.priceSnapshots") + numberOrUnavailable(result.metadata.priceSnapshotCount),
      translateDefault("backup.markdown.feeRules") + numberOrUnavailable(result.metadata.feeRuleCount),
      translateDefault("backup.markdown.cashBalance") + textOrUnavailable(result.metadata.cashBalance),
      translateDefault("backup.markdown.cashDeficit") + textOrUnavailable(result.metadata.cashDeficit),
      translateDefault("backup.markdown.missingMappings") + formatMissingMappings(result.metadata.missingMappingSymbols),
    );
  }

  if (result.warnings.length > 0) {
    lines.push("", "## Warnings", "");
    result.warnings.forEach((warning) => {
      lines.push(
        `- \`${inline(warning.code)}\`：${singleLine(warning.message)}`,
      );
    });
  }

  if (result.skippedChecks.length > 0) {
    lines.push("", translateDefault("backup.markdown.skippedChecks"), "");
    result.skippedChecks.forEach(({ check, reason }) => {
      lines.push(`- \`${inline(check)}\`：${singleLine(reason)}`);
    });
  }

  lines.push("", translateDefault("backup.markdown.detailsHeading"), "");
  if (result.retainedDetails.length === 0) {
    lines.push(translateDefault("backup.markdown.noDetails"));
  } else {
    result.retainedDetails.forEach((detail, index) => {
      if (detail.kind === "hard-error") {
        appendHardError(lines, detail, index + 1);
      } else {
        appendSuspiciousGroup(lines, detail, index + 1);
      }
    });
  }

  if (result.truncated) {
    lines.push(
      "",
      translateDefault("backup.markdown.truncationPrefix") +
        result.totalDetailCount +
        translateDefault("backup.markdown.truncationMiddle") +
        result.retainedDetailCount +
        translateDefault("backup.markdown.truncationSuffix"),
    );
  }

  lines.push(
    "",
    translateDefault("backup.markdown.noMutationNotice"),
    "",
  );
  return lines.join("\n");
}

function appendHardError(
  lines: string[],
  error: BackupPreflightHardError,
  number: number,
): void {
  lines.push(
    translateDefault("backup.markdown.hardErrorPrefix") +
      number +
      translateDefault("backup.markdown.hardErrorSuffix"),
    "",
    translateDefault("backup.markdown.code") + "\`" + inline(error.code) + "\`",
    translateDefault("backup.markdown.path") + "\`" + inline(error.path) + "\`",
    translateDefault("backup.markdown.description") + singleLine(error.message),
  );
  if (error.line !== undefined && error.column !== undefined) {
    lines.push(
      translateDefault("backup.markdown.jsonLocationPrefix") +
        error.line +
        translateDefault("backup.markdown.jsonLocationMiddle") +
        error.column +
        translateDefault("backup.markdown.jsonLocationSuffix"),
    );
  }
  if (error.limit !== undefined && error.actual !== undefined) {
    lines.push(
      translateDefault("backup.markdown.resourceLimitPrefix") +
        error.limit +
        translateDefault("backup.markdown.resourceLimitMiddle") +
        error.actual,
    );
  }
  if (error.summary) {
    lines.push(
      translateDefault("backup.markdown.tradeSummary") +
        formatTradeSummary(error.summary),
    );
  }
  lines.push("");
}

function appendSuspiciousGroup(
  lines: string[],
  detail: BackupPreflightSuspiciousDetail,
  number: number,
): void {
  lines.push(
    `### ${number}. ${
      detail.group.level === "high"
        ? translateDefault("backup.markdown.highSuspicion")
        : translateDefault("backup.markdown.normalSuspicion")
    }${translateDefault("backup.markdown.duplicateGroupSuffix")}`,
    "",
    `${translateDefault("backup.markdown.sourcePaths")}${detail.group.tradeIndices
      .map((index) => `\`trades[${index}]\``)
      .join("、")}`,
    `${translateDefault("backup.markdown.tradeIds")}${detail.group.tradeIds
      .map((id) => `\`${inline(id)}\``)
      .join("、")}`,
    `${translateDefault("backup.markdown.triggerRelations")}${detail.group.triggerEdges
      .map(
        (edge) =>
          `\`trades[${edge.leftIndex}]\` ↔ \`trades[${edge.rightIndex}]\`（${
            edge.relation === "same-exact-time"
              ? translateDefault("backup.markdown.exactTime")
              : translateDefault("backup.markdown.sameDay")
          }）`,
      )
      .join("；")}`,
  );
  detail.summaries.forEach((summary, index) => {
    lines.push(
      `- trades[${detail.group.tradeIndices[index]}]${translateDefault("backup.markdown.summarySuffix")}${formatTradeSummary(
        summary,
      )}`,
    );
  });
  lines.push(
    translateDefault("backup.markdown.description") + singleLine(detail.message),
    "",
  );
}

function formatConclusion(result: BackupImportPreflightResult): string {
  if (result.hardErrorCount > 0) {
    return translateDefault("backup.markdown.blocked");
  }
  if (result.suspiciousGroupCount > 0) {
    return translateDefault("backup.markdown.confirmSuspicious");
  }
  return translateDefault("backup.markdown.passed");
}

function formatTradeSummary(summary: BackupTradeSummary): string {
  const values = [
    summary.occurredAt
      ? translateDefault("backup.markdown.datePrefix") +
        singleLine(summary.occurredAt)
      : undefined,
    summary.assetSymbol
      ? translateDefault("backup.markdown.assetPrefix") +
        singleLine(summary.assetSymbol)
      : undefined,
    summary.type
      ? translateDefault("backup.markdown.directionPrefix") +
        (summary.type === "buy"
          ? translateDefault("backup.markdown.buy")
          : translateDefault("backup.markdown.sell"))
      : undefined,
    summary.quantity
      ? translateDefault("backup.markdown.quantityPrefix") +
        singleLine(summary.quantity)
      : undefined,
    summary.price
      ? translateDefault("backup.markdown.pricePrefix") +
        singleLine(summary.price)
      : undefined,
    summary.totalValue
      ? translateDefault("backup.markdown.totalPrefix") +
        singleLine(summary.totalValue) +
        (summary.currency ? ` ${singleLine(summary.currency)}` : "")
      : undefined,
  ].filter((value): value is string => value !== undefined);
  return values.length > 0
    ? values.join(translateDefault("backup.markdown.summarySeparator"))
    : translateDefault("backup.markdown.noSafeSummary");
}

function textOrUnavailable(value: string | undefined): string {
  return value === undefined
    ? translateDefault("backup.markdown.unavailable")
    : singleLine(value);
}

function numberOrUnavailable(value: number | undefined): string {
  return value === undefined
    ? translateDefault("backup.markdown.unavailable")
    : String(value);
}

function formatMissingMappings(value: readonly string[] | undefined): string {
  if (value === undefined) return translateDefault("backup.markdown.unavailable");
  return value.length === 0
    ? translateDefault("backup.markdown.none")
    : value.map((symbol) => `\`${inline(symbol)}\``).join("、");
}

function inline(value: string): string {
  return singleLine(value).replaceAll("`", "ˋ");
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
