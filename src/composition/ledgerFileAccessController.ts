import {
  LedgerFileAdapterError,
  type LedgerFileHandle,
  type LedgerFileHandleAdapter,
} from "../adapters/ledgerFileHandleAdapter";
import { validatePassphrase } from "../encryption/passphrasePolicy";
import {
  LEDGER_FILE_CAPABILITIES,
  type LedgerSession,
} from "../repositories/ledgerRepository";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepository,
  LedgerFileRepositoryError,
  inspectLedgerFile,
  type LedgerFileRepositoryDependencies,
} from "../repositories/ledgerFileRepository";
import { createInitialLedgerData } from "../state/initialLedgerData";

export const LEDGER_FILE_ACCESS_ERROR_CODES = {
  CANCELLED: "LEDGER_FILE_ACCESS_CANCELLED",
  PICKER_UNAVAILABLE: "LEDGER_FILE_PICKER_UNAVAILABLE",
  INVALID_EXTENSION: "LEDGER_FILE_INVALID_EXTENSION",
  NON_EMPTY_CREATE_TARGET: "LEDGER_FILE_NON_EMPTY_CREATE_TARGET",
  INVALID_FILE: "LEDGER_FILE_ACCESS_INVALID_FILE",
  CREATE_FAILED: "LEDGER_FILE_ACCESS_CREATE_FAILED",
  UNLOCK_FAILED: "LEDGER_FILE_ACCESS_UNLOCK_FAILED",
  NO_SELECTION: "LEDGER_FILE_ACCESS_NO_SELECTION",
} as const;

export type LedgerFileAccessErrorCode =
  (typeof LEDGER_FILE_ACCESS_ERROR_CODES)[keyof typeof LEDGER_FILE_ACCESS_ERROR_CODES];

export type LedgerFileAccessSessionResult =
  | { ok: true; session: LedgerSession }
  | { ok: false; code: LedgerFileAccessErrorCode };

export type LedgerFileSelectionResult =
  | { ok: true }
  | { ok: false; code: LedgerFileAccessErrorCode };

export interface LedgerFileAccessController {
  create(passphrase: string): Promise<LedgerFileAccessSessionResult>;
  selectExisting(): Promise<LedgerFileSelectionResult>;
  unlockSelected(
    passphrase: string,
  ): Promise<LedgerFileAccessSessionResult>;
  cancelPendingSelection(): void;
}

type PendingSelection = {
  handle: LedgerFileHandle;
  fileId: string;
};

export class DefaultLedgerFileAccessController
  implements LedgerFileAccessController
{
  private pendingSelection: PendingSelection | null = null;
  private operationGeneration = 0;

  constructor(
    private readonly adapter: LedgerFileHandleAdapter,
    private readonly dependencies: LedgerFileRepositoryDependencies = {},
  ) {}

  async create(
    passphrase: string,
  ): Promise<LedgerFileAccessSessionResult> {
    const operation = this.beginOperation();
    if (!validatePassphrase(passphrase).ok) {
      return {
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.CREATE_FAILED,
      };
    }

    try {
      const picked = await this.adapter.pickNewLedgerFile();
      if (!this.isCurrentOperation(operation)) {
        return staleOperationResult();
      }
      if (picked.status === "cancelled") {
        return {
          ok: false,
          code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
        };
      }

      const repository = await LedgerFileRepository.create(
        this.adapter,
        picked.handle,
        passphrase,
        createInitialLedgerData(),
        this.dependencies,
      );
      if (!this.isCurrentOperation(operation)) {
        return staleOperationResult();
      }
      this.pendingSelection = null;
      return {
        ok: true,
        session: {
          storageKind: "ledger-file",
          repository,
          capabilities: LEDGER_FILE_CAPABILITIES,
        },
      };
    } catch (error) {
      if (!this.isCurrentOperation(operation)) {
        return staleOperationResult();
      }
      return {
        ok: false,
        code: mapCreateError(error),
      };
    }
  }

  async selectExisting(): Promise<LedgerFileSelectionResult> {
    const operation = this.beginOperation();
    try {
      const picked = await this.adapter.pickExistingLedgerFile();
      if (!this.isCurrentOperation(operation)) {
        return staleOperationResult();
      }
      if (picked.status === "cancelled") {
        return {
          ok: false,
          code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
        };
      }

      const file = await inspectLedgerFile(this.adapter, picked.handle);
      if (!this.isCurrentOperation(operation)) {
        return staleOperationResult();
      }
      this.pendingSelection = {
        handle: picked.handle,
        fileId: file.fileId,
      };
      return { ok: true };
    } catch (error) {
      if (!this.isCurrentOperation(operation)) {
        return staleOperationResult();
      }
      this.pendingSelection = null;
      return {
        ok: false,
        code: mapSelectionError(error),
      };
    }
  }

  async unlockSelected(
    passphrase: string,
  ): Promise<LedgerFileAccessSessionResult> {
    const pending = this.pendingSelection;
    if (!pending) {
      return {
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.NO_SELECTION,
      };
    }
    const operation = this.operationGeneration;
    if (!validatePassphrase(passphrase).ok) {
      return {
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED,
      };
    }

    try {
      const repository = await LedgerFileRepository.open(
        this.adapter,
        pending.handle,
        passphrase,
        {
          ...this.dependencies,
          expectedFileId: pending.fileId,
        },
      );
      if (
        !this.isCurrentOperation(operation) ||
        this.pendingSelection !== pending
      ) {
        return {
          ok: false,
          code: LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED,
        };
      }
      this.pendingSelection = null;
      return {
        ok: true,
        session: {
          storageKind: "ledger-file",
          repository,
          capabilities: LEDGER_FILE_CAPABILITIES,
        },
      };
    } catch {
      return {
        ok: false,
        code: LEDGER_FILE_ACCESS_ERROR_CODES.UNLOCK_FAILED,
      };
    }
  }

  cancelPendingSelection(): void {
    this.operationGeneration += 1;
    this.pendingSelection = null;
  }

  private beginOperation(): number {
    this.operationGeneration += 1;
    this.pendingSelection = null;
    return this.operationGeneration;
  }

  private isCurrentOperation(operation: number): boolean {
    return this.operationGeneration === operation;
  }
}

function staleOperationResult(): {
  ok: false;
  code: typeof LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED;
} {
  return {
    ok: false,
    code: LEDGER_FILE_ACCESS_ERROR_CODES.CANCELLED,
  };
}

function mapCreateError(error: unknown): LedgerFileAccessErrorCode {
  if (error instanceof LedgerFileAdapterError) {
    if (error.stage === "extension") {
      return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_EXTENSION;
    }
    if (error.stage === "target") {
      return LEDGER_FILE_ACCESS_ERROR_CODES.NON_EMPTY_CREATE_TARGET;
    }
    if (
      error.stage === "picker" &&
      error.message.includes("unavailable")
    ) {
      return LEDGER_FILE_ACCESS_ERROR_CODES.PICKER_UNAVAILABLE;
    }
  }

  return LEDGER_FILE_ACCESS_ERROR_CODES.CREATE_FAILED;
}

function mapSelectionError(error: unknown): LedgerFileAccessErrorCode {
  if (error instanceof LedgerFileAdapterError) {
    if (error.stage === "extension") {
      return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_EXTENSION;
    }
    if (
      error.stage === "picker" &&
      error.message.includes("unavailable")
    ) {
      return LEDGER_FILE_ACCESS_ERROR_CODES.PICKER_UNAVAILABLE;
    }
  }
  if (
    error instanceof LedgerFileRepositoryError &&
    error.code === LEDGER_FILE_REPOSITORY_ERROR_CODES.INVALID_FILE
  ) {
    return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_FILE;
  }

  return LEDGER_FILE_ACCESS_ERROR_CODES.INVALID_FILE;
}
