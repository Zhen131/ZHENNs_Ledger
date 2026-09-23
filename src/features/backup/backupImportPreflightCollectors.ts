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

export function getLedgerDataInput(parsed: unknown): unknown {
  return isRecord(parsed) ? parsed.ledgerData : undefined;
}

export function hasTradeCollection(ledgerInput: unknown): boolean {
  return isRecord(ledgerInput) && Array.isArray(ledgerInput.trades);
}

export function getTradeIndex(path: string): number | undefined {
  const match = /^trades\[(\d+)\]/.exec(path);
  return match ? Number(match[1]) : undefined;
}

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

export async function digestSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function skipped(
  check: BackupPreflightSkippedCheck["check"],
  reason: string,
): BackupPreflightSkippedCheck {
  return { check, reason };
}

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
