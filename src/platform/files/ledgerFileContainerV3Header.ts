/**
 * 这个文件管 S-1 格式文件头的形状，和按固定顺序把它拼出来。
 * 它不管把文件头变成字节，那在 ledgerFileContainerV3Serialize.ts。
 * 没有特别的决定。
 */

import type {
  LedgerFileV3S1,
  EncryptedLedgerGenerationV3S1,
} from "./ledgerFileContainerV3";

/**
 * S-1 文件头里的一代。
 * 包括编号、上一代编号、结构版本、随机数、密文长度。
 */
export type LedgerFileGenerationHeaderV3S1 = Omit<
  EncryptedLedgerGenerationV3S1,
  "ciphertextBytes"
> & {
  ciphertextByteLength: number;
};

/**
 * S-1 文件头。
 * 有四个版本号、编号、加密参数。
 * 还有这一代和上一代的说明。
 */
export type LedgerFileHeaderV3S1 = Omit<
  LedgerFileV3S1,
  "current" | "previous"
> & {
  current: LedgerFileGenerationHeaderV3S1;
  previous: LedgerFileGenerationHeaderV3S1 | null;
};

/**
 * 这个函数按固定字段顺序拼出 S-1 文件头。
 * 举例：这一代密文 100 字节、没有上一代 → 答 previous 是 null 的文件头。
 * 不会出错。
 */
export function orderedHeader(
  file: LedgerFileV3S1,
  currentCiphertextByteLength: number,
  previousCiphertextByteLength: number | null,
): LedgerFileHeaderV3S1 {
  return {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
    fileId: file.fileId,
    crypto: {
      cryptoVersion: file.crypto.cryptoVersion,
      kdf: {
        name: file.crypto.kdf.name,
        hash: file.crypto.kdf.hash,
        iterations: file.crypto.kdf.iterations,
        saltBase64Url: file.crypto.kdf.saltBase64Url,
      },
      cipher: {
        name: file.crypto.cipher.name,
        keyLength: file.crypto.cipher.keyLength,
        tagLength: file.crypto.cipher.tagLength,
      },
    },
    current: orderedGenerationHeader(
      file.current,
      currentCiphertextByteLength,
    ),
    previous:
      file.previous && previousCiphertextByteLength !== null
        ? orderedGenerationHeader(
            file.previous,
            previousCiphertextByteLength,
          )
        : null,
  };
}

function orderedGenerationHeader(
  generation: EncryptedLedgerGenerationV3S1,
  ciphertextByteLength: number,
): LedgerFileGenerationHeaderV3S1 {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: generation.ledgerSchemaVersion,
    ivBase64Url: generation.ivBase64Url,
    ciphertextByteLength,
  };
}
