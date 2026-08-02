import type {
  BackupImportPreflightResult,
  BackupPreflightHardError,
  BackupPreflightSuspiciousDetail,
  BackupTradeSummary,
} from "./backupImportPreflight";

export function formatBackupImportReportMarkdown(
  result: BackupImportPreflightResult,
): string {
  const lines: string[] = [
    "# Historical B Import Preflight Report",
    "",
    "> Privacy notice: this report may contain sensitive trade dates, assets, directions, quantities, and amounts. Confirm the destination is secure before copying or saving it.",
    "",
    "## Summary",
    "",
    `- B content SHA-256: \`${result.contentIdentity.sha256}\``,
    `- UTF-8 byte length: ${result.contentIdentity.utf8ByteLength}`,
    `- Selection generation: ${result.selectionGeneration}`,
    `- Hard error count: ${result.hardErrorCount}`,
    `- Suspicious duplicate group count: ${result.suspiciousGroupCount}`,
    `- Total detail count: ${result.totalDetailCount}`,
    `- Retained report details: ${result.retainedDetailCount}`,
    `- Suspicious group identity: \`${result.suspiciousGroupIdentity}\``,
    `- Conclusion: ${formatConclusion(result)}`,
  ];

  if (result.metadata) {
    lines.push(
      "",
      "## B Metadata",
      "",
      `- App version: ${textOrUnavailable(result.metadata.appVersion)}`,
      `- Exported at: ${textOrUnavailable(result.metadata.exportedAt)}`,
      `- Assets: ${numberOrUnavailable(result.metadata.assetCount)}`,
      `- Trades: ${numberOrUnavailable(result.metadata.tradeCount)}`,
      `- Price snapshots: ${numberOrUnavailable(result.metadata.priceSnapshotCount)}`,
      `- Fee rules: ${numberOrUnavailable(result.metadata.feeRuleCount)}`,
    );
  }

  if (result.skippedChecks.length > 0) {
    lines.push("", "## Skipped Checks", "");
    result.skippedChecks.forEach(({ check, reason }) => {
      lines.push(`- \`${inline(check)}\`: ${singleLine(reason)}`);
    });
  }

  lines.push("", "## Details", "");
  if (result.retainedDetails.length === 0) {
    lines.push("No hard errors or suspicious duplicate groups were found.");
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
      `> ${result.totalDetailCount} details were found. This report retains the first ${result.retainedDetailCount}. Details after item 1000 were truncated; correct the data and run the check again.`,
    );
  }

  lines.push(
    "",
    "> Suspicious duplicates are warnings only. The app did not automatically modify, delete, merge, or deduplicate any trade, and it did not modify, move, delete, or upload the original B file.",
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
    `### ${number}. Hard Error`,
    "",
    `- Error code: \`${inline(error.code)}\``,
    `- Path: \`${inline(error.path)}\``,
    `- Description: ${singleLine(error.message)}`,
  );
  if (error.line !== undefined && error.column !== undefined) {
    lines.push(`- JSON location: line ${error.line}, column ${error.column}`);
  }
  if (error.limit !== undefined && error.actual !== undefined) {
    lines.push(`- Resource boundary: limit ${error.limit}, actual ${error.actual}`);
  }
  if (error.summary) {
    lines.push(`- Trade summary: ${formatTradeSummary(error.summary)}`);
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
      detail.group.level === "high" ? "Highly Suspicious" : "Suspicious"
    } Duplicate Group`,
    "",
    `- Source paths: ${detail.group.tradeIndices
      .map((index) => `\`trades[${index}]\``)
      .join(", ")}`,
    `- Trade IDs: ${detail.group.tradeIds
      .map((id) => `\`${inline(id)}\``)
      .join(", ")}`,
    `- Trigger edges: ${detail.group.triggerEdges
      .map(
        (edge) =>
          `\`trades[${edge.leftIndex}]\` ↔ \`trades[${edge.rightIndex}]\` (${
            edge.relation === "same-exact-time"
              ? "same exact time"
              : "same day with at least one day-precision trade"
          })`,
      )
      .join("; ")}`,
  );
  detail.summaries.forEach((summary, index) => {
    lines.push(
      `- trades[${detail.group.tradeIndices[index]}] summary: ${formatTradeSummary(
        summary,
      )}`,
    );
  });
  lines.push(`- Description: ${singleLine(detail.message)}`, "");
}

function formatConclusion(result: BackupImportPreflightResult): string {
  if (result.hardErrorCount > 0) {
    return "BLOCKED: hard errors exist, so import must not continue.";
  }
  if (result.suspiciousGroupCount > 0) {
    return "The structural preflight passed, but the current suspicious groups require explicit confirmation.";
  }
  return "Preflight passed. This report does not prove that C was written.";
}

function formatTradeSummary(summary: BackupTradeSummary): string {
  const values = [
    summary.occurredAt ? `Date ${singleLine(summary.occurredAt)}` : undefined,
    summary.assetSymbol
      ? `Asset ${singleLine(summary.assetSymbol)}`
      : undefined,
    summary.type
      ? `Direction ${summary.type === "buy" ? "Buy" : "Sell"}`
      : undefined,
    summary.quantity ? `Quantity ${singleLine(summary.quantity)}` : undefined,
    summary.price ? `Price ${singleLine(summary.price)}` : undefined,
    summary.totalValue
      ? `Total value ${singleLine(summary.totalValue)}${
          summary.currency ? ` ${singleLine(summary.currency)}` : ""
        }`
      : undefined,
  ].filter((value): value is string => value !== undefined);
  return values.length > 0
    ? values.join("; ")
    : "No summary fields can be retrieved safely";
}

function textOrUnavailable(value: string | undefined): string {
  return value === undefined ? "Unavailable" : singleLine(value);
}

function numberOrUnavailable(value: number | undefined): string {
  return value === undefined ? "Unavailable" : String(value);
}

function inline(value: string): string {
  return singleLine(value).replaceAll("`", "ˋ");
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
