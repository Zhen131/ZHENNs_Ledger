/**
 * 这个文件管 S-1 格式文件头里每一层允许出现的字段名。
 * 它不管怎么检查，那在 ledgerFileContainerV3Parse.ts。
 * 没有特别的决定。
 */

/** S-1 文件头最外层必须有的八个字段名。 */
export const HEADER_KEYS = [
  "backupFormatVersion",
  "crypto",
  "cryptoVersion",
  "current",
  "fileFormatVersion",
  "fileId",
  "ledgerSchemaVersion",
  "previous",
] as const;
/**
 * S-1 文件头里一代内容必须有的五个字段名（记密文长度。
 * 不记密文）。
 */
export const GENERATION_HEADER_KEYS = [
  "ciphertextByteLength",
  "ivBase64Url",
  "ledgerSchemaVersion",
  "parentRevisionId",
  "revisionId",
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
/** 读出来以后一代内容必须有的五个字段名（带着密文字节）。 */
export const GENERATION_KEYS = [
  "ciphertextBytes",
  "ivBase64Url",
  "ledgerSchemaVersion",
  "parentRevisionId",
  "revisionId",
] as const;
