/**
 * 这个文件管文件格式 3 第一步（S-1）的整份文件形状。
 * 包括识别字节、固定参数、两代内容。
 * 现在的程序只读写 S-3 分块那种。
 * 这份 S-1 格式只剩测试辅助代码在用。
 * 不显然的决定。
 * 文件改成「JSON 文件头 + 原始加密字节」，不再用 Base64。2026-08-31 定（W15 06A 第 1.2 节）。
 */

import {
  MAX_LEDGER_FILE_V2_BYTES,
  type LedgerFileContractError,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";

/**
 * 文件格式 3 开头的 8 个识别字节。
 * 读出来是 "LFTL3" 加换行和一个 0。
 * 为什么要有：不解密就能认出这是哪种文件。这是猜的，日志里没写，要核。
 */
export const LEDGER_FILE_V3_MAGIC = new Uint8Array([
  0x4c, 0x46, 0x54, 0x4c, 0x33, 0x0d, 0x0a, 0x00,
]);

/**
 * 文件格式 3 写在明文外层的四个版本号。
 * 和文件头、整份文件的大小上限。
 * 四个版本号：文件格式 3、加密 1、账本结构 5、备份 3。
 * 为什么都放明文外层：低版本要能在解密前认出来。2026-08-27 定（W15 版本分层与迁移策略决策记录第二节）。
 */
export const LEDGER_FILE_OUTER_V3_CONSTANTS = {
  fileFormatVersion: 3,
  cryptoVersion: 1,
  ledgerSchemaVersion: 5,
  backupFormatVersion: 3,
  headerLengthBytes: 4,
  maximumHeaderBytes: 256 * 1024,
  maximumFileBytes: MAX_LEDGER_FILE_V2_BYTES,
} as const;

/**
 * S-1 格式的整份文件。
 * 包括四个版本号、编号、加密参数、这一代、上一代。
 */
export type LedgerFileV3S1 = {
  fileFormatVersion: 3;
  cryptoVersion: 1;
  ledgerSchemaVersion: 5;
  backupFormatVersion: 3;
  fileId: string;
  crypto: LedgerFileCryptoV2;
  current: EncryptedLedgerGenerationV3S1;
  previous: EncryptedLedgerGenerationV3S1 | null;
};

/** S-1 格式里的一代加密内容，密文是原始字节。 */
export type EncryptedLedgerGenerationV3S1 = {
  revisionId: string;
  parentRevisionId: string | null;
  ledgerSchemaVersion: 5;
  ivBase64Url: string;
  ciphertextBytes: Uint8Array;
};

/** 检查一份 S-1 文件的结果：通过就给出文件，不通过就给出错误。 */
export type LedgerFileV3ValidationResult =
  | { ok: true; value: LedgerFileV3S1 }
  | { ok: false; errors: LedgerFileContractError[] };

/**
 * 这个函数回答。
 * 这串字节是不是以文件格式 3 的识别字节开头？
 * 举例：开头是 "LFTL3\r\n\0" → 答是；一份 JSON 文字 → 答不是。
 * 不会出错。
 */
export function isLedgerFileV3Bytes(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= LEDGER_FILE_V3_MAGIC.byteLength &&
    LEDGER_FILE_V3_MAGIC.every((value, index) => bytes[index] === value)
  );
}
