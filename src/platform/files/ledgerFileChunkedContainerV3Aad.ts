/**
 * 这个文件管 S-3 格式的两种附加验证信息。
 * 每个块一份，块清单一份。
 * 它不管真正加密，那在 ledgerFileCrypto.ts。
 * 不显然的决定：块清单单独验证，有人删块、换块就能发现。2026-09-01 定（W15 06C 第 R-2 节 F-4）。
 */

import type {
  EncryptedLedgerBlockV3S3,
  LedgerFileV3S3,
} from "./ledgerFileChunkedContainerV3";
import {
  toHeader,
  orderedBlockMetadata,
  orderedCrypto,
} from "./ledgerFileChunkedContainerV3Header";

/**
 * 这个函数做一个块的附加验证信息。
 * 文件外层的参数加这个块的说明。
 * 改了块的编号、顺序、占的槽，解密就会失败。
 * 举例：同一个文件、同一个块 → 每次答一模一样的字节。
 * 不会出错。
 */
export function createLedgerFileBlockAadV3S3(
  file: Pick<
    LedgerFileV3S3,
    | "fileFormatVersion"
    | "cryptoVersion"
    | "ledgerSchemaVersion"
    | "backupFormatVersion"
    | "fileId"
    | "crypto"
  >,
  block: Omit<EncryptedLedgerBlockV3S3, "ciphertextBytes">,
): Uint8Array {
  const ordered = {
    fileFormatVersion: file.fileFormatVersion,
    cryptoVersion: file.cryptoVersion,
    ledgerSchemaVersion: file.ledgerSchemaVersion,
    backupFormatVersion: file.backupFormatVersion,
    fileId: file.fileId,
    crypto: orderedCrypto(file.crypto),
    block: orderedBlockMetadata(block),
  };
  return new TextEncoder().encode(JSON.stringify(ordered));
}

/**
 * 这个函数做整份块清单的附加验证信息。
 * 盖住这一代和上一代的全部块。
 * 举例：把某个块的 order 从 1 改成 2 → 答的字节就不一样。
 * 不会出错。
 */
export function createLedgerFileManifestAadV3S3(
  file: LedgerFileV3S3,
): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(toHeader(file)));
}
