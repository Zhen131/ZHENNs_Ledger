/**
 * 这个文件管老格式里每一层允许出现的字段名。
 * 老格式指文件格式版本 2。
 * 它不管怎么检查，那在 ledgerFileContractValidate.ts。
 * 没有特别的决定。
 */

/** 版本 2 文件最外层必须有的五个字段名。 */
export const FILE_KEYS = [
  "crypto",
  "current",
  "fileFormatVersion",
  "fileId",
  "previous",
] as const;
/** 加密参数那一层必须有的三个字段名。 */
export const CRYPTO_KEYS = ["cipher", "cryptoVersion", "kdf"] as const;
/** 从密码算钥匙那一层必须有的四个字段名。 */
export const KDF_KEYS = [
  "hash",
  "iterations",
  "name",
  "saltBase64Url",
] as const;
/** 加密算法那一层必须有的三个字段名。 */
export const CIPHER_KEYS = ["keyLength", "name", "tagLength"] as const;
/** 一代加密内容必须有的五个字段名（版本 2 的密文是文字）。 */
export const GENERATION_KEYS = [
  "ciphertextBase64Url",
  "ivBase64Url",
  "ledgerSchemaVersion",
  "parentRevisionId",
  "revisionId",
] as const;
/** 解密后里面那一层必须有的两个字段名：保存时间和账本。 */
export const PAYLOAD_KEYS = ["ledgerData", "savedAt"] as const;
/** 解密后账本那一层必须有的七个字段名。 */
export const LEDGER_DATA_KEYS = [
  "assetTransfers",
  "assets",
  "cashEvents",
  "feeRules",
  "priceSnapshots",
  "schemaVersion",
  "trades",
] as const;
