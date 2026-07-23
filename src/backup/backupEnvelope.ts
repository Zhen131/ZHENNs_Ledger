import type { LedgerData } from "../models";
import {
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
  isValidISODateOrDateTime,
  validateLedgerData,
} from "../validators";

export const BACKUP_FORMAT_VERSION = 1;

export type BackupEnvelopeV1 = {
  backupFormatVersion: 1;
  appVersion: string;
  exportedAt: string;
  ledgerSchemaVersion: 1;
  ledgerData: LedgerData;
};

export type BackupEnvelopeError = {
  code: string;
  path: string;
  message: string;
};

export type BackupEnvelopeResult =
  | { ok: true; value: BackupEnvelopeV1 }
  | { ok: false; errors: BackupEnvelopeError[] };

export type BackupMetadata = {
  appVersion: string;
  exportedAt: string;
};

export function createBackupEnvelope(
  ledgerData: unknown,
  metadata: BackupMetadata,
): BackupEnvelopeResult {
  const metadataErrors = validateMetadata(metadata);
  const ledgerResult = validateLedgerData(ledgerData);

  if (!ledgerResult.ok || metadataErrors.length > 0) {
    return {
      ok: false,
      errors: [
        ...metadataErrors,
        ...(!ledgerResult.ok ? ledgerResult.errors : []),
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

export function serializeBackupEnvelope(envelope: BackupEnvelopeV1): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export function parseBackupJson(serializedBackup: string): BackupEnvelopeResult {
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
        createError("BACKUP_JSON_INVALID", "file", "Backup must be valid JSON"),
      ],
    };
  }

  return validateBackupEnvelope(parsed);
}

export function validateBackupEnvelope(input: unknown): BackupEnvelopeResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [createError("BACKUP_INVALID_ROOT", "backup", "Backup must be an object")],
    };
  }

  const errors: BackupEnvelopeError[] = [];
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

  if (input.ledgerSchemaVersion !== 1) {
    errors.push(
      createError(
        "BACKUP_UNSUPPORTED_LEDGER_SCHEMA",
        "ledgerSchemaVersion",
        `Unsupported ledger schema version: ${String(input.ledgerSchemaVersion)}`,
      ),
    );
  }

  const ledgerResult = validateLedgerData(input.ledgerData);
  if (!ledgerResult.ok) {
    errors.push(...ledgerResult.errors);
  } else {
    if (input.ledgerSchemaVersion !== ledgerResult.value.schemaVersion) {
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
      ledgerSchemaVersion: 1,
      ledgerData: ledgerResult.value,
    },
  };
}

function validateMetadata(metadata: {
  appVersion: unknown;
  exportedAt: unknown;
}): BackupEnvelopeError[] {
  const errors: BackupEnvelopeError[] = [];
  if (typeof metadata.appVersion !== "string" || metadata.appVersion.trim() === "") {
    errors.push(
      createError("BACKUP_INVALID_APP_VERSION", "appVersion", "appVersion must be non-empty"),
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

function createError(code: string, path: string, message: string): BackupEnvelopeError {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
