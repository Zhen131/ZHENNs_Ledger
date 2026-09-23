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

export const BACKUP_PREFLIGHT_PAGE_DETAIL_LIMIT = 50;
export const BACKUP_PREFLIGHT_REPORT_DETAIL_LIMIT = 1000;

export type BackupImportPreflightOptions = Readonly<{
  todayKey: string;
  selectionGeneration: number;
  sourceFileName?: string;
  /**
   * Only the explicit historical-ingest path requires every trade to preserve
   * a source line. Normal ledger schema V4 backup restore keeps Trade.rawText optional.
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

// Compile-time guard: preflight consumes backup format V3 carrying ledger schema V4.
const _backupEnvelopeV3Contract: BackupEnvelopeV3["backupFormatVersion"] = 3;
void _backupEnvelopeV3Contract;
