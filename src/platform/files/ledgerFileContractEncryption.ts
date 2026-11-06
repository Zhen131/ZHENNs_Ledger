/**
 * 这个文件管老格式（文件格式版本 2）加密时要用的两样东西。
 * 包括附加验证信息、加密参数。
 * 它不管真正加密，那在 ledgerFileCrypto.ts。
 * 不显然的决定：附加验证信息按固定顺序拼，一变就解不开。这是猜的，日志里没写，要核。
 */

import type {
  LedgerFileCryptoV2,
  EncryptedLedgerGenerationV4,
  LedgerFileV2,
} from "./ledgerFileContract";
import { LEDGER_FILE_OUTER_V2_CONSTANTS } from "./ledgerFileContract";

/**
 * 这个函数做老格式里一代内容的附加验证信息。
 * 它和密文绑在一起，改了文件头里任何一项，解密就会失败。
 * 举例：同一个文件、同一代 → 每次答一模一样的字节。
 * 不会出错。
 */
export function createLedgerFileGenerationAadV2(
  file: Pick<
    LedgerFileV2,
    "fileFormatVersion" | "fileId" | "crypto"
  >,
  generation: Omit<
    EncryptedLedgerGenerationV4,
    "ciphertextBase64Url"
  >,
): Uint8Array {
  const ordered = {
    fileFormatVersion: file.fileFormatVersion,
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
    generation: {
      revisionId: generation.revisionId,
      parentRevisionId: generation.parentRevisionId,
      ledgerSchemaVersion: generation.ledgerSchemaVersion,
      ivBase64Url: generation.ivBase64Url,
    },
  };

  return new TextEncoder().encode(JSON.stringify(ordered));
}

/**
 * 这个函数配上这把盐，做一份标准的加密参数。
 * 举例：盐 "AAAA…" → 答 PBKDF2、SHA-256、60 万轮、AES-GCM 256 位那一套。
 * 不会出错。
 */
export function createLedgerFileCryptoV2(
  saltBase64Url: string,
): LedgerFileCryptoV2 {
  return {
    cryptoVersion: LEDGER_FILE_OUTER_V2_CONSTANTS.cryptoVersion,
    kdf: {
      name: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfName,
      hash: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfHash,
      iterations: LEDGER_FILE_OUTER_V2_CONSTANTS.kdfIterations,
      saltBase64Url,
    },
    cipher: {
      name: LEDGER_FILE_OUTER_V2_CONSTANTS.cipherName,
      keyLength: LEDGER_FILE_OUTER_V2_CONSTANTS.keyLength,
      tagLength: LEDGER_FILE_OUTER_V2_CONSTANTS.tagLength,
    },
  };
}
