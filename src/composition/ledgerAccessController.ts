import type { StorageAdapter } from "../adapters/storageAdapter";
import {
  getStoredLedgerFormatVersion,
  validateStoredLedgerEnvelopeV2,
} from "../encryption/cryptoEnvelope";
import { validatePassphrase } from "../encryption/passphrasePolicy";
import {
  WebCryptoEncryptionService,
  type CryptoProvider,
} from "../encryption/webCryptoEncryptionService";
import {
  DefaultLedgerRepository,
  type LedgerRepository,
} from "../repositories/ledgerRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";

export const LEDGER_ACCESS_ERROR_CODES = {
  READ_FAILED: "LEDGER_ACCESS_READ_FAILED",
  UNSUPPORTED_FORMAT: "LEDGER_ACCESS_UNSUPPORTED_FORMAT",
  INVALID_ENVELOPE: "LEDGER_ACCESS_INVALID_ENVELOPE",
  SETUP_FAILED: "LEDGER_SETUP_FAILED",
  UNLOCK_FAILED: "LEDGER_UNLOCK_FAILED",
  RESET_FAILED: "LEDGER_ACCESS_RESET_FAILED",
} as const;

export type LedgerAccessErrorCode =
  (typeof LEDGER_ACCESS_ERROR_CODES)[keyof typeof LEDGER_ACCESS_ERROR_CODES];

export type LedgerAccessInspection =
  | { status: "setup-required" }
  | { status: "unlock-required" }
  | { status: "error"; code: LedgerAccessErrorCode };

export type LedgerAccessOperationResult =
  | { ok: true; repository: LedgerRepository }
  | { ok: false; code: LedgerAccessErrorCode };

export type LedgerAccessResetResult =
  | { ok: true }
  | { ok: false; code: typeof LEDGER_ACCESS_ERROR_CODES.RESET_FAILED };

export interface LedgerAccessController {
  inspect(): Promise<LedgerAccessInspection>;
  setup(passphrase: string): Promise<LedgerAccessOperationResult>;
  unlock(passphrase: string): Promise<LedgerAccessOperationResult>;
  resetEncryptedLedger(): Promise<LedgerAccessResetResult>;
}

export class DefaultLedgerAccessController
  implements LedgerAccessController
{
  constructor(
    private readonly storageAdapter: StorageAdapter,
    private readonly cryptoProvider: CryptoProvider = globalThis.crypto,
  ) {}

  async inspect(): Promise<LedgerAccessInspection> {
    const storedResult = await this.readStoredValue();

    if (!storedResult.ok) {
      return storedResult.result;
    }

    return inspectStoredValue(storedResult.value);
  }

  async setup(passphrase: string): Promise<LedgerAccessOperationResult> {
    if (!validatePassphrase(passphrase).ok) {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.SETUP_FAILED,
      };
    }

    const storedResult = await this.readStoredValue();

    if (!storedResult.ok) {
      return {
        ok: false,
        code: storedResult.result.code,
      };
    }

    if (storedResult.value !== null) {
      const inspection = inspectStoredValue(storedResult.value);
      return {
        ok: false,
        code:
          inspection.status === "error"
            ? inspection.code
            : LEDGER_ACCESS_ERROR_CODES.SETUP_FAILED,
      };
    }

    try {
      const encryptionService =
        await WebCryptoEncryptionService.createForSetup(
          passphrase,
          this.cryptoProvider,
        );
      const repository = new DefaultLedgerRepository(
        this.storageAdapter,
        encryptionService,
      );

      await repository.save(createInitialLedgerData());
      const verifiedLedger = await repository.load();

      if (verifiedLedger === null) {
        return {
          ok: false,
          code: LEDGER_ACCESS_ERROR_CODES.SETUP_FAILED,
        };
      }

      return { ok: true, repository };
    } catch {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.SETUP_FAILED,
      };
    }
  }

  async unlock(passphrase: string): Promise<LedgerAccessOperationResult> {
    if (!validatePassphrase(passphrase).ok) {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.UNLOCK_FAILED,
      };
    }

    const storedResult = await this.readStoredValue();

    if (!storedResult.ok) {
      return {
        ok: false,
        code: storedResult.result.code,
      };
    }

    const inspection = inspectStoredValue(storedResult.value);

    if (inspection.status === "error") {
      return { ok: false, code: inspection.code };
    }

    if (inspection.status !== "unlock-required") {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.UNLOCK_FAILED,
      };
    }

    const envelopeValidation = validateStoredLedgerEnvelopeV2(
      storedResult.value,
    );

    if (!envelopeValidation.ok) {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.INVALID_ENVELOPE,
      };
    }

    try {
      const encryptionService =
        await WebCryptoEncryptionService.createForUnlock(
          passphrase,
          envelopeValidation.value.kdf.saltBase64Url,
          this.cryptoProvider,
        );
      const repository = new DefaultLedgerRepository(
        this.storageAdapter,
        encryptionService,
      );
      const verifiedLedger = await repository.load();

      if (verifiedLedger === null) {
        return {
          ok: false,
          code: LEDGER_ACCESS_ERROR_CODES.UNLOCK_FAILED,
        };
      }

      return { ok: true, repository };
    } catch {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.UNLOCK_FAILED,
      };
    }
  }

  async resetEncryptedLedger(): Promise<LedgerAccessResetResult> {
    try {
      await this.storageAdapter.clear();
      return { ok: true };
    } catch {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.RESET_FAILED,
      };
    }
  }

  private async readStoredValue(): Promise<
    | { ok: true; value: unknown | null }
    | {
        ok: false;
        result: {
          status: "error";
          code: typeof LEDGER_ACCESS_ERROR_CODES.READ_FAILED;
        };
      }
  > {
    try {
      return { ok: true, value: await this.storageAdapter.read() };
    } catch {
      return {
        ok: false,
        result: {
          status: "error",
          code: LEDGER_ACCESS_ERROR_CODES.READ_FAILED,
        },
      };
    }
  }
}

function inspectStoredValue(
  value: unknown | null,
): LedgerAccessInspection {
  if (value === null) {
    return { status: "setup-required" };
  }

  if (validateStoredLedgerEnvelopeV2(value).ok) {
    return { status: "unlock-required" };
  }

  return {
    status: "error",
    code:
      getStoredLedgerFormatVersion(value) === 2
        ? LEDGER_ACCESS_ERROR_CODES.INVALID_ENVELOPE
        : LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT,
  };
}
