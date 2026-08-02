import type {
  LegacyLedgerExitStorageAdapter,
  StorageAdapter,
} from "../adapters/storageAdapter";
import {
  getStoredLedgerFormatVersion,
  validateStoredLedgerEnvelopeV2,
} from "../encryption/cryptoEnvelope";
import { validatePassphrase } from "../encryption/passphrasePolicy";
import type { StoredLedgerEnvelopeV2 } from "../encryption/cryptoEnvelope";
import type { LedgerData } from "../models";
import {
  WebCryptoEncryptionService,
  type CryptoProvider,
} from "../encryption/webCryptoEncryptionService";
import {
  createIndexedDbLedgerSession,
  DefaultLedgerRepository,
  type LedgerSession,
  type LedgerRepository,
} from "../repositories/ledgerRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";
import {
  revalidateLedgerFileMigrationReceipt,
  type LedgerFileMigrationReceipt,
} from "./ledgerFileAccessController";
import { evaluateLedgerResourcePolicy } from "../validators/resourcePolicy";
import { validateLedgerData } from "../validators/ledgerDataValidator";

export const LEDGER_ACCESS_ERROR_CODES = {
  READ_FAILED: "LEDGER_ACCESS_READ_FAILED",
  UNSUPPORTED_FORMAT: "LEDGER_ACCESS_UNSUPPORTED_FORMAT",
  INVALID_ENVELOPE: "LEDGER_ACCESS_INVALID_ENVELOPE",
  SETUP_FAILED: "LEDGER_SETUP_FAILED",
  SETUP_RECOVERY_REQUIRED: "LEDGER_SETUP_RECOVERY_REQUIRED",
  UNLOCK_FAILED: "LEDGER_UNLOCK_FAILED",
  RESET_FAILED: "LEDGER_ACCESS_RESET_FAILED",
  MIGRATION_UNLOCK_FAILED: "LEDGER_MIGRATION_UNLOCK_FAILED",
  MIGRATION_TARGET_INVALID: "LEDGER_MIGRATION_TARGET_INVALID",
  MIGRATION_SOURCE_CHANGED: "LEDGER_MIGRATION_SOURCE_CHANGED",
  MIGRATION_DELETE_FAILED: "LEDGER_MIGRATION_DELETE_FAILED",
} as const;

export const LEGACY_MIGRATION_DELETE_CONFIRMATION_TEXT =
  "DELETE LEGACY BROWSER LEDGER";

export type LedgerAccessErrorCode =
  (typeof LEDGER_ACCESS_ERROR_CODES)[keyof typeof LEDGER_ACCESS_ERROR_CODES];

export type LedgerAccessInspection =
  | { status: "setup-required" }
  | { status: "unlock-required" }
  | { status: "error"; code: LedgerAccessErrorCode };

export type LedgerAccessOperationResult =
  | {
      ok: true;
      repository: LedgerRepository;
      session?: LedgerSession;
    }
  | { ok: false; code: LedgerAccessErrorCode };

export type LedgerAccessResetResult =
  | { ok: true }
  | { ok: false; code: typeof LEDGER_ACCESS_ERROR_CODES.RESET_FAILED };

const legacyMigrationCandidateBrand = Symbol(
  "legacy-migration-candidate",
);
const legacyMigrationDeletionAuthorizationBrand = Symbol(
  "legacy-migration-deletion-authorization",
);

export type LegacyMigrationCandidate = Readonly<{
  candidateId: string;
  readLedgerData(): LedgerData;
  [legacyMigrationCandidateBrand]: true;
}>;

export type LegacyMigrationUnlockResult =
  | { ok: true; candidate: LegacyMigrationCandidate }
  | {
      ok: false;
      code:
        | typeof LEDGER_ACCESS_ERROR_CODES.READ_FAILED
        | typeof LEDGER_ACCESS_ERROR_CODES.INVALID_ENVELOPE
        | typeof LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT
        | typeof LEDGER_ACCESS_ERROR_CODES.MIGRATION_UNLOCK_FAILED;
    };

export type LegacyMigrationDeletionAuthorization = Readonly<{
  candidateId: string;
  targetSessionId: string;
  targetGeneration: number;
  targetFileId: string;
  targetRevisionId: string;
  confirmationNonce: string;
  [legacyMigrationDeletionAuthorizationBrand]: true;
}>;

export type LegacyMigrationDeleteResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | typeof LEDGER_ACCESS_ERROR_CODES.MIGRATION_TARGET_INVALID
        | typeof LEDGER_ACCESS_ERROR_CODES.MIGRATION_SOURCE_CHANGED
        | typeof LEDGER_ACCESS_ERROR_CODES.MIGRATION_DELETE_FAILED;
    };

export interface LedgerAccessController {
  inspect(): Promise<LedgerAccessInspection>;
  unlockLegacyForMigration?(
    passphrase: string,
  ): Promise<LegacyMigrationUnlockResult>;
  authorizeLegacyMigrationDeletion?(
    candidate: LegacyMigrationCandidate,
    receipt: LedgerFileMigrationReceipt,
    confirmationNonce: string,
  ): Promise<LegacyMigrationDeletionAuthorization | null>;
  deleteLegacyAfterMigration?(
    authorization: LegacyMigrationDeletionAuthorization,
  ): Promise<LegacyMigrationDeleteResult>;
  /** @deprecated Production UI must use the C-only migration/file path. */
  setup?(passphrase: string): Promise<LedgerAccessOperationResult>;
  /** @deprecated Production UI must use the C-only migration/file path. */
  unlock?(passphrase: string): Promise<LedgerAccessOperationResult>;
  /** @deprecated Unconditional legacy deletion is fail-closed. */
  resetEncryptedLedger?(): Promise<LedgerAccessResetResult>;
}

type LegacyMigrationCandidateRuntime = {
  readonly controller: DefaultLegacyLedgerExitController;
  readonly candidate: LegacyMigrationCandidate;
  readonly envelope: StoredLedgerEnvelopeV2;
  readonly ledgerData: LedgerData;
  readonly serializedLedgerData: string;
  active: boolean;
  authorization: LegacyMigrationDeletionAuthorization | null;
};

type LegacyMigrationDeletionRuntime = {
  readonly controller: DefaultLegacyLedgerExitController;
  readonly candidateRuntime: LegacyMigrationCandidateRuntime;
  readonly authorization: LegacyMigrationDeletionAuthorization;
  readonly receipt: LedgerFileMigrationReceipt;
  state: "authorized" | "in-flight" | "consumed";
  promise: Promise<LegacyMigrationDeleteResult> | null;
};

const legacyMigrationCandidateRuntimes = new WeakMap<
  LegacyMigrationCandidate,
  LegacyMigrationCandidateRuntime
>();
const legacyMigrationDeletionRuntimes = new WeakMap<
  LegacyMigrationDeletionAuthorization,
  LegacyMigrationDeletionRuntime
>();
let legacyMigrationCandidateSequence = 0;

export class DefaultLegacyLedgerExitController
  implements LedgerAccessController
{
  constructor(
    protected readonly storageAdapter: StorageAdapter,
    protected readonly cryptoProvider: CryptoProvider = globalThis.crypto,
  ) {}

  async inspect(): Promise<LedgerAccessInspection> {
    const storedResult = await this.readStoredValue();

    if (!storedResult.ok) {
      return storedResult.result;
    }

    return inspectStoredValue(storedResult.value);
  }

  async unlockLegacyForMigration(
    passphrase: string,
  ): Promise<LegacyMigrationUnlockResult> {
    if (!validatePassphrase(passphrase).ok) {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.MIGRATION_UNLOCK_FAILED,
      };
    }
    const storedResult = await this.readStoredValue();
    if (!storedResult.ok) {
      return {
        ok: false,
        code: storedResult.result.code,
      };
    }
    const envelopeValidation = validateStoredLedgerEnvelopeV2(
      storedResult.value,
    );
    if (!envelopeValidation.ok) {
      return {
        ok: false,
        code:
          getStoredLedgerFormatVersion(storedResult.value) === 2
            ? LEDGER_ACCESS_ERROR_CODES.INVALID_ENVELOPE
            : LEDGER_ACCESS_ERROR_CODES.UNSUPPORTED_FORMAT,
      };
    }

    try {
      const encryptionService =
        await WebCryptoEncryptionService.createForUnlock(
          passphrase,
          envelopeValidation.value.kdf.saltBase64Url,
          this.cryptoProvider,
        );
      const plaintext = await encryptionService.decrypt(
        envelopeValidation.value,
      );
      const parsed = JSON.parse(plaintext) as unknown;
      const ledgerValidation = validateLedgerData(parsed);
      if (!ledgerValidation.ok) {
        throw new Error(
          "Legacy ledger failed runtime validation",
        );
      }
      const resourceResult = evaluateLedgerResourcePolicy(
        ledgerValidation.value,
      );
      if (!resourceResult.ok) {
        throw new Error(
          "Legacy ledger exceeds the resource policy",
        );
      }

      const ledgerData = structuredClone(ledgerValidation.value);
      const candidate: LegacyMigrationCandidate = Object.freeze({
        candidateId: createLegacyMigrationCandidateId(),
        readLedgerData: () => structuredClone(ledgerData),
        [legacyMigrationCandidateBrand]: true as const,
      });
      const runtime: LegacyMigrationCandidateRuntime = {
        controller: this,
        candidate,
        envelope: structuredClone(envelopeValidation.value),
        ledgerData,
        serializedLedgerData: JSON.stringify(ledgerData),
        active: true,
        authorization: null,
      };
      legacyMigrationCandidateRuntimes.set(candidate, runtime);
      return { ok: true, candidate };
    } catch {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.MIGRATION_UNLOCK_FAILED,
      };
    }
  }

  async authorizeLegacyMigrationDeletion(
    candidate: LegacyMigrationCandidate,
    receipt: LedgerFileMigrationReceipt,
    confirmationNonce: string,
  ): Promise<LegacyMigrationDeletionAuthorization | null> {
    const candidateRuntime =
      legacyMigrationCandidateRuntimes.get(candidate);
    if (
      !candidateRuntime ||
      candidateRuntime.controller !== this ||
      candidateRuntime.candidate !== candidate ||
      !candidateRuntime.active ||
      candidateRuntime.authorization ||
      confirmationNonce !==
        LEGACY_MIGRATION_DELETE_CONFIRMATION_TEXT ||
      receipt.serializedLedgerData !==
        candidateRuntime.serializedLedgerData ||
      !(await revalidateLedgerFileMigrationReceipt(receipt))
    ) {
      return null;
    }

    const authorization: LegacyMigrationDeletionAuthorization =
      Object.freeze({
        candidateId: candidate.candidateId,
        targetSessionId: receipt.sessionId,
        targetGeneration: receipt.generation,
        targetFileId: receipt.fileId,
        targetRevisionId: receipt.verifiedRevisionId,
        confirmationNonce,
        [legacyMigrationDeletionAuthorizationBrand]: true as const,
      });
    const runtime: LegacyMigrationDeletionRuntime = {
      controller: this,
      candidateRuntime,
      authorization,
      receipt,
      state: "authorized",
      promise: null,
    };
    candidateRuntime.authorization = authorization;
    legacyMigrationDeletionRuntimes.set(authorization, runtime);
    return authorization;
  }

  deleteLegacyAfterMigration(
    authorization: LegacyMigrationDeletionAuthorization,
  ): Promise<LegacyMigrationDeleteResult> {
    const runtime =
      legacyMigrationDeletionRuntimes.get(authorization);
    if (
      !runtime ||
      runtime.controller !== this ||
      runtime.authorization !== authorization ||
      runtime.candidateRuntime.authorization !== authorization ||
      !runtime.candidateRuntime.active ||
      authorization.candidateId !==
        runtime.candidateRuntime.candidate.candidateId
    ) {
      return Promise.resolve({
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.MIGRATION_TARGET_INVALID,
      });
    }
    if (runtime.state === "consumed") {
      return Promise.resolve({
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.MIGRATION_TARGET_INVALID,
      });
    }
    if (runtime.state === "in-flight") {
      return (
        runtime.promise ??
        Promise.resolve({
          ok: false,
          code:
            LEDGER_ACCESS_ERROR_CODES.MIGRATION_DELETE_FAILED,
        })
      );
    }

    runtime.state = "in-flight";
    const promise = this.finishLegacyMigrationDeletion(runtime).then(
      (result) => {
        runtime.state = result.ok ? "consumed" : "authorized";
        if (result.ok) {
          runtime.candidateRuntime.active = false;
        }
        return result;
      },
      () => {
        runtime.state = "authorized";
        return {
          ok: false,
          code:
            LEDGER_ACCESS_ERROR_CODES.MIGRATION_DELETE_FAILED,
        } as const;
      },
    ).finally(() => {
      runtime.promise = null;
    });
    runtime.promise = promise;
    return promise;
  }

  private async finishLegacyMigrationDeletion(
    runtime: LegacyMigrationDeletionRuntime,
  ): Promise<LegacyMigrationDeleteResult> {
    if (
      !(await revalidateLedgerFileMigrationReceipt(
        runtime.receipt,
      ))
    ) {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.MIGRATION_TARGET_INVALID,
      };
    }
    const storage = asLegacyLedgerExitStorageAdapter(
      this.storageAdapter,
    );
    if (!storage) {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.MIGRATION_DELETE_FAILED,
      };
    }
    const result = await storage.deleteIfUnchanged(
      runtime.candidateRuntime.envelope,
    );
    if (result !== "deleted") {
      return {
        ok: false,
        code:
          result === "changed"
            ? LEDGER_ACCESS_ERROR_CODES.MIGRATION_SOURCE_CHANGED
            : LEDGER_ACCESS_ERROR_CODES.MIGRATION_DELETE_FAILED,
      };
    }
    return { ok: true };
  }

  protected async readStoredValue(): Promise<
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

export class DefaultLedgerAccessController
  extends DefaultLegacyLedgerExitController
  implements LedgerAccessController
{
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
            : LEDGER_ACCESS_ERROR_CODES.SETUP_RECOVERY_REQUIRED,
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
        return this.reconcileSetupFailure();
      }

      return {
        ok: true,
        repository,
        session: createIndexedDbLedgerSession(repository),
      };
    } catch {
      return this.reconcileSetupFailure();
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

      return {
        ok: true,
        repository,
        session: createIndexedDbLedgerSession(repository),
      };
    } catch {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.UNLOCK_FAILED,
      };
    }
  }

  async resetEncryptedLedger(): Promise<LedgerAccessResetResult> {
    return {
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.RESET_FAILED,
    };
  }

  private async reconcileSetupFailure(): Promise<LedgerAccessOperationResult> {
    const storedResult = await this.readStoredValue();

    if (!storedResult.ok) {
      return {
        ok: false,
        code: storedResult.result.code,
      };
    }

    const inspection = inspectStoredValue(storedResult.value);

    if (inspection.status === "unlock-required") {
      return {
        ok: false,
        code: LEDGER_ACCESS_ERROR_CODES.SETUP_RECOVERY_REQUIRED,
      };
    }

    if (inspection.status === "error") {
      return { ok: false, code: inspection.code };
    }

    return {
      ok: false,
      code: LEDGER_ACCESS_ERROR_CODES.SETUP_FAILED,
    };
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

function asLegacyLedgerExitStorageAdapter(
  adapter: StorageAdapter,
): LegacyLedgerExitStorageAdapter | null {
  return "deleteIfUnchanged" in adapter &&
    typeof adapter.deleteIfUnchanged === "function"
    ? (adapter as LegacyLedgerExitStorageAdapter)
    : null;
}

function createLegacyMigrationCandidateId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  legacyMigrationCandidateSequence += 1;
  return `legacy-migration-${legacyMigrationCandidateSequence}`;
}
