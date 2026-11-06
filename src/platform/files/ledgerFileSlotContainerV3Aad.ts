/**
 * 这个文件管 S-2 格式里一代内容的附加验证信息。
 * 它不管真正加密，那在 ledgerFileCrypto.ts。
 * 不显然的决定。
 * 附加验证信息里记着内容槽编号，搬到别的槽就解不开。这是猜的，日志里没写，要核。
 */

import type {
  EncryptedLedgerGenerationV3S2,
  LedgerFileV3S2,
} from "./ledgerFileSlotContainerV3";
import { orderedCrypto } from "./ledgerFileSlotContainerV3Header";

/**
 * 这个函数做 S-2 格式里一代内容的附加验证信息。
 * 按固定顺序拼成字节。
 * 举例：同一份文件头、同一代 → 每次答一模一样的字节。
 * 不会出错。
 */
export function createLedgerFileGenerationAadV3S2(
  file: Pick<
    LedgerFileV3S2,
    | "fileFormatVersion"
    | "cryptoVersion"
    | "ledgerSchemaVersion"
    | "backupFormatVersion"
    | "fileId"
    | "crypto"
  >,
  generation: Omit<EncryptedLedgerGenerationV3S2, "ciphertextBytes">,
): Uint8Array {
  const ordered = {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
    fileId: file.fileId,
    crypto: orderedCrypto(file.crypto),
    generation: {
      revisionId: generation.revisionId,
      parentRevisionId: generation.parentRevisionId,
      ledgerSchemaVersion: generation.ledgerSchemaVersion,
      bodySlot: generation.bodySlot,
      ivBase64Url: generation.ivBase64Url,
    },
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}
