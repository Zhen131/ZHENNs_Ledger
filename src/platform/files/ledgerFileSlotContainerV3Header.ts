/**
 * 这个文件管 S-2 格式文件头的形状，和按固定顺序把它拼出来。
 * 它不管把文件头写进槽里，那在 ledgerFileSlotContainerV3Serialize.ts。
 * 没有特别的决定。
 */

import { type LedgerFileCryptoV2 } from "./ledgerFileContract";
import type {
  EncryptedLedgerGenerationV3S2,
  LedgerFileV3S2,
} from "./ledgerFileSlotContainerV3";

/**
 * S-2 文件头里的一代。
 * 有编号、上一代编号、结构版本、内容槽。
 * 还有随机数和密文长度。
 */
export type LedgerFileGenerationHeaderV3S2 = Omit<
  EncryptedLedgerGenerationV3S2,
  "ciphertextBytes"
> & {
  ciphertextByteLength: number;
};

/**
 * S-2 文件头。
 * 有版本号、编号、写到第几次、槽的大小。
 * 还有加密参数和两代的说明。
 */
export type LedgerFileHeaderV3S2 = Omit<
  LedgerFileV3S2,
  "activeHeaderSlot" | "current" | "previous"
> & {
  current: LedgerFileGenerationHeaderV3S2;
  previous: LedgerFileGenerationHeaderV3S2 | null;
};

/**
 * 这个函数按固定字段顺序拼出 S-2 文件头。
 * 举例：同一份文件 → 每次拼出的字段顺序都一样。
 * 不会出错。
 */
export function orderedHeader(file: LedgerFileV3S2): LedgerFileHeaderV3S2 {
  return {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
    fileId: file.fileId,
    sequence: file.sequence,
    crypto: orderedCrypto(file.crypto),
    bodySlotBytes: file.bodySlotBytes,
    bodySlotCount: file.bodySlotCount,
    current: orderedGenerationHeader(file.current),
    previous: file.previous ? orderedGenerationHeader(file.previous) : null,
  };
}

/**
 * 这个函数按固定字段顺序重新拼一份加密参数。
 * 举例：字段顺序乱的参数 → 答顺序固定的一份，值不变。
 */
export function orderedCrypto(crypto: LedgerFileCryptoV2): LedgerFileCryptoV2 {
  return {
    cryptoVersion: crypto.cryptoVersion,
    kdf: {
      name: crypto.kdf.name,
      hash: crypto.kdf.hash,
      iterations: crypto.kdf.iterations,
      saltBase64Url: crypto.kdf.saltBase64Url,
    },
    cipher: {
      name: crypto.cipher.name,
      keyLength: crypto.cipher.keyLength,
      tagLength: crypto.cipher.tagLength,
    },
  };
}

function orderedGenerationHeader(
  generation: EncryptedLedgerGenerationV3S2,
): LedgerFileGenerationHeaderV3S2 {
  return {
    revisionId: generation.revisionId,
    parentRevisionId: generation.parentRevisionId,
    ledgerSchemaVersion: generation.ledgerSchemaVersion,
    bodySlot: generation.bodySlot,
    ivBase64Url: generation.ivBase64Url,
    ciphertextByteLength: generation.ciphertextBytes.byteLength,
  };
}
