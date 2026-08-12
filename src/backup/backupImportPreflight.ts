import type { LedgerData } from "@/core/models";
import { validateLedgerImportPolicy } from "@/core/policies";
import {
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "@/core/validation";
import {
  collectValidLedgerTradeProjections,
  validateLedgerData,
} from "@/core/validation";
import {
  groupSuspiciousBackupTrades,
  type SuspiciousBackupTradeGroup,
} from "./backupDuplicateGrouping";
import {
  validateBackupEnvelope,
  type BackupEnvelopeError,
  type BackupEnvelopeV2,
} from "./backupEnvelope";
import { createLedgerDataContentIdentity } from "./backupContentIdentity";

export const BACKUP_PREFLIGHT_PAGE_DETAIL_LIMIT = 50;
export const BACKUP_PREFLIGHT_REPORT_DETAIL_LIMIT = 1000;

export type BackupContentIdentity = Readonly<{
  sha256: string;
  utf8ByteLength: number;
  value: string;
}>;

export type BackupTradeSummary = Readonly<{
  occurredAt?: string;
  assetSymbol?: string;
  type?: "buy" | "sell";
  quantity?: string;
  price?: string;
  totalValue?: string;
  currency?: string;
}>;

export type BackupPreflightHardError = Readonly<{
  kind: "hard-error";
  stage: number;
  code: string;
  path: string;
  message: string;
  summary?: BackupTradeSummary;
  line?: number;
  column?: number;
  limit?: number;
  actual?: number;
}>;

export type BackupPreflightSuspiciousDetail = Readonly<{
  kind: "suspicious-group";
  group: SuspiciousBackupTradeGroup;
  summaries: readonly BackupTradeSummary[];
  message: string;
}>;

export type BackupPreflightDetail =
  | BackupPreflightHardError
  | BackupPreflightSuspiciousDetail;

export type BackupPreflightSkippedCheck = Readonly<{
  check:
    | "json-parse"
    | "backup-envelope"
    | "ledger-structure"
    | "resource-policy"
    | "import-policy"
    | "duplicate-grouping";
  reason: string;
}>;

export type BackupPreflightMetadata = Readonly<{
  appVersion?: string;
  exportedAt?: string;
  assetCount?: number;
  tradeCount?: number;
  priceSnapshotCount?: number;
  feeRuleCount?: number;
}>;

export type BackupImportPreflightResult = Readonly<{
  contentIdentity: BackupContentIdentity;
  selectionGeneration: number;
  suspiciousGroupIdentity: string;
  hardErrorCount: number;
  suspiciousGroupCount: number;
  totalDetailCount: number;
  retainedDetailCount: number;
  truncated: boolean;
  retainedDetails: readonly BackupPreflightDetail[];
  visibleDetails: readonly BackupPreflightDetail[];
  skippedChecks: readonly BackupPreflightSkippedCheck[];
  metadata?: BackupPreflightMetadata;
  candidate?: Readonly<LedgerData>;
  candidateIdentity?: string;
}>;

export type LedgerBackupImportEvidence = Readonly<{
  contentIdentity: string;
  candidateIdentity: string;
  selectionGeneration: number;
  hardErrorCount: number;
  suspiciousGroupCount: number;
  suspiciousGroupIdentity: string;
  confirmedSuspiciousGroupIdentity: string | null;
}>;

declare const backupSuspicionConfirmationBrand: unique symbol;

export type BackupSuspicionConfirmationReceipt = Readonly<{
  [backupSuspicionConfirmationBrand]: true;
}>;

export type BackupImportPreflightAttestation = Readonly<{
  contentIdentity: string;
  candidateIdentity: string;
  selectionGeneration: number;
  hardErrorCount: 0;
  suspiciousGroupCount: number;
  suspiciousGroupIdentity: string;
  requireHistoricalRawText: boolean;
}>;

type PreflightReceiptRuntime = {
  active: boolean;
  readonly attestation: BackupImportPreflightAttestation;
};

const preflightReceiptRuntimes = new WeakMap<
  BackupImportPreflightResult,
  PreflightReceiptRuntime
>();
const suspicionConfirmationRuntimes = new WeakMap<
  BackupSuspicionConfirmationReceipt,
  Readonly<{
    preflight: BackupImportPreflightResult;
    suspiciousGroupIdentity: string;
  }>
>();
const importEvidenceRuntimes = new WeakMap<
  LedgerBackupImportEvidence,
  Readonly<{
    preflight: BackupImportPreflightResult;
    confirmation: BackupSuspicionConfirmationReceipt | null;
  }>
>();

export type BackupImportPreflightOptions = Readonly<{
  todayKey: string;
  selectionGeneration: number;
  /**
   * Historical B -> C import requires every trade to preserve its source line.
   * The option stays explicit so existing generic rescue-backup restoration can
   * retain the optional Trade.rawText schema contract.
   */
  requireHistoricalRawText?: boolean;
}>;

export async function preflightBackupJson(
  serializedBackup: string,
  options: BackupImportPreflightOptions,
): Promise<BackupImportPreflightResult> {
  const encoded = new TextEncoder().encode(serializedBackup);
  const contentSha256 = await digestSha256Hex(encoded);
  const contentIdentity: BackupContentIdentity = {
    sha256: contentSha256,
    utf8ByteLength: encoded.byteLength,
    value: `${contentSha256}:${encoded.byteLength}`,
  };
  const skippedChecks: BackupPreflightSkippedCheck[] = [];
  const bytePolicy = evaluateLedgerJsonResourcePolicy(serializedBackup);

  if (!bytePolicy.ok) {
    skippedChecks.push(
      skipped("json-parse", "文件超过 8 MiB，上限检查后停止。"),
      skipped("backup-envelope", "JSON 未解析。"),
      skipped("ledger-structure", "JSON 未解析。"),
      skipped("resource-policy", "JSON 未解析。"),
      skipped("import-policy", "JSON 未解析。"),
      skipped("duplicate-grouping", "JSON 未解析。"),
    );
    return finalizeResult({
      contentIdentity,
      selectionGeneration: options.selectionGeneration,
      requireHistoricalRawText:
        options.requireHistoricalRawText ?? true,
      hardErrors: bytePolicy.errors.map((error) =>
        normalizeEnvelopeError(error, undefined),
      ),
      suspiciousGroups: [],
      skippedChecks,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedBackup);
  } catch (error) {
    const location = extractJsonErrorLocation(error, serializedBackup);
    skippedChecks.push(
      skipped("backup-envelope", "JSON 语法错误。"),
      skipped("ledger-structure", "JSON 语法错误。"),
      skipped("resource-policy", "JSON 语法错误。"),
      skipped("import-policy", "JSON 语法错误。"),
      skipped("duplicate-grouping", "JSON 语法错误。"),
    );
    return finalizeResult({
      contentIdentity,
      selectionGeneration: options.selectionGeneration,
      requireHistoricalRawText:
        options.requireHistoricalRawText ?? true,
      hardErrors: [
        {
          kind: "hard-error",
          stage: 2,
          code: "BACKUP_BAD_JSON",
          path: "file",
          message:
            location.line === undefined
              ? "JSON 语法错误；解析器没有提供可靠的行列位置。"
              : `JSON 语法错误，位置为第 ${location.line} 行、第 ${location.column} 列。`,
          ...location,
        },
      ],
      suspiciousGroups: [],
      skippedChecks,
    });
  }

  const metadata = collectMetadata(parsed);
  const envelopeResult = validateBackupEnvelope(parsed, options.todayKey);
  const ledgerInput = getLedgerDataInput(parsed);
  const ledgerResult = validateLedgerData(ledgerInput);
  const hardErrors: BackupPreflightHardError[] = !envelopeResult.ok
    ? envelopeResult.errors.map((error) =>
        normalizeEnvelopeError(error, parsed),
      )
    : [];

  const rawTextInvalidIndexes = new Set<number>();
  if (options.requireHistoricalRawText ?? true) {
    for (const error of collectHistoricalRawTextErrors(parsed)) {
      hardErrors.push(error);
      const index = getTradeIndex(error.path);
      if (index !== undefined) {
        rawTextInvalidIndexes.add(index);
      }
    }
  }

  hardErrors.push(...collectDuplicateTradeIdErrors(parsed, hardErrors));
  const duplicateTradeIdIndexes = collectDuplicateTradeIdIndexes(parsed);

  if (!ledgerResult.ok) {
    skippedChecks.push(
      skipped(
        "resource-policy",
        "LedgerData 结构未完整通过，不能安全执行完整资源策略。",
      ),
      skipped(
        "import-policy",
        "LedgerData 结构未完整通过，不能安全执行完整业务导入策略。",
      ),
    );
  } else {
    // These calls are intentionally explicit. validateBackupEnvelope() also
    // applies them, while the preflight records that the layers really ran.
    evaluateLedgerResourcePolicy(ledgerResult.value);
    validateLedgerImportPolicy(ledgerResult.value, options.todayKey);
  }

  const canProjectTrades = hasTradeCollection(ledgerInput);
  const validTradeProjections = canProjectTrades
    ? collectValidLedgerTradeProjections(ledgerInput).filter(
        ({ originalIndex }) =>
          !rawTextInvalidIndexes.has(originalIndex) &&
          !duplicateTradeIdIndexes.has(originalIndex),
      )
    : [];
  if (!canProjectTrades) {
    skippedChecks.push(
      skipped(
        "duplicate-grouping",
        "trades 不是可安全读取的数组，无法执行重复分组。",
      ),
    );
  }

  const suspiciousGroups = canProjectTrades
    ? groupSuspiciousBackupTrades(validTradeProjections)
    : [];
  const deduplicatedErrors = deduplicateHardErrors(hardErrors);
  const hasHardErrors = deduplicatedErrors.length > 0;
  const candidate =
    !hasHardErrors && envelopeResult.ok
      ? deepFreeze(structuredClone(envelopeResult.value.ledgerData))
      : undefined;

  return finalizeResult({
    contentIdentity,
    selectionGeneration: options.selectionGeneration,
    requireHistoricalRawText:
      options.requireHistoricalRawText ?? true,
    hardErrors: deduplicatedErrors,
    suspiciousGroups,
    skippedChecks,
    metadata,
    parsed,
    candidate,
  });
}

type FinalizeInput = Readonly<{
  contentIdentity: BackupContentIdentity;
  selectionGeneration: number;
  requireHistoricalRawText: boolean;
  hardErrors: readonly BackupPreflightHardError[];
  suspiciousGroups: readonly SuspiciousBackupTradeGroup[];
  skippedChecks: readonly BackupPreflightSkippedCheck[];
  metadata?: BackupPreflightMetadata;
  parsed?: unknown;
  candidate?: Readonly<LedgerData>;
}>;

async function finalizeResult(
  input: FinalizeInput,
): Promise<BackupImportPreflightResult> {
  const sortedHardErrors = [...input.hardErrors].sort(compareHardErrors);
  const suspiciousDetails = input.suspiciousGroups.map((group) => ({
    kind: "suspicious-group" as const,
    group,
    summaries: group.tradeIndices.map((index) =>
      createTradeSummary(input.parsed, index),
    ),
    message:
      "这些交易仅被标记为可疑；应用没有自动修改、删除、合并或去重。",
  }));
  const allDetails: BackupPreflightDetail[] = [
    ...sortedHardErrors,
    ...suspiciousDetails,
  ];
  const retainedDetails = allDetails.slice(
    0,
    BACKUP_PREFLIGHT_REPORT_DETAIL_LIMIT,
  );
  const suspiciousGroupIdentity = await digestSha256Hex(
    new TextEncoder().encode(
      JSON.stringify(
        input.suspiciousGroups.map((group) => ({
          level: group.level,
          tradeIndices: group.tradeIndices,
          tradeIds: group.tradeIds,
          triggerEdges: group.triggerEdges,
        })),
      ),
    ),
  );
  const candidateIdentity = input.candidate
    ? await createLedgerDataContentIdentity(input.candidate)
    : undefined;

  const result: BackupImportPreflightResult = deepFreeze({
    contentIdentity: input.contentIdentity,
    selectionGeneration: input.selectionGeneration,
    suspiciousGroupIdentity,
    hardErrorCount: sortedHardErrors.length,
    suspiciousGroupCount: suspiciousDetails.length,
    totalDetailCount: allDetails.length,
    retainedDetailCount: retainedDetails.length,
    truncated:
      allDetails.length > BACKUP_PREFLIGHT_REPORT_DETAIL_LIMIT,
    retainedDetails,
    visibleDetails: retainedDetails.slice(
      0,
      BACKUP_PREFLIGHT_PAGE_DETAIL_LIMIT,
    ),
    skippedChecks: [...input.skippedChecks],
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    ...(input.candidate === undefined ? {} : { candidate: input.candidate }),
    ...(candidateIdentity === undefined ? {} : { candidateIdentity }),
  });
  if (
    result.hardErrorCount === 0 &&
    result.candidate !== undefined &&
    result.candidateIdentity !== undefined
  ) {
    preflightReceiptRuntimes.set(result, {
      active: true,
      attestation: Object.freeze({
        contentIdentity: result.contentIdentity.value,
        candidateIdentity: result.candidateIdentity,
        selectionGeneration: result.selectionGeneration,
        hardErrorCount: 0,
        suspiciousGroupCount: result.suspiciousGroupCount,
        suspiciousGroupIdentity: result.suspiciousGroupIdentity,
        requireHistoricalRawText: input.requireHistoricalRawText,
      }),
    });
  }
  return result;
}

export function confirmBackupImportSuspiciousGroups(
  preflight: BackupImportPreflightResult,
): BackupSuspicionConfirmationReceipt | null {
  const runtime = preflightReceiptRuntimes.get(preflight);
  if (
    !runtime?.active ||
    runtime.attestation.suspiciousGroupCount === 0
  ) {
    return null;
  }

  const confirmation = Object.freeze(
    {},
  ) as BackupSuspicionConfirmationReceipt;
  suspicionConfirmationRuntimes.set(confirmation, {
    preflight,
    suspiciousGroupIdentity:
      runtime.attestation.suspiciousGroupIdentity,
  });
  return confirmation;
}

export function isBackupImportSuspicionConfirmationValid(
  preflight: BackupImportPreflightResult,
  confirmation: BackupSuspicionConfirmationReceipt | null,
): boolean {
  const runtime = preflightReceiptRuntimes.get(preflight);
  if (!runtime?.active) {
    return false;
  }
  if (runtime.attestation.suspiciousGroupCount === 0) {
    return confirmation === null;
  }
  if (!confirmation) {
    return false;
  }
  const confirmationRuntime =
    suspicionConfirmationRuntimes.get(confirmation);
  return Boolean(
    confirmationRuntime &&
      confirmationRuntime.preflight === preflight &&
      confirmationRuntime.suspiciousGroupIdentity ===
        runtime.attestation.suspiciousGroupIdentity,
  );
}

export function createLedgerBackupImportEvidence(
  preflight: BackupImportPreflightResult,
  confirmation: BackupSuspicionConfirmationReceipt | null = null,
): LedgerBackupImportEvidence | null {
  const runtime = preflightReceiptRuntimes.get(preflight);
  if (
    !runtime?.active ||
    !isBackupImportSuspicionConfirmationValid(
      preflight,
      confirmation,
    )
  ) {
    return null;
  }

  const { attestation } = runtime;
  const evidence: LedgerBackupImportEvidence = Object.freeze({
    contentIdentity: attestation.contentIdentity,
    candidateIdentity: attestation.candidateIdentity,
    selectionGeneration: attestation.selectionGeneration,
    hardErrorCount: attestation.hardErrorCount,
    suspiciousGroupCount: attestation.suspiciousGroupCount,
    suspiciousGroupIdentity: attestation.suspiciousGroupIdentity,
    confirmedSuspiciousGroupIdentity:
      attestation.suspiciousGroupCount === 0
        ? null
        : attestation.suspiciousGroupIdentity,
  });
  importEvidenceRuntimes.set(evidence, {
    preflight,
    confirmation,
  });
  return evidence;
}

export function inspectLedgerBackupImportEvidence(
  evidence: LedgerBackupImportEvidence,
): BackupImportPreflightAttestation | null {
  const evidenceRuntime = importEvidenceRuntimes.get(evidence);
  if (!evidenceRuntime) {
    return null;
  }
  const preflightRuntime =
    preflightReceiptRuntimes.get(evidenceRuntime.preflight);
  if (
    !preflightRuntime?.active ||
    !isBackupImportSuspicionConfirmationValid(
      evidenceRuntime.preflight,
      evidenceRuntime.confirmation,
    )
  ) {
    return null;
  }

  const { attestation } = preflightRuntime;
  if (
    evidence.contentIdentity !== attestation.contentIdentity ||
    evidence.candidateIdentity !== attestation.candidateIdentity ||
    evidence.selectionGeneration !==
      attestation.selectionGeneration ||
    evidence.hardErrorCount !== attestation.hardErrorCount ||
    evidence.suspiciousGroupCount !==
      attestation.suspiciousGroupCount ||
    evidence.suspiciousGroupIdentity !==
      attestation.suspiciousGroupIdentity ||
    evidence.confirmedSuspiciousGroupIdentity !==
      (attestation.suspiciousGroupCount === 0
        ? null
        : attestation.suspiciousGroupIdentity)
  ) {
    return null;
  }
  return attestation;
}

export function revokeBackupImportPreflightReceipt(
  preflight: BackupImportPreflightResult,
): void {
  const runtime = preflightReceiptRuntimes.get(preflight);
  if (runtime) {
    runtime.active = false;
  }
}

function normalizeEnvelopeError(
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
    return `导入业务规则未通过：${error.message}`;
  }
  if (error.code.startsWith("LEDGER_DATA_")) {
    return `账本字段未通过结构校验：${error.message}`;
  }

  const labels: Partial<Record<BackupEnvelopeError["code"], string>> = {
    BACKUP_BAD_JSON: "备份不是有效 JSON。",
    BACKUP_INVALID_ENVELOPE: "备份外层结构无效。",
    BACKUP_UNSUPPORTED_FORMAT_VERSION: "备份格式版本不受支持。",
    BACKUP_INVALID_APP_VERSION: "备份应用版本缺失或无效。",
    BACKUP_INVALID_EXPORTED_AT: "备份导出时间无效。",
    BACKUP_SCHEMA_VERSION_MISMATCH: "备份账本 schema 版本不匹配。",
  };
  return labels[error.code] ?? `备份校验失败：${error.message}`;
}

function collectHistoricalRawTextErrors(
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
        "历史导入要求保留对应原句；rawText 必须是非空字符串，且不会被 trim、摘要或重写。",
      summary: createTradeSummary(parsed, index),
    });
  });
  return errors;
}

function collectDuplicateTradeIdErrors(
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
      message: `交易 ID 重复；首次出现在 trades[${firstIndex}].id。`,
      summary: createTradeSummary(parsed, index),
    });
  });
  return errors;
}

function collectDuplicateTradeIdIndexes(parsed: unknown): ReadonlySet<number> {
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

function collectMetadata(parsed: unknown): BackupPreflightMetadata | undefined {
  if (!isRecord(parsed)) {
    return undefined;
  }

  const ledgerData = getLedgerDataInput(parsed);
  const metadata: BackupPreflightMetadata = {
    ...(typeof parsed.appVersion === "string"
      ? { appVersion: parsed.appVersion }
      : {}),
    ...(typeof parsed.exportedAt === "string"
      ? { exportedAt: parsed.exportedAt }
      : {}),
    ...(isRecord(ledgerData) && Array.isArray(ledgerData.assets)
      ? { assetCount: ledgerData.assets.length }
      : {}),
    ...(isRecord(ledgerData) && Array.isArray(ledgerData.trades)
      ? { tradeCount: ledgerData.trades.length }
      : {}),
    ...(isRecord(ledgerData) && Array.isArray(ledgerData.priceSnapshots)
      ? { priceSnapshotCount: ledgerData.priceSnapshots.length }
      : {}),
    ...(isRecord(ledgerData) && Array.isArray(ledgerData.feeRules)
      ? { feeRuleCount: ledgerData.feeRules.length }
      : {}),
  };
  return metadata;
}

function createTradeSummary(
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

function getLedgerDataInput(parsed: unknown): unknown {
  return isRecord(parsed) ? parsed.ledgerData : undefined;
}

function hasTradeCollection(ledgerInput: unknown): boolean {
  return isRecord(ledgerInput) && Array.isArray(ledgerInput.trades);
}

function getTradeIndex(path: string): number | undefined {
  const match = /^trades\[(\d+)\]/.exec(path);
  return match ? Number(match[1]) : undefined;
}

function deduplicateHardErrors(
  errors: readonly BackupPreflightHardError[],
): BackupPreflightHardError[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = [
      error.stage,
      error.code,
      error.path,
      error.message,
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

function compareHardErrors(
  left: BackupPreflightHardError,
  right: BackupPreflightHardError,
): number {
  return (
    left.stage - right.stage ||
    left.path.localeCompare(right.path, "en", { numeric: true }) ||
    left.code.localeCompare(right.code)
  );
}

function extractJsonErrorLocation(
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

async function digestSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function skipped(
  check: BackupPreflightSkippedCheck["check"],
  reason: string,
): BackupPreflightSkippedCheck {
  return { check, reason };
}

function deepFreeze<T>(value: T): T {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Compile-time guard: preflight deliberately keeps the existing B envelope.
const _backupEnvelopeV2Contract: BackupEnvelopeV2["backupFormatVersion"] = 2;
void _backupEnvelopeV2Contract;
