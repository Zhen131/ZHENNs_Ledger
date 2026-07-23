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

export function downloadBackupJson(serializedBackup: string, exportedAt: string) {
  const objectUrl = URL.createObjectURL(
    new Blob([serializedBackup], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = createBackupFilename(exportedAt);
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
