import {
  type CanonicalLedgerPayloadV4,
  type DecryptedLedgerPayloadV4,
} from "./ledgerFileContract";
import {
  type LedgerFileBinaryPatchV3S3,
  type LedgerFileV3S3,
  type LedgerGenerationV3S3,
} from "./ledgerFileChunkedContainerV3";
import { type LedgerBlockPayloadV3S3 } from "./ledgerFileChunkingV3";
import {
  type ReadyLedgerClearAuthorization,
  type ReadyLedgerImportAuthorization,
} from "@/platform/persistence";

export type VerifiedGeneration = {
  generation: LedgerGenerationV3S3;
  payload: DecryptedLedgerPayloadV4;
  serializedPayload: string;
  serializedLedgerData: string;
  blockPayloads: ReadonlyMap<string, LedgerBlockPayloadV3S3>;
};

export type VerifiedLedgerFile = {
  file: LedgerFileV3S3;
  current: VerifiedGeneration;
  previous: VerifiedGeneration | null;
  serializedFile: Uint8Array;
  reachableBodySlots: readonly number[];
  reachableIvBase64Urls: readonly string[];
};

export type PendingSaveIntent = {
  key: string;
  baseFile: LedgerFileV3S3;
  baseSerializedFile: Uint8Array;
  baseCurrent: VerifiedGeneration;
  file: LedgerFileV3S3;
  serializedFile: Uint8Array;
  writeMode: "replace" | "patch";
  patches: readonly LedgerFileBinaryPatchV3S3[];
  expectedCurrent: CanonicalLedgerPayloadV4;
  expectedCurrentBlockPayloads: ReadonlyMap<string, string>;
  expectedReachableBodySlots: readonly number[];
  expectedReachableIvBase64Urls: readonly string[];
  appendedFactId?: string;
};

export type PendingRecoveryIntent = {
  file: LedgerFileV3S3;
  serializedFile: Uint8Array;
  writeMode: "replace" | "patch";
  patches: readonly LedgerFileBinaryPatchV3S3[];
  expectedCurrent: CanonicalLedgerPayloadV4;
  expectedCurrentBlockPayloads: ReadonlyMap<string, string>;
  expectedReachableBodySlots: readonly number[];
  expectedReachableIvBase64Urls: readonly string[];
};

export type PendingClearIntent = PendingSaveIntent & {
  authorization: ReadyLedgerClearAuthorization;
};

export type PendingImportIntent = PendingSaveIntent & {
  authorization: ReadyLedgerImportAuthorization;
};
