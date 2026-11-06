/**
 * 这个文件管 B 文件（明文备份）的外壳。
 * 怎么包、怎么拆、怎么检查都在这里。
 * 账本里面每一笔记录怎么检查，交给 core 的 `validateLedgerData`。
 * 不显然的决定：旧版本的 B 文件一律拒绝，不做升级；2026-08-27 定（W15 000 第三节）。
 */
import type { LedgerData } from "@/core/models";
import {
  validateLedgerImportPolicy,
  type LedgerImportPolicyError,
} from "@/core/policies";
import {
  captureLedgerTime,
  systemLedgerClock,
} from "@/core/shared";
import {
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
  isValidISODateOrDateTime,
  type LedgerDataValidationError,
  type LedgerResourcePolicyError,
  selectLedgerDataFacts,
  validateLedgerData,
} from "@/core/validation";
import { translateDefault } from "@/ui";

/**
 * B 文件外壳的版本号，现在是 3。
 * 为什么是 3：账本升到第三版时换了新外壳；2026-08-19 定（W14 01A 第四节）。
 * 它和账本结构版本各管各的，只在外壳变时才升。
 * 这条 2026-08-27 定（W15 000 第一节）。
 */
export const BACKUP_FORMAT_VERSION = 3 as const;

/**
 * 第 3 版 B 文件的样子：五个顶层键，顺序固定。
 * 外壳版本、程序版本、导出时刻。
 * 账本结构版本、账本本身。
 * 账本结构版本现在只认 5。
 */
export type BackupEnvelopeV3 = {
  backupFormatVersion: 3;
  appVersion: string;
  exportedAt: string;
  ledgerSchemaVersion: 5;
  ledgerData: LedgerData;
};

/**
 * 外壳本身出错时的一条错误：代码、出错的位置、说明。
 * 比如不是 JSON、版本号不认识、导出时刻写错。
 */
export type BackupEnvelopeContractError = {
  code:
    | "BACKUP_BAD_JSON"
    | "BACKUP_INVALID_ENVELOPE"
    | "BACKUP_UNSUPPORTED_FORMAT_VERSION"
    | "BACKUP_INVALID_APP_VERSION"
    | "BACKUP_INVALID_EXPORTED_AT"
    | "BACKUP_SCHEMA_VERSION_MISMATCH";
  path: string;
  message: string;
};

/**
 * 检查 B 文件时可能碰到的所有错误，有四种来源。
 * 外壳、账本结构、大小上限、导入规矩。
 */
export type BackupEnvelopeError =
  | BackupEnvelopeContractError
  | LedgerDataValidationError
  | LedgerResourcePolicyError
  | LedgerImportPolicyError;

type BackupEnvelopeResult =
  | { ok: true; value: BackupEnvelopeV3 }
  | { ok: false; errors: BackupEnvelopeError[] };

type BackupMetadata = {
  appVersion: string;
  exportedAt: string;
};

/**
 * 这个函数回答：把当前账本包成一个 B 文件外壳，行不行？
 * 先检查账本合规矩、不超上限、没有今天以后的记录，再包。
 * 举例：一本合规的账本，程序版本 0.1.0。
 * → 答一个外壳版本 3、结构版本 5 的 B。
 * 什么时候出错：不抛错，返回 `ok:false` 和全部错误。
 */
export function createBackupEnvelope(
  ledgerData: unknown,
  metadata: BackupMetadata,
  todayKey: string = captureLedgerTime(systemLedgerClock).todayKey,
): BackupEnvelopeResult {
  const metadataErrors = validateMetadata(metadata);
  const ledgerResult = validateLedgerData(selectLedgerDataFacts(ledgerData));

  if (!ledgerResult.ok || metadataErrors.length > 0) {
    return {
      ok: false,
      errors: [
        ...metadataErrors,
        ...(!ledgerResult.ok ? ledgerResult.errors : []),
      ],
    };
  }

  const resourcePolicy = evaluateLedgerResourcePolicy(ledgerResult.value);
  const importPolicy = validateLedgerImportPolicy(
    ledgerResult.value,
    todayKey,
  );
  if (!resourcePolicy.ok || !importPolicy.ok) {
    return {
      ok: false,
      errors: [
        ...(!resourcePolicy.ok ? resourcePolicy.errors : []),
        ...(!importPolicy.ok ? importPolicy.errors : []),
      ],
    };
  }

  return {
    ok: true,
    value: {
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      appVersion: metadata.appVersion,
      exportedAt: metadata.exportedAt,
      ledgerSchemaVersion: ledgerResult.value.schemaVersion,
      ledgerData: ledgerResult.value,
    },
  };
}

/**
 * 这个函数把 B 文件外壳变成文字，缩进两格，末尾带一个换行。
 * 举例：外壳版本 3、程序版本 0.1.0 的 B。
 * → 答一段 JSON 文字，每层缩进两格，最后一个字是换行。
 * 不会出错。
 */
export function serializeBackupEnvelope(envelope: BackupEnvelopeV3): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/**
 * 这个函数回答：一段文字能不能读成一个合格的 B 文件？
 * 先看大小，再读 JSON，最后交给 `validateBackupEnvelope` 检查。
 * 举例：文字超过大小上限 → 答不行，不再往下读。
 * 什么时候出错：不抛错，返回 `ok:false` 和错误清单。
 */
export function parseBackupJson(
  serializedBackup: string,
  todayKey: string = captureLedgerTime(systemLedgerClock).todayKey,
): BackupEnvelopeResult {
  const bytePolicy = evaluateLedgerJsonResourcePolicy(serializedBackup);
  if (!bytePolicy.ok) {
    return { ok: false, errors: bytePolicy.errors };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedBackup);
  } catch {
    return {
      ok: false,
      errors: [
        createError("BACKUP_BAD_JSON", "file", "Backup must be valid JSON"),
      ],
    };
  }

  return validateBackupEnvelope(parsed, todayKey);
}

/**
 * 这个函数回答：读进来的是不是合格的第 3 版 B 文件？
 * 外壳版本低于 3、或结构版本低于 5：直接拒绝。
 * 说明里写明不提供升级。
 * 否则外壳、账本、上限、导入规矩全查一遍。
 * 错误一次报齐。
 * 举例：外壳版本 2 → 答不行，只报这一条，不往下查。
 * 为什么旧版本直接拒绝：现在是 Alpha，不做升级；2026-08-27 定（W15 000 第三节）。
 * 什么时候出错：不抛错，返回 `ok:false`。
 */
export function validateBackupEnvelope(
  input: unknown,
  todayKey: string = captureLedgerTime(systemLedgerClock).todayKey,
): BackupEnvelopeResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        createError("BACKUP_INVALID_ENVELOPE", "backup", "Backup must be an object"),
      ],
    };
  }

  if (
    typeof input.backupFormatVersion === "number" &&
    input.backupFormatVersion < BACKUP_FORMAT_VERSION
  ) {
    return {
      ok: false,
      errors: [
        createError(
          "BACKUP_UNSUPPORTED_FORMAT_VERSION",
          "backupFormatVersion",
          translateDefault("backup.envelope.formatVersionPrefix") +
            input.backupFormatVersion +
            translateDefault("backup.envelope.formatVersionSuffix"),
        ),
      ],
    };
  }

  if (
    input.backupFormatVersion === BACKUP_FORMAT_VERSION &&
    typeof input.ledgerSchemaVersion === "number" &&
    input.ledgerSchemaVersion < 5
  ) {
    return {
      ok: false,
      errors: [
        createError(
          "BACKUP_SCHEMA_VERSION_MISMATCH",
          "ledgerSchemaVersion",
          translateDefault("backup.envelope.schemaVersionPrefix") +
            input.ledgerSchemaVersion +
            translateDefault("backup.envelope.schemaVersionMiddleV5"),
        ),
      ],
    };
  }

  const errors: BackupEnvelopeError[] = [];
  const expectedKeys = [
    "backupFormatVersion",
    "appVersion",
    "exportedAt",
    "ledgerSchemaVersion",
    "ledgerData",
  ];
  if (!hasExactKeys(input, expectedKeys)) {
    errors.push(
      createError(
        "BACKUP_INVALID_ENVELOPE",
        "backup",
        "Backup format V3 must contain exactly the five canonical top-level keys in order",
      ),
    );
  }
  if (input.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
    errors.push(
      createError(
        "BACKUP_UNSUPPORTED_FORMAT_VERSION",
        "backupFormatVersion",
        `Unsupported backup format version: ${String(input.backupFormatVersion)}`,
      ),
    );
  }

  const metadataErrors = validateMetadata({
    appVersion: input.appVersion,
    exportedAt: input.exportedAt,
  });
  errors.push(...metadataErrors);

  const hasSupportedLedgerSchemaVersion = input.ledgerSchemaVersion === 5;
  if (!hasSupportedLedgerSchemaVersion) {
    errors.push(
      createError(
        "BACKUP_SCHEMA_VERSION_MISMATCH",
        "ledgerSchemaVersion",
        `Unsupported ledger schema version: ${String(input.ledgerSchemaVersion)}`,
      ),
    );
  }

  const ledgerResult = validateLedgerData(input.ledgerData);
  if (!ledgerResult.ok) {
    errors.push(...ledgerResult.errors);
  } else {
    if (
      hasSupportedLedgerSchemaVersion &&
      input.ledgerSchemaVersion !== ledgerResult.value.schemaVersion
    ) {
      errors.push(
        createError(
          "BACKUP_SCHEMA_VERSION_MISMATCH",
          "ledgerSchemaVersion",
          "Ledger schema version does not match ledgerData.schemaVersion",
        ),
      );
    }

    const resourcePolicy = evaluateLedgerResourcePolicy(ledgerResult.value);
    if (!resourcePolicy.ok) {
      errors.push(...resourcePolicy.errors);
    }

    const importPolicy = validateLedgerImportPolicy(
      ledgerResult.value,
      todayKey,
    );
    if (!importPolicy.ok) {
      errors.push(...importPolicy.errors);
    }
  }

  if (errors.length > 0 || !ledgerResult.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      appVersion: input.appVersion as string,
      exportedAt: input.exportedAt as string,
      ledgerSchemaVersion: 5,
      ledgerData: ledgerResult.value,
    },
  };
}

function validateMetadata(metadata: {
  appVersion: unknown;
  exportedAt: unknown;
}): BackupEnvelopeError[] {
  const errors: BackupEnvelopeError[] = [];
  if (
    typeof metadata.appVersion !== "string" ||
    metadata.appVersion.length === 0 ||
    metadata.appVersion.trim() !== metadata.appVersion ||
    metadata.appVersion.length > 128
  ) {
    errors.push(
      createError(
        "BACKUP_INVALID_APP_VERSION",
        "appVersion",
        "appVersion must be non-empty, have no surrounding whitespace, and be at most 128 characters",
      ),
    );
  }
  if (
    typeof metadata.exportedAt !== "string" ||
    !metadata.exportedAt.includes("T") ||
    !isValidISODateOrDateTime(metadata.exportedAt)
  ) {
    errors.push(
      createError(
        "BACKUP_INVALID_EXPORTED_AT",
        "exportedAt",
        "exportedAt must be an ISO datetime with timezone",
      ),
    );
  }
  return errors;
}

function createError(
  code: BackupEnvelopeContractError["code"],
  path: string,
  message: string,
): BackupEnvelopeContractError {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}
