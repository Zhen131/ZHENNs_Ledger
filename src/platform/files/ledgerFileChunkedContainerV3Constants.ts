import { LEDGER_FILE_V3_MAGIC } from "./ledgerFileContainerV3";

const PREFIX_UINT32_FIELDS = 2;
export const PREFIX_BYTES =
  LEDGER_FILE_V3_MAGIC.byteLength +
  Uint32Array.BYTES_PER_ELEMENT * PREFIX_UINT32_FIELDS;
export const HEADER_JSON_LENGTH_BYTES = Uint32Array.BYTES_PER_ELEMENT;

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
export const GENERATION_KEYS = [
  "controlBlock",
  "factBlocks",
  "openBlockId",
  "parentRevisionId",
  "revisionId",
] as const;
export const PREVIOUS_KEYS = [
  "changedFactBlocks",
  "controlBlock",
  "currentOnlyBlockIds",
  "parentRevisionId",
  "revisionId",
] as const;
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
export const CRYPTO_KEYS = ["cipher", "cryptoVersion", "kdf"] as const;
export const KDF_KEYS = ["hash", "iterations", "name", "saltBase64Url"] as const;
export const CIPHER_KEYS = ["keyLength", "name", "tagLength"] as const;
