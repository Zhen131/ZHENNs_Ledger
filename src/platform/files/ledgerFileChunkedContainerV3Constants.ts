/**
 * 这个文件管 S-3 格式的固定长度和每一层允许出现的字段名。
 * 它不管怎么检查，那在 ledgerFileChunkedContainerV3Parse.ts。
 * 没有特别的决定。
 */

import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";

const PREFIX_UINT32_FIELDS = 2;
/**
 * 文件最前面固定部分的长度。
 * 8 个识别字节加两个 4 字节的数，共 16 字节。
 */
export const PREFIX_BYTES =
  LEDGER_FILE_V3_MAGIC.byteLength +
  Uint32Array.BYTES_PER_ELEMENT * PREFIX_UINT32_FIELDS;
/** 每个文件头槽开头记 JSON 长度用的字节数：4。 */
export const HEADER_JSON_LENGTH_BYTES = Uint32Array.BYTES_PER_ELEMENT;

/** S-3 文件头必须有的十三个字段名。 */
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
  "manifestAuthIvBase64Url",
  "previous",
  "recordsPerBlock",
  "sequence",
] as const;
/** 文件头里这一代必须有的五个字段名。 */
export const GENERATION_KEYS = [
  "controlBlock",
  "factBlocks",
  "openBlockId",
  "parentRevisionId",
  "revisionId",
] as const;
/** 文件头里上一代必须有的五个字段名（只记变过的块）。 */
export const PREVIOUS_KEYS = [
  "changedFactBlocks",
  "controlBlock",
  "currentOnlyBlockIds",
  "parentRevisionId",
  "revisionId",
] as const;
/** 文件头里每个块必须有的十个字段名。 */
export const BLOCK_HEADER_KEYS = [
  "blockId",
  "bodySlots",
  "ciphertextByteLength",
  "ivBase64Url",
  "ledgerSchemaVersion",
  "order",
  "plaintextByteLength",
  "recordCount",
  "role",
  "sealed",
] as const;
/** 加密参数那一层必须有的三个字段名。 */
export const CRYPTO_KEYS = ["cipher", "cryptoVersion", "kdf"] as const;
/** 从密码算钥匙那一层必须有的四个字段名。 */
export const KDF_KEYS = ["hash", "iterations", "name", "saltBase64Url"] as const;
/** 加密算法那一层必须有的三个字段名。 */
export const CIPHER_KEYS = ["keyLength", "name", "tagLength"] as const;
