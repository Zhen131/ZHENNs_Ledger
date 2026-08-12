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
    "# 明文备份预检报告",
    "",
    "> 隐私提醒：本报告可能包含交易日期、资产、买卖方向、数量和金额等敏感信息；复制或保存前请确认目标位置安全。",
    "",
    "## 摘要",
    "",
    `- 备份内容 SHA-256：\`${result.contentIdentity.sha256}\``,
    `- UTF-8 字节数：${result.contentIdentity.utf8ByteLength}`,
    `- 选择代次：${result.selectionGeneration}`,
    `- 硬错误总数：${result.hardErrorCount}`,
    `- 可疑重复组总数：${result.suspiciousGroupCount}`,
    `- 详情总数：${result.totalDetailCount}`,
    `- 报告保留详情：${result.retainedDetailCount}`,
    `- 可疑组 identity：\`${result.suspiciousGroupIdentity}\``,
    `- 结论：${formatConclusion(result)}`,
  ];

  if (result.metadata) {
    lines.push(
      "",
      "## 备份元数据",
      "",
      `- 应用版本：${textOrUnavailable(result.metadata.appVersion)}`,
      `- 导出时间：${textOrUnavailable(result.metadata.exportedAt)}`,
      `- 资产：${numberOrUnavailable(result.metadata.assetCount)}`,
      `- 交易：${numberOrUnavailable(result.metadata.tradeCount)}`,
      `- 价格快照：${numberOrUnavailable(result.metadata.priceSnapshotCount)}`,
      `- 手续费规则：${numberOrUnavailable(result.metadata.feeRuleCount)}`,
    );
  }

  if (result.skippedChecks.length > 0) {
    lines.push("", "## 未执行的检查", "");
    result.skippedChecks.forEach(({ check, reason }) => {
      lines.push(`- \`${inline(check)}\`：${singleLine(reason)}`);
    });
  }

  lines.push("", "## 详情", "");
  if (result.retainedDetails.length === 0) {
    lines.push("未发现硬错误或可疑重复组。");
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
      `> 详情共 ${result.totalDetailCount} 项，本报告只保留前 ${result.retainedDetailCount} 项。第 1001 项后已截断，请修正后重新检查。`,
    );
  }

  lines.push(
    "",
    "> 可疑重复只是提示。本应用没有自动修改、删除、合并或去重任何交易，也没有修改、移动、删除或主动上传原备份文件。",
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
    `### ${number}. 硬错误`,
    "",
    `- 错误码：\`${inline(error.code)}\``,
    `- 路径：\`${inline(error.path)}\``,
    `- 说明：${singleLine(error.message)}`,
  );
  if (error.line !== undefined && error.column !== undefined) {
    lines.push(`- JSON 位置：第 ${error.line} 行，第 ${error.column} 列`);
  }
  if (error.limit !== undefined && error.actual !== undefined) {
    lines.push(`- 资源边界：限制 ${error.limit}，实际 ${error.actual}`);
  }
  if (error.summary) {
    lines.push(`- 交易摘要：${formatTradeSummary(error.summary)}`);
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
      detail.group.level === "high" ? "高度可疑" : "一般可疑"
    }重复组`,
    "",
    `- 原始路径：${detail.group.tradeIndices
      .map((index) => `\`trades[${index}]\``)
      .join("、")}`,
    `- 交易 ID：${detail.group.tradeIds
      .map((id) => `\`${inline(id)}\``)
      .join("、")}`,
    `- 真实触发关系：${detail.group.triggerEdges
      .map(
        (edge) =>
          `\`trades[${edge.leftIndex}]\` ↔ \`trades[${edge.rightIndex}]\`（${
            edge.relation === "same-exact-time"
              ? "精确时间相同"
              : "同日且至少一笔为 day 精度"
          }）`,
      )
      .join("；")}`,
  );
  detail.summaries.forEach((summary, index) => {
    lines.push(
      `- trades[${detail.group.tradeIndices[index]}] 摘要：${formatTradeSummary(
        summary,
      )}`,
    );
  });
  lines.push(`- 说明：${singleLine(detail.message)}`, "");
}

function formatConclusion(result: BackupImportPreflightResult): string {
  if (result.hardErrorCount > 0) {
    return "BLOCKED；存在硬错误，不得继续导入。";
  }
  if (result.suspiciousGroupCount > 0) {
    return "预检结构通过，但必须先对当前可疑组做一次明确确认。";
  }
  return "预检通过；本报告本身不代表已经写入当前账本文件。";
}

function formatTradeSummary(summary: BackupTradeSummary): string {
  const values = [
    summary.occurredAt ? `日期 ${singleLine(summary.occurredAt)}` : undefined,
    summary.assetSymbol
      ? `资产 ${singleLine(summary.assetSymbol)}`
      : undefined,
    summary.type
      ? `方向 ${summary.type === "buy" ? "买入" : "卖出"}`
      : undefined,
    summary.quantity ? `数量 ${singleLine(summary.quantity)}` : undefined,
    summary.price ? `价格 ${singleLine(summary.price)}` : undefined,
    summary.totalValue
      ? `总额 ${singleLine(summary.totalValue)}${
          summary.currency ? ` ${singleLine(summary.currency)}` : ""
        }`
      : undefined,
  ].filter((value): value is string => value !== undefined);
  return values.length > 0 ? values.join("；") : "无可安全取得的摘要字段";
}

function textOrUnavailable(value: string | undefined): string {
  return value === undefined ? "不可得" : singleLine(value);
}

function numberOrUnavailable(value: number | undefined): string {
  return value === undefined ? "不可得" : String(value);
}

function inline(value: string): string {
  return singleLine(value).replaceAll("`", "ˋ");
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
