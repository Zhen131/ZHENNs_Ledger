/**
 * 这个文件管 S-2 格式的固定长度和每一层允许出现的字段名。
 * 它不管怎么检查，那在 ledgerFileSlotContainerV3Parse.ts。
 * 没有特别的决定。
 */

import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";

const PREFIX_UINT32_FIELDS = 2;
/**
 * 文件最前面固定部分的长度。
 * 8 个识别字节加两个 4 字节的数，共 16 字节。
 */
export const PREFIX_BYTES =
  LEDGER_FILE_V3_MAGIC.byteLength + Uint32Array.BYTES_PER_ELEMENT * PREFIX_UINT32_FIELDS;
/** 每个文件头槽开头记 JSON 长度用的字节数：4。 */
export const HEADER_JSON_LENGTH_BYTES = Uint32Array.BYTES_PER_ELEMENT;

/** 读出来以后整份 S-2 文件必须有的字段名。 */
export const LOGICAL_FILE_KEYS = [
  "activeHeaderSlot",
  "backupFormatVersion",
  "bodySlotBytes",
  "bodySlotCount",
  "crypto",
  "cryptoVersion",
  "current",
  "fileFormatVersion",
  "fileId",
  "ledgerSchemaVersion",
  "previous",
  "sequence",
] as const;
/** S-2 文件头必须有的字段名。 */
export const HEADER_KEYS = [
  "backupFormatVersion",
  "bodySlotBytes",
  "bodySlotCount",
  "crypto",
  "cryptoVersion",
  "current",
  "fileFormatVersion",
  "fileId",
  "ledgerSchemaVersion",
  "previous",
  "sequence",
] as const;
/** 读出来以后一代内容必须有的字段名（带着密文字节）。 */
export const GENERATION_KEYS = [
  "bodySlot",
  "ciphertextBytes",
  "ivBase64Url",
  "ledgerSchemaVersion",
  "parentRevisionId",
  "revisionId",
] as const;
/** S-2 文件头里一代内容必须有的字段名（记密文长度，不记密文）。 */
export const GENERATION_HEADER_KEYS = [
  "bodySlot",
  "ciphertextByteLength",
  "ivBase64Url",
  "ledgerSchemaVersion",
  "parentRevisionId",
  "revisionId",
] as const;
/** 加密参数那一层必须有的三个字段名。 */
export const CRYPTO_KEYS = ["cipher", "cryptoVersion", "kdf"] as const;
/** 从密码算钥匙那一层必须有的四个字段名。 */
export const KDF_KEYS = ["hash", "iterations", "name", "saltBase64Url"] as const;
/** 加密算法那一层必须有的三个字段名。 */
export const CIPHER_KEYS = ["keyLength", "name", "tagLength"] as const;
