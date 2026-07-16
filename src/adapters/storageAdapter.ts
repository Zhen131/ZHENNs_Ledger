export type StoredLedgerEnvelope = {
  formatVersion: 1;
  encryptedPayload: string;
};

/**
 * StorageAdapter 只负责外部存储，不理解 LedgerData 或加密内容。
 *
 * 空库必须返回 null，不能伪装成已经保存过的空账本。
 */
export interface StorageAdapter {
  read(): Promise<StoredLedgerEnvelope | null>;
  write(envelope: StoredLedgerEnvelope): Promise<void>;
  clear(): Promise<void>;
}
