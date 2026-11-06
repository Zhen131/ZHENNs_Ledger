/**
 * 这个文件管 S-1 格式里一代内容的附加验证信息。
 * 它不管真正加密，那在 ledgerFileCrypto.ts。
 * 不显然的决定。
 * 四个版本号都绑进附加验证信息，改了任何一个都解不开。这是猜的，日志里没写，要核。
 */

import type {
  LedgerFileV3S1,
  EncryptedLedgerGenerationV3S1,
} from "./ledgerFileContainerV3";

/**
 * 这个函数做 S-1 格式里一代内容的附加验证信息。
 * 按固定顺序拼成字节。
 * 举例：同一份文件头、同一代 → 每次答一模一样的字节。
 * 不会出错。
 */
export function createLedgerFileGenerationAadV3S1(
  file: Pick<
    LedgerFileV3S1,
    | "fileFormatVersion"
    | "cryptoVersion"
    | "ledgerSchemaVersion"
    | "backupFormatVersion"
    | "fileId"
    | "crypto"
  >,
  generation: Omit<
    EncryptedLedgerGenerationV3S1,
    "ciphertextBytes"
  >,
): Uint8Array {
  const ordered = {
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
    generation: {
      revisionId: generation.revisionId,
      parentRevisionId: generation.parentRevisionId,
      ledgerSchemaVersion: generation.ledgerSchemaVersion,
      ivBase64Url: generation.ivBase64Url,
    },
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}
