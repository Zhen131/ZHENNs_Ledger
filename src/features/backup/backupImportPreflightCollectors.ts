/**
 * 这个文件放预检用的一堆小函数。
 * 它们收集错误、整理基本情况、排序、去重。
 * 总的顺序在 `backupImportPreflight.ts` 里定。
 * 不显然的决定：硬错误按检查阶段、位置、代码排序；2026-07-31 定（W11 03A 第 4.4 节）。
 */
import type { LedgerData } from "@/core/models";
import { replayUsdtCash } from "@/core/calculations";
import { absolute, isNegative } from "@/core/shared";
import { translateDefault } from "@/ui";
import { type BackupEnvelopeError } from "./backupEnvelope";
import { listAssetsMissingBinanceMapping } from "@/features/market-data";
import type {
  BackupTradeSummary,
  BackupPreflightHardError,
  BackupPreflightSkippedCheck,
  BackupPreflightMetadata,
  BackupPreflightWarning,
} from "./backupImportPreflightTypes";

/**
 * 这个函数把一条检查错误变成报告里的一条硬错误。
 * 它补上检查阶段和说明；出错的是某笔交易时，再补上交易简样。
 * 举例：`trades[3].quantity` 出错 → 答第 4 阶段的一条，带第 3 笔的简样。
 * 不会出错。
 */
export function normalizeEnvelopeError(
  error: BackupEnvelopeError,
  parsed: unknown,
): BackupPreflightHardError {
  const summary =
    error.path.startsWith("trades[")
      ? createTradeSummary(parsed, getTradeIndex(error.path))
      : undefined;

  return {
    kind: "hard-error",
    stage: getValidationStage(error.code),
    code: error.code,
    path: error.path,
    message: toChineseErrorMessage(error),
    ...(summary === undefined ? {} : { summary }),
    ...("limit" in error ? { limit: error.limit, actual: error.actual } : {}),
  };
}

// 检查阶段的编号照预检的固定顺序。
// 大小 1、JSON 2、外壳 3、账本 4。
// 原句 5、上限 6、导入规矩 7，别的 8。
// 这个顺序 2026-07-31 定（W11 03A 第 4.3 节）。
function getValidationStage(code: string): number {
  if (code === "LEDGER_RESOURCE_FILE_TOO_LARGE") return 1;
  if (code === "BACKUP_BAD_JSON") return 2;
  if (code.startsWith("BACKUP_")) return 3;
  if (code.startsWith("LEDGER_DATA_")) return 4;
  if (code === "BACKUP_TRADE_RAW_TEXT_REQUIRED") return 5;
  if (code.startsWith("LEDGER_RESOURCE_")) return 6;
  if (code.startsWith("LEDGER_IMPORT_")) return 7;
  return 8;
}

function toChineseErrorMessage(error: BackupEnvelopeError): string {
  if (error.code.startsWith("LEDGER_RESOURCE_")) {
    return error.message;
  }
  if (error.code.startsWith("LEDGER_IMPORT_")) {
    return translateDefault("backup.preflight.importPolicyPrefix") + error.message;
  }
  if (error.code.startsWith("LEDGER_DATA_")) {
    return translateDefault("backup.preflight.ledgerStructurePrefix") + error.message;
  }
  if (
    (error.code === "BACKUP_UNSUPPORTED_FORMAT_VERSION" ||
      error.code === "BACKUP_SCHEMA_VERSION_MISMATCH") &&
    error.message.endsWith(
      translateDefault("backup.preflight.noMigrationSuffix"),
    )
  ) {
    return error.message;
  }

  const labels: Partial<Record<BackupEnvelopeError["code"], string>> = {
    BACKUP_BAD_JSON: translateDefault("backup.preflight.invalidJson"),
    BACKUP_INVALID_ENVELOPE: translateDefault("backup.preflight.invalidEnvelope"),
    BACKUP_UNSUPPORTED_FORMAT_VERSION: translateDefault("backup.preflight.unsupportedVersion"),
    BACKUP_INVALID_APP_VERSION: translateDefault("backup.preflight.invalidAppVersion"),
    BACKUP_INVALID_EXPORTED_AT: translateDefault("backup.preflight.invalidExportedAt"),
    BACKUP_SCHEMA_VERSION_MISMATCH: translateDefault("backup.preflight.schemaVersionMismatch"),
  };
  return labels[error.code] ?? translateDefault("backup.preflight.validationFailedPrefix") + error.message;
}

/**
 * 这个函数回答：哪些交易没带原句？每笔记一条硬错误。
 * 只在「历史导入」时调用。
 * 举例：第 146 笔原句是空格 → 答一条，位置 `trades[146].rawText`。
 * 不会出错。
 */
export function collectHistoricalRawTextErrors(
  parsed: unknown,
): BackupPreflightHardError[] {
  const ledgerData = getLedgerDataInput(parsed);
  if (!isRecord(ledgerData) || !Array.isArray(ledgerData.trades)) {
    return [];
  }

  const errors: BackupPreflightHardError[] = [];
  ledgerData.trades.forEach((trade, index) => {
    if (!isRecord(trade)) {
      return;
    }
    if (
      typeof trade.rawText === "string" &&
      trade.rawText.trim().length > 0
    ) {
      return;
    }

    errors.push({
      kind: "hard-error",
      stage: 5,
      code: "BACKUP_TRADE_RAW_TEXT_REQUIRED",
      path: `trades[${index}].rawText`,
      message:
        translateDefault("backup.preflight.rawTextRequired"),
      summary: createTradeSummary(parsed, index),
    });
  });
  return errors;
}

/**
 * 这个函数回答：哪些交易的编号和前面某笔重了？每笔记一条硬错误。
 * 前面已经报过的同一位置，不重复报。
 * 举例：第 5 笔和第 2 笔编号一样 → 答一条，说和第 2 笔重复。
 */
export function collectDuplicateTradeIdErrors(
  parsed: unknown,
  existingErrors: readonly BackupPreflightHardError[],
): BackupPreflightHardError[] {
  const ledgerData = getLedgerDataInput(parsed);
  if (!isRecord(ledgerData) || !Array.isArray(ledgerData.trades)) {
    return [];
  }

  const firstIndexById = new Map<string, number>();
  const errors: BackupPreflightHardError[] = [];
  ledgerData.trades.forEach((trade, index) => {
    if (!isRecord(trade) || typeof trade.id !== "string" || trade.id === "") {
      return;
    }
    const firstIndex = firstIndexById.get(trade.id);
    if (firstIndex === undefined) {
      firstIndexById.set(trade.id, index);
      return;
    }

    const path = `trades[${index}].id`;
    if (
      existingErrors.some(
        (error) =>
          error.code === "LEDGER_DATA_DUPLICATE_IDENTIFIER" &&
          error.path === path,
      )
    ) {
      return;
    }
    errors.push({
      kind: "hard-error",
      stage: 4,
      code: "LEDGER_DATA_DUPLICATE_IDENTIFIER",
      path,
      message:
        translateDefault("backup.preflight.duplicateTradeIdPrefix") +
        firstIndex +
        translateDefault("backup.preflight.duplicateTradeIdSuffix"),
      summary: createTradeSummary(parsed, index),
    });
  });
  return errors;
}

/**
 * 这个函数回答：哪些位置上的交易编号出现了不止一次？
 * 举例：第 2、5 笔编号一样 → 答 {2, 5}。
 * 这些交易不再参加找重复。
 */
export function collectDuplicateTradeIdIndexes(parsed: unknown): ReadonlySet<number> {
  const ledgerData = getLedgerDataInput(parsed);
  if (!isRecord(ledgerData) || !Array.isArray(ledgerData.trades)) {
    return new Set();
  }

  const indexesById = new Map<string, number[]>();
  ledgerData.trades.forEach((trade, index) => {
    if (!isRecord(trade) || typeof trade.id !== "string" || trade.id === "") {
      return;
    }
    const indexes = indexesById.get(trade.id);
    if (indexes) {
      indexes.push(index);
    } else {
      indexesById.set(trade.id, [index]);
    }
  });

  return new Set(
    [...indexesById.values()]
      .filter((indexes) => indexes.length > 1)
      .flat(),
  );
}

/**
 * 这个函数整理 B 文件的基本情况。
 * 有文件名、版本号、导出时刻、各类记录条数。
 * 账本检查过了时，再算出现金余额、缺口和没配币安对的币。
 * 读不到的就不写。
 */
export function collectMetadata(
  parsed: unknown,
  sourceFileName?: string,
  validatedLedgerData?: LedgerData,
): BackupPreflightMetadata | undefined {
  if (!isRecord(parsed) && sourceFileName === undefined) return undefined;

  const ledgerInput = getLedgerDataInput(parsed);
  const metadata: BackupPreflightMetadata = {
    ...(sourceFileName === undefined ? {} : { sourceFileName }),
    ...(isRecord(parsed) && typeof parsed.backupFormatVersion === "number"
      ? { backupFormatVersion: parsed.backupFormatVersion }
      : {}),
    ...(isRecord(parsed) && typeof parsed.appVersion === "string"
      ? { appVersion: parsed.appVersion }
      : {}),
    ...(isRecord(parsed) && typeof parsed.exportedAt === "string"
      ? { exportedAt: parsed.exportedAt }
      : {}),
    ...(isRecord(parsed) && typeof parsed.ledgerSchemaVersion === "number"
      ? { ledgerSchemaVersion: parsed.ledgerSchemaVersion }
      : {}),
    ...(isRecord(ledgerInput) && Array.isArray(ledgerInput.assets)
      ? { assetCount: ledgerInput.assets.length }
      : {}),
    ...(isRecord(ledgerInput) && Array.isArray(ledgerInput.trades)
      ? { tradeCount: ledgerInput.trades.length }
      : {}),
    ...(isRecord(ledgerInput) && Array.isArray(ledgerInput.cashEvents)
      ? { cashEventCount: ledgerInput.cashEvents.length }
      : {}),
    ...(isRecord(ledgerInput) && Array.isArray(ledgerInput.assetTransfers)
      ? { assetTransferCount: ledgerInput.assetTransfers.length }
      : {}),
    ...(isRecord(ledgerInput) && Array.isArray(ledgerInput.priceSnapshots)
      ? { priceSnapshotCount: ledgerInput.priceSnapshots.length }
      : {}),
    ...(isRecord(ledgerInput) && Array.isArray(ledgerInput.feeRules)
      ? { feeRuleCount: ledgerInput.feeRules.length }
      : {}),
    ...(validatedLedgerData === undefined
      ? {}
      : collectLedgerSummary(validatedLedgerData)),
  };
  return metadata;
}

/**
 * 这个函数只整理外壳上的基本情况。
 * 有文件名、版本号、导出时刻。
 * 旧版本文件被拒绝时用它，不往账本里面读。
 */
export function collectTopLevelMetadata(
  parsed: Record<string, unknown>,
  sourceFileName?: string,
): BackupPreflightMetadata {
  return {
    ...(sourceFileName === undefined ? {} : { sourceFileName }),
    ...(typeof parsed.backupFormatVersion === "number"
      ? { backupFormatVersion: parsed.backupFormatVersion }
      : {}),
    ...(typeof parsed.appVersion === "string"
      ? { appVersion: parsed.appVersion }
      : {}),
    ...(typeof parsed.exportedAt === "string"
      ? { exportedAt: parsed.exportedAt }
      : {}),
    ...(typeof parsed.ledgerSchemaVersion === "number"
      ? { ledgerSchemaVersion: parsed.ledgerSchemaVersion }
      : {}),
  };
}

function collectLedgerSummary(
  ledgerData: LedgerData,
): Pick<
  BackupPreflightMetadata,
  "cashBalance" | "cashDeficit" | "missingMappingSymbols"
> {
  const balance = replayUsdtCash(ledgerData).balance;
  return {
    cashBalance: balance,
    cashDeficit: isNegative(balance) ? absolute(balance) : "0",
    missingMappingSymbols: listAssetsMissingBinanceMapping(ledgerData),
  };
}

/**
 * 这个函数回答：这本账导入后有没有要提醒的？
 * 现在只看一样：现金会不会是负数。
 * 举例：导入后 USDT 余额 -200 → 答一条提醒。
 */
export function collectWarnings(
  ledgerData: LedgerData | undefined,
): BackupPreflightWarning[] {
  if (!ledgerData) return [];
  const balance = replayUsdtCash(ledgerData).balance;
  return isNegative(balance)
    ? [
        {
          code: "BACKUP_NEGATIVE_CASH_BALANCE",
          message:
            translateDefault("backup.preflight.negativeCashPrefix") +
            balance +
            translateDefault("backup.preflight.negativeCashSuffix"),
        },
      ]
    : [];
}

/**
 * 这个函数回答：第几笔交易的简样是什么？
 * 只取日期、币、买卖、数量、单价、金额、币种。
 * 读不到的就空着。
 */
export function createTradeSummary(
  parsed: unknown,
  index: number | undefined,
): BackupTradeSummary {
  if (index === undefined) {
    return {};
  }
  const ledgerData = getLedgerDataInput(parsed);
  if (!isRecord(ledgerData) || !Array.isArray(ledgerData.trades)) {
    return {};
  }
  const trade = ledgerData.trades[index];
  if (!isRecord(trade)) {
    return {};
  }

  return {
    ...(typeof trade.occurredAt === "string"
      ? { occurredAt: trade.occurredAt }
      : {}),
    ...(typeof trade.assetSymbol === "string"
      ? { assetSymbol: trade.assetSymbol }
      : {}),
    ...(trade.type === "buy" || trade.type === "sell"
      ? { type: trade.type }
      : {}),
    ...(typeof trade.quantity === "string"
      ? { quantity: trade.quantity }
      : {}),
    ...(typeof trade.price === "string" ? { price: trade.price } : {}),
    ...(typeof trade.totalValue === "string"
      ? { totalValue: trade.totalValue }
      : {}),
    ...(typeof trade.currency === "string"
      ? { currency: trade.currency }
      : {}),
  };
}

/** 这个函数取出 B 文件里 `ledgerData` 那一块，没有就返回空。 */
export function getLedgerDataInput(parsed: unknown): unknown {
  return isRecord(parsed) ? parsed.ledgerData : undefined;
}

/** 这个函数回答：账本那一块里有没有一个 `trades` 数组？ */
export function hasTradeCollection(ledgerInput: unknown): boolean {
  return isRecord(ledgerInput) && Array.isArray(ledgerInput.trades);
}

/**
 * 这个函数从出错位置里读出是第几笔交易。
 * 举例：`trades[146].rawText` → 答 146；别的位置答空。
 */
export function getTradeIndex(path: string): number | undefined {
  const match = /^trades\[(\d+)\]/.exec(path);
  return match ? Number(match[1]) : undefined;
}

/**
 * 这个函数去掉重复的硬错误。
 * 阶段、代码、位置、行列都一样才算重复。
 */
export function deduplicateHardErrors(
  errors: readonly BackupPreflightHardError[],
): BackupPreflightHardError[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = [
      error.stage,
      error.code,
      error.path,
      error.line,
      error.column,
    ].join("\u0000");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * 这个函数定两条硬错误谁排前面。
 * 先比阶段，再比位置，最后比代码。
 * 位置里的数字按大小比，`trades[2]` 排在 `trades[10]` 前面。
 */
export function compareHardErrors(
  left: BackupPreflightHardError,
  right: BackupPreflightHardError,
): number {
  return (
    left.stage - right.stage ||
    left.path.localeCompare(right.path, "en", { numeric: true }) ||
    (left.code < right.code ? -1 : left.code > right.code ? 1 : 0)
  );
}

/**
 * 这个函数回答：JSON 读不下去，错在第几行第几列？
 * 浏览器的说明里有行列就直接用。
 * 只有字符位置，就换算成行列。
 * 都没有就返回空，不编一个出来。
 */
export function extractJsonErrorLocation(
  error: unknown,
  serializedBackup: string,
): Readonly<{ line?: number; column?: number }> {
  if (!(error instanceof Error)) {
    return {};
  }

  const direct = /line\s+(\d+)\s+column\s+(\d+)/i.exec(error.message);
  if (direct) {
    return { line: Number(direct[1]), column: Number(direct[2]) };
  }

  const position = /position\s+(\d+)/i.exec(error.message);
  if (!position) {
    return {};
  }
  const offset = Number(position[1]);
  if (!Number.isInteger(offset) || offset < 0) {
    return {};
  }
  const prefix = serializedBackup.slice(0, offset);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

/** 这个函数算一段字节的 SHA-256 摘要，写成小写十六进制。 */
export async function digestSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 这个函数造一条「这项检查没做」的记录：哪一项、为什么。 */
export function skipped(
  check: BackupPreflightSkippedCheck["check"],
  reason: string,
): BackupPreflightSkippedCheck {
  return { check, reason };
}

/** 这个函数把一个东西连同里面的每一层都冻住，谁也改不了。 */
export function deepFreeze<T>(value: T): T {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

/**
 * 这个函数回答：这个值是不是一个普通对象？
 * 空值和数组都不算。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
