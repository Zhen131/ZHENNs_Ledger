export function createBackupFilename(exportedAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(
    exportedAt,
  );

  if (!match) {
    throw new Error("Backup filename requires a UTC ISO datetime");
  }

  const [, year, month, day, hour, minute, second] = match;
  return `local-first-trading-ledger-backup-v1-${year}${month}${day}-${hour}${minute}${second}Z.json`;
}

export type BackupDownloadFailureCode =
  | "BACKUP_DOWNLOAD_FILENAME_FAILED"
  | "BACKUP_DOWNLOAD_BLOB_FAILED"
  | "BACKUP_DOWNLOAD_OBJECT_URL_FAILED"
  | "BACKUP_DOWNLOAD_CLICK_FAILED"
  | "BACKUP_DOWNLOAD_REVOKE_FAILED";

export type BackupDownloadResult =
  | {
      ok: true;
      filename: string;
    }
  | {
      ok: false;
      code: BackupDownloadFailureCode;
    };

export function downloadBackupJson(
  serializedBackup: string,
  exportedAt: string,
): BackupDownloadResult {
  let filename: string;
  try {
    filename = createBackupFilename(exportedAt);
  } catch {
    return {
      ok: false,
      code: "BACKUP_DOWNLOAD_FILENAME_FAILED",
    };
  }

  let blob: Blob;
  try {
    blob = new Blob([serializedBackup], {
      type: "application/json;charset=utf-8",
    });
  } catch {
    return {
      ok: false,
      code: "BACKUP_DOWNLOAD_BLOB_FAILED",
    };
  }

  let objectUrl: string;
  try {
    objectUrl = URL.createObjectURL(blob);
  } catch {
    return {
      ok: false,
      code: "BACKUP_DOWNLOAD_OBJECT_URL_FAILED",
    };
  }

  let clickFailed = false;
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
  } catch {
    clickFailed = true;
  }

  try {
    URL.revokeObjectURL(objectUrl);
  } catch {
    return {
      ok: false,
      code: "BACKUP_DOWNLOAD_REVOKE_FAILED",
    };
  }

  if (clickFailed) {
    return {
      ok: false,
      code: "BACKUP_DOWNLOAD_CLICK_FAILED",
    };
  }

  return {
    ok: true,
    filename,
  };
}
