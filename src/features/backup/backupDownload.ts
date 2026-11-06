/**
 * 这个文件管一件事：把 B 文件的文字交给浏览器下载。
 * B 文件的内容在 `backupEnvelope.ts` 里包好。
 * 不显然的决定：只说「已发起下载」，不说「已保存」；2026-07-31 定（W11 03A 第 4.7 节）。
 */
/**
 * 这个函数回答：这次导出的 B 文件叫什么名字？
 * 举例：导出时刻 2026-07-31T08:05:09Z。
 * → 答 local-first-trading-ledger-backup-v3-20260731-080509Z.json。
 * 什么时候出错：时刻不是 UTC 的写法（末尾不是 Z），直接抛错。
 */
export function createBackupFilename(exportedAt: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(
    exportedAt,
  );

  if (!match) {
    throw new Error("Backup filename requires a UTC ISO datetime");
  }

  const [, year, month, day, hour, minute, second] = match;
  return `local-first-trading-ledger-backup-v3-${year}${month}${day}-${hour}${minute}${second}Z.json`;
}

type BackupDownloadFailureCode =
  | "BACKUP_DOWNLOAD_FILENAME_FAILED"
  | "BACKUP_DOWNLOAD_BLOB_FAILED"
  | "BACKUP_DOWNLOAD_OBJECT_URL_FAILED"
  | "BACKUP_DOWNLOAD_CLICK_FAILED"
  | "BACKUP_DOWNLOAD_REVOKE_FAILED";

type BackupDownloadResult =
  | {
      ok: true;
      filename: string;
    }
  | {
      ok: false;
      code: BackupDownloadFailureCode;
    };

/**
 * 这个函数把 B 文件的文字交给浏览器下载。
 * 做法是造一个临时链接，点一下，再收回链接。
 * 成功返回文件名。
 * 任何一步出错都返回 `ok:false` 和是哪一步，不抛错。
 * 它不保证文件真的落到了硬盘上。
 */
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
