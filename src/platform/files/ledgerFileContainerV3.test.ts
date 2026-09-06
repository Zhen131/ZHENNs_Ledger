import { describe, expect, it } from "vitest";

import { bytesToBase64Url } from "@/platform/encryption";
import {
  LEDGER_FILE_OUTER_V2_CONSTANTS,
  type LedgerFileCryptoV2,
} from "./ledgerFileContract";
import {
  LEDGER_FILE_OUTER_V3_CONSTANTS,
  LEDGER_FILE_V3_MAGIC,
  parseLedgerFileV3S1,
  serializeLedgerFileV3S1,
  type LedgerFileV3S1,
} from "./ledgerFileContainerV3";

const CRYPTO: LedgerFileCryptoV2 = {
  cryptoVersion: 1,
  kdf: {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: 600_000,
    saltBase64Url: bytesToBase64Url(new Uint8Array(16).fill(7)),
  },
  cipher: {
    name: "AES-GCM",
    keyLength: 256,
    tagLength: 128,
  },
};

function createFile(): LedgerFileV3S1 {
  return {
    fileFormatVersion: 3,
    cryptoVersion: 1,
    ledgerSchemaVersion: 5,
    backupFormatVersion: 3,
    fileId: "v3-s1-test-file",
    crypto: CRYPTO,
    current: {
      revisionId: "revision-b",
      parentRevisionId: "revision-a",
      ledgerSchemaVersion: 5,
      ivBase64Url: bytesToBase64Url(new Uint8Array(12).fill(8)),
      ciphertextBytes: new Uint8Array(19).fill(0xff),
    },
    previous: {
      revisionId: "revision-a",
      parentRevisionId: null,
      ledgerSchemaVersion: 5,
      ivBase64Url: bytesToBase64Url(new Uint8Array(12).fill(9)),
      ciphertextBytes: new Uint8Array(17).fill(0x80),
    },
  };
}

function readHeader(bytes: Uint8Array): {
  header: Record<string, unknown>;
  bodyOffset: number;
} {
  const headerLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(LEDGER_FILE_V3_MAGIC.byteLength, true);
  const headerStart =
    LEDGER_FILE_V3_MAGIC.byteLength +
    LEDGER_FILE_OUTER_V3_CONSTANTS.headerLengthBytes;
  const headerText = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(headerStart, headerStart + headerLength),
  );
  return {
    header: JSON.parse(headerText) as Record<string, unknown>,
    bodyOffset: headerStart + headerLength,
  };
}

describe("LedgerFileV3 S-1 container", () => {
  it("stores the four plaintext versions in JSON and ciphertext as raw bytes", () => {
    const file = createFile();
    const bytes = serializeLedgerFileV3S1(file);
    const { header, bodyOffset } = readHeader(bytes);
    const currentCiphertext = new Uint8Array(19).fill(0xff);
    const previousCiphertext = new Uint8Array(17).fill(0x80);

    expect(bytes.subarray(0, LEDGER_FILE_V3_MAGIC.byteLength)).toEqual(
      LEDGER_FILE_V3_MAGIC,
    );
    expect(header).toMatchObject({
      fileFormatVersion: 3,
      cryptoVersion: 1,
      ledgerSchemaVersion: 5,
      backupFormatVersion: 3,
    });
    expect(JSON.stringify(header)).not.toContain("ciphertextBase64Url");
    expect(bytes.subarray(bodyOffset, bodyOffset + 19)).toEqual(
      currentCiphertext,
    );
    expect(bytes.subarray(bodyOffset + 19)).toEqual(previousCiphertext);
    expect(parseLedgerFileV3S1(bytes)).toEqual({ ok: true, value: file });
  });

  it("rejects a truncated or extended raw body", () => {
    const bytes = serializeLedgerFileV3S1(createFile());
    const extended = new Uint8Array(bytes.byteLength + 1);
    extended.set(bytes);

    expect(parseLedgerFileV3S1(bytes.subarray(0, bytes.byteLength - 1)).ok).toBe(
      false,
    );
    expect(parseLedgerFileV3S1(extended).ok).toBe(false);
  });

  it("changes only fileFormatVersion in the version tuple", () => {
    expect({
      fileFormatVersion: LEDGER_FILE_OUTER_V3_CONSTANTS.fileFormatVersion,
      cryptoVersion: LEDGER_FILE_OUTER_V3_CONSTANTS.cryptoVersion,
      ledgerSchemaVersion:
        LEDGER_FILE_OUTER_V3_CONSTANTS.ledgerSchemaVersion,
      backupFormatVersion:
        LEDGER_FILE_OUTER_V3_CONSTANTS.backupFormatVersion,
    }).toEqual({
      fileFormatVersion: 3,
      cryptoVersion: LEDGER_FILE_OUTER_V2_CONSTANTS.cryptoVersion,
      ledgerSchemaVersion: 5,
      backupFormatVersion: 3,
    });
  });
});
