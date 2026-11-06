/**
 * 这个文件管导入 B 文件前的预检。
 * 一次查完，把能发现的问题全列出来。
 * 它不写账本、不碰 C 文件；真正写入在 app 的导入流程里。
 * 不显然的决定：预检绝对不写 C，问题一次报齐；2026-07-31 定（W11 03A 第 4.1、4.3 节）。
 */
import type { LedgerData } from "@/core/models";
import { validateLedgerImportPolicy } from "@/core/policies";
import {
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "@/core/validation";
import { translateDefault } from "@/ui";
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
  type BackupEnvelopeV3,
} from "./backupEnvelope";
import { createLedgerDataContentIdentity } from "@/platform/persistence/identity";
import {
  normalizeEnvelopeError,
  collectHistoricalRawTextErrors,
  collectDuplicateTradeIdErrors,
  collectDuplicateTradeIdIndexes,
  collectMetadata,
  collectTopLevelMetadata,
  collectWarnings,
  createTradeSummary,
  getLedgerDataInput,
  hasTradeCollection,
  getTradeIndex,
  deduplicateHardErrors,
  compareHardErrors,
  extractJsonErrorLocation,
  digestSha256Hex,
  skipped,
  deepFreeze,
  isRecord,
} from "./backupImportPreflightCollectors";
import type {
  BackupContentIdentity,
  BackupPreflightHardError,
  BackupPreflightSkippedCheck,
  BackupPreflightMetadata,
  BackupPreflightWarning,
} from "./backupImportPreflightTypes";
import { preflightReceiptRuntimes } from "./backupImportPreflightReceipts";
import type {
  BackupPreflightDetail,
  BackupImportPreflightResult,
} from "./backupImportPreflightResult";

/**
 * 页面上最多显示的详情条数，50。
 * 为什么是 50：2026-07-31 定（W11 03A 第 4.4 节）。
 */
export const BACKUP_PREFLIGHT_PAGE_DETAIL_LIMIT = 50;
/**
 * 留在内存、写进复制报告的详情条数上限，1000。
 * 为什么是 1000：2026-07-31 定（W11 03A 第 4.4 节）。
 * 页面那 50 条不会挤掉报告里第 51～1000 条。
 */
export const BACKUP_PREFLIGHT_REPORT_DETAIL_LIMIT = 1000;

type BackupImportPreflightOptions = Readonly<{
  todayKey: string;
  selectionGeneration: number;
  sourceFileName?: string;
  /**
   * 只有明确走「历史导入」时，才要求每笔交易都带原句。
   * 平常恢复备份，原句可有可无。
   * 这条 2026-07-31 定（W11 03A 第 4.3 节第 5 条）。
   */
  requireHistoricalRawText?: boolean;
}>;

/**
 * 这个函数回答：这个 B 文件能不能导入？有哪些问题？
 * 顺序固定：看大小、读 JSON、查外壳、查账本。
 * 再查原句、查上限、查导入规矩、找重复。
 * 前一步做不了时，后面的检查记成「没做」，不算通过。
 * 举例：BTC 一笔数量写错、ETH 两笔疑似重复。
 * → 答一条硬错误、一组疑似重复，不给可导入的账本。
 * 零硬错误时，结果里带一份冻住的账本。
 * 同时记下底账，供后面核对。
 * 为什么问题要一次报齐：免得改一处查一次；2026-07-31 定（W11 03A 第 4.3 节）。
 * 不会抛错，问题都写在结果里。
 */
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
      skipped("json-parse", translateDefault("backup.preflight.fileTooLarge")),
      skipped("backup-envelope", translateDefault("backup.preflight.jsonNotParsed")),
      skipped("ledger-structure", translateDefault("backup.preflight.jsonNotParsed")),
      skipped("resource-policy", translateDefault("backup.preflight.jsonNotParsed")),
      skipped("import-policy", translateDefault("backup.preflight.jsonNotParsed")),
      skipped("duplicate-grouping", translateDefault("backup.preflight.jsonNotParsed")),
    );
    return finalizeResult({
      contentIdentity,
      selectionGeneration: options.selectionGeneration,
      requireHistoricalRawText:
        options.requireHistoricalRawText ?? false,
      hardErrors: bytePolicy.errors.map((error) =>
        normalizeEnvelopeError(error, undefined),
      ),
      suspiciousGroups: [],
      skippedChecks,
      warnings: [],
      metadata: collectMetadata(undefined, options.sourceFileName),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedBackup);
  } catch (error) {
    const location = extractJsonErrorLocation(error, serializedBackup);
    skippedChecks.push(
      skipped("backup-envelope", translateDefault("backup.preflight.jsonSyntaxError")),
      skipped("ledger-structure", translateDefault("backup.preflight.jsonSyntaxError")),
      skipped("resource-policy", translateDefault("backup.preflight.jsonSyntaxError")),
      skipped("import-policy", translateDefault("backup.preflight.jsonSyntaxError")),
      skipped("duplicate-grouping", translateDefault("backup.preflight.jsonSyntaxError")),
    );
    return finalizeResult({
      contentIdentity,
      selectionGeneration: options.selectionGeneration,
      requireHistoricalRawText:
        options.requireHistoricalRawText ?? false,
      hardErrors: [
        {
          kind: "hard-error",
          stage: 2,
          code: "BACKUP_BAD_JSON",
          path: "file",
          message:
            location.line === undefined
              ? translateDefault("backup.preflight.jsonLocationUnavailable")
              : translateDefault("backup.preflight.jsonLocationPrefix") +
                location.line +
                translateDefault("backup.preflight.jsonLocationMiddle") +
                location.column +
                translateDefault("backup.preflight.jsonLocationSuffix"),
          ...location,
        },
      ],
      suspiciousGroups: [],
      skippedChecks,
      warnings: [],
      metadata: collectMetadata(undefined, options.sourceFileName),
    });
  }

  const retiredBackupBoundary =
    isRecord(parsed) &&
    typeof parsed.backupFormatVersion === "number" &&
    parsed.backupFormatVersion < 3
      ? translateDefault("backup.preflight.formatVersionPrefix") +
        parsed.backupFormatVersion
      : isRecord(parsed) &&
          parsed.backupFormatVersion === 3 &&
          typeof parsed.ledgerSchemaVersion === "number" &&
          parsed.ledgerSchemaVersion < 5
        ? translateDefault("backup.preflight.schemaVersionPrefix") +
          parsed.ledgerSchemaVersion
        : null;
  if (retiredBackupBoundary !== null && isRecord(parsed)) {
    const versionResult = validateBackupEnvelope(parsed, options.todayKey);
    const versionErrors = versionResult.ok
      ? []
      : versionResult.errors.map((error) =>
          normalizeEnvelopeError(error, undefined),
        );
    skippedChecks.push(
      skipped("ledger-structure", retiredBackupBoundary + translateDefault("backup.preflight.versionStageStoppedSuffix")),
      skipped("resource-policy", retiredBackupBoundary + translateDefault("backup.preflight.versionStageStoppedSuffix")),
      skipped("import-policy", retiredBackupBoundary + translateDefault("backup.preflight.versionStageStoppedSuffix")),
      skipped("duplicate-grouping", retiredBackupBoundary + translateDefault("backup.preflight.versionStageStoppedSuffix")),
    );
    return finalizeResult({
      contentIdentity,
      selectionGeneration: options.selectionGeneration,
      requireHistoricalRawText: false,
      hardErrors: versionErrors,
      suspiciousGroups: [],
      warnings: [],
      skippedChecks,
      metadata: collectTopLevelMetadata(parsed, options.sourceFileName),
    });
  }

  const envelopeResult = validateBackupEnvelope(parsed, options.todayKey);
  const ledgerInput = getLedgerDataInput(parsed);
  const ledgerResult = validateLedgerData(ledgerInput);
  const summaryLedger = ledgerResult.ok ? ledgerResult.value : undefined;
  const metadata = collectMetadata(
    parsed,
    options.sourceFileName,
    summaryLedger,
  );
  const warnings = collectWarnings(summaryLedger);
  const hardErrors: BackupPreflightHardError[] = !envelopeResult.ok
    ? envelopeResult.errors.map((error) =>
        normalizeEnvelopeError(error, parsed),
      )
    : [];

  const rawTextInvalidIndexes = new Set<number>();
  if (options.requireHistoricalRawText ?? false) {
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
        translateDefault("backup.preflight.ledgerStructureIncomplete"),
      ),
      skipped(
        "import-policy",
        translateDefault("backup.preflight.importStructureIncomplete"),
      ),
    );
  } else {
    // 这两层在查外壳时已经跑过一次。
    // 这里故意再明着调用，让预检看得出每一层都跑过。
    // 为什么这样写：2026-07-31 提交 fd680c5 写的，日志里没写。
    // 这是猜的，要核。
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
        translateDefault("backup.preflight.tradesUnreadable"),
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
      options.requireHistoricalRawText ?? false,
    hardErrors: deduplicatedErrors,
    suspiciousGroups,
    skippedChecks,
    warnings,
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
  warnings: readonly BackupPreflightWarning[];
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
      translateDefault("backup.preflight.suspiciousNoMutation"),
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
    warningCount: input.warnings.length,
    warnings: [...input.warnings],
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

// 编译时的检查：预检只认第 3 版 B 文件外壳。
// 外壳版本号一改，这里会编译报错，提醒来改预检。
const _backupEnvelopeV3Contract: BackupEnvelopeV3["backupFormatVersion"] = 3;
void _backupEnvelopeV3Contract;
