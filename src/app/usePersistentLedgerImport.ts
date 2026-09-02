import type { LedgerData } from "@/core/models";
import { validateLedgerImportPolicy } from "@/core/policies";
import {
  captureLedgerTime,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import {
  evaluateLedgerResourcePolicy,
  type LedgerResourcePolicyError,
  validateLedgerData,
} from "@/core/validation";
import {
  LEDGER_REPOSITORY_ERROR_CODES,
  type LedgerBackupImportEvidence,
  type LedgerSession,
  type LedgerRepository,
} from "@/platform/persistence";
import {
  LEDGER_FILE_REPOSITORY_ERROR_CODES,
  LedgerFileRepositoryError,
} from "@/platform/files";
import { translateDefault } from "@/ui";
import type { HydrationStatus } from "./hydrationState";
import type {
  ImportLedgerResult,
  PersistenceOperation,
  PersistenceVersionState,
  RetryAttempt,
  ScheduledSnapshot,
} from "./usePersistentLedgerTypes";

type ReplaceLedgerFromBackupDeps = {
  acceptingOperationsRef: { current: boolean };
  activeCapabilities: { canImportBackup: boolean };
  activeRepository: LedgerRepository;
  activeSession: LedgerSession | undefined;
  clock: LedgerClock;
  currentRepositoryRef: { current: LedgerRepository };
  failedSnapshotRef: { current: ScheduledSnapshot | null };
  generationRef: { current: number };
  hydratedRepositoryRef: { current: LedgerRepository | null };
  hydrationErrorRepositoryRef: { current: LedgerRepository | null };
  hydrationStatus: HydrationStatus;
  importAbortControllerRef: { current: AbortController | null };
  importPromiseRef: { current: Promise<ImportLedgerResult> | null };
  importSessionRef: { current: LedgerSession | undefined };
  lastPersistedSnapshotRef: { current: string | null };
  latestScheduledSnapshotRef: { current: ScheduledSnapshot | null };
  ledgerDataRef: { current: LedgerData };
  mountedRef: { current: boolean };
  operationRef: { current: PersistenceOperation };
  operationRepositoryRef: { current: LedgerRepository | null };
  operationTokenRef: { current: symbol | null };
  pendingHydrationRef: {
    current: {
      repository: LedgerRepository;
      generation: number;
      serializedLedger: string;
    } | null;
  };
  persistenceVersionStateRef: { current: PersistenceVersionState };
  publishPersistenceVersionState: (nextState: PersistenceVersionState) => void;
  readOnlyRef: { current: boolean };
  reducerDispatch: (action: { type: "ledger/replace"; ledgerData: LedgerData }) => void;
  retryAttemptRef: { current: RetryAttempt | null };
  setHydrationStatus: (nextValue: HydrationStatus) => void;
  setIsReadOnly: (nextValue: boolean) => void;
  setLedgerEpoch: (nextValue: (current: number) => number) => void;
  setPersistenceError: (nextValue: string | null) => void;
  setPersistenceOperation: (nextValue: PersistenceOperation) => void;
  setResourcePolicyError: (nextValue: LedgerResourcePolicyError | null) => void;
  stopForImportRecoveryFatal: (message: string) => void;
  trackSessionAcceptedWork: (
    session: LedgerSession | undefined,
    work: PromiseLike<unknown>,
  ) => void;
  writeQueueRef: { current: Promise<void> };
};

export function doReplaceLedgerFromBackup(
  deps: ReplaceLedgerFromBackupDeps,
  candidate: unknown,
  timeSnapshot?: LedgerTimeSnapshot,
  evidence?: LedgerBackupImportEvidence,
  externalSignal?: AbortSignal,
): Promise<ImportLedgerResult> {
  const {
    acceptingOperationsRef,
    activeCapabilities,
    activeRepository,
    activeSession,
    clock,
    currentRepositoryRef,
    failedSnapshotRef,
    generationRef,
    hydratedRepositoryRef,
    hydrationErrorRepositoryRef,
    hydrationStatus,
    importAbortControllerRef,
    importPromiseRef,
    importSessionRef,
    lastPersistedSnapshotRef,
    latestScheduledSnapshotRef,
    ledgerDataRef,
    mountedRef,
    operationRef,
    operationRepositoryRef,
    operationTokenRef,
    pendingHydrationRef,
    persistenceVersionStateRef,
    publishPersistenceVersionState,
    readOnlyRef,
    reducerDispatch,
    retryAttemptRef,
    setHydrationStatus,
    setIsReadOnly,
    setLedgerEpoch,
    setPersistenceError,
    setPersistenceOperation,
    setResourcePolicyError,
    stopForImportRecoveryFatal,
    trackSessionAcceptedWork,
    writeQueueRef,
  } = deps;
      if (!activeCapabilities.canImportBackup) {
        return Promise.resolve({
          ok: false,
          code: "LEDGER_IMPORT_NOT_ALLOWED",
        });
      }

      if (!acceptingOperationsRef.current) {
        return Promise.resolve({
          ok: false,
          code: "LEDGER_IMPORT_NOT_ALLOWED",
        });
      }

      if (
        operationRef.current === "importing" &&
        operationRepositoryRef.current === activeRepository &&
        importPromiseRef.current !== null
      ) {
        return importPromiseRef.current;
      }

      const currentRetryAttempt = retryAttemptRef.current;
      if (
        currentRetryAttempt?.generation === generationRef.current &&
        currentRetryAttempt.version ===
          persistenceVersionStateRef.current.mutationVersion
      ) {
        return Promise.resolve({ ok: false, code: "LEDGER_IMPORT_NOT_ALLOWED" });
      }

      const canImportReadyLedger =
        hydrationStatus === "ready" &&
        hydratedRepositoryRef.current === activeRepository &&
        !readOnlyRef.current;
      const canRecoverHydrationError =
        hydrationStatus === "error" &&
        hydrationErrorRepositoryRef.current === activeRepository;
      const operationSession = activeSession;
      const isReadyLedgerFileImport =
        operationSession?.storageKind === "ledger-file";
      const versionState = persistenceVersionStateRef.current;
      const hasCleanReadyLedgerFileState =
        canImportReadyLedger &&
        versionState.mutationVersion === versionState.persistedVersion &&
        versionState.persistenceStatus !== "saving" &&
        versionState.persistenceStatus !== "error" &&
        latestScheduledSnapshotRef.current === null &&
        failedSnapshotRef.current === null &&
        retryAttemptRef.current === null &&
        operationSession?.readyImportPort !== null &&
        evidence !== undefined;

      if (
        operationRef.current !== "idle" ||
        (isReadyLedgerFileImport
          ? !hasCleanReadyLedgerFileState
          : !canImportReadyLedger && !canRecoverHydrationError)
      ) {
        return Promise.resolve({ ok: false, code: "LEDGER_IMPORT_NOT_ALLOWED" });
      }

      const ledgerResult = validateLedgerData(candidate);
      if (!ledgerResult.ok || !evaluateLedgerResourcePolicy(ledgerResult.value).ok) {
        return Promise.resolve({ ok: false, code: "LEDGER_IMPORT_INVALID_BACKUP" });
      }
      if (
        isReadyLedgerFileImport &&
        evidence?.requireHistoricalRawText === true &&
        ledgerResult.value.trades.some(
          (trade) =>
            typeof trade.rawText !== "string" ||
            trade.rawText.trim().length === 0,
        )
      ) {
        return Promise.resolve({
          ok: false,
          code: "LEDGER_IMPORT_INVALID_BACKUP",
        });
      }

      const importPolicy = validateLedgerImportPolicy(
        ledgerResult.value,
        timeSnapshot?.todayKey ?? captureLedgerTime(clock).todayKey,
      );
      if (!importPolicy.ok) {
        return Promise.resolve({
          ok: false,
          code: "LEDGER_IMPORT_INVALID_BACKUP",
          errors: importPolicy.errors,
        });
      }

      const validatedLedger = ledgerResult.value;
      const serializedCandidate = JSON.stringify(validatedLedger);
      const authorizedCandidateIdentity =
        evidence?.candidateIdentity ?? serializedCandidate;
      const operationToken = Symbol("import-ledger");
      const operationRepository = activeRepository;
      const hookGeneration = generationRef.current;
      const precedingQueue = writeQueueRef.current.catch(
        () => undefined,
      );
      const importController = new AbortController();
      const abortFromCaller = () =>
        importController.abort(externalSignal?.reason);
      if (externalSignal?.aborted) {
        abortFromCaller();
      } else {
        externalSignal?.addEventListener("abort", abortFromCaller, {
          once: true,
        });
      }
      operationRef.current = "importing";
      operationRepositoryRef.current = operationRepository;
      operationTokenRef.current = operationToken;
      importAbortControllerRef.current = importController;
      importSessionRef.current = operationSession;

      if (mountedRef.current) {
        setPersistenceOperation("importing");
      }

      let resolveImport!: (result: ImportLedgerResult) => void;
      const registeredImport = new Promise<ImportLedgerResult>(
        (resolve) => {
          resolveImport = resolve;
        },
      );
      const importPromise = registeredImport
        .finally(() => {
          externalSignal?.removeEventListener(
            "abort",
            abortFromCaller,
          );
          if (
            operationTokenRef.current !== operationToken ||
            currentRepositoryRef.current !== operationRepository
          ) {
            return;
          }

          operationRef.current = "idle";
          operationRepositoryRef.current = null;
          operationTokenRef.current = null;
          importPromiseRef.current = null;
          if (
            importAbortControllerRef.current === importController
          ) {
            importAbortControllerRef.current = null;
            importSessionRef.current = undefined;
          }

          if (mountedRef.current) {
            setPersistenceOperation("idle");
          }
        });

      importPromiseRef.current = importPromise;
      writeQueueRef.current = Promise.all([
        precedingQueue,
        importPromise,
      ]).then(() => undefined);
      trackSessionAcceptedWork(operationSession, importPromise);

      const executeImport = async (): Promise<ImportLedgerResult> => {
        if (importController.signal.aborted) {
          return { ok: false, code: "LEDGER_IMPORT_CANCELLED" };
        }

        let verifiedLedger = validatedLedger;
        if (isReadyLedgerFileImport) {
          const importPort = operationSession?.readyImportPort;
          if (!importPort || !evidence) {
            return {
              ok: false,
              code: "LEDGER_IMPORT_NOT_ALLOWED",
            };
          }
          const authorization = importPort.authorizeReadyImport(
            evidence,
            hookGeneration,
            authorizedCandidateIdentity,
          );
          if (!authorization) {
            return {
              ok: false,
              code: "LEDGER_IMPORT_NOT_ALLOWED",
            };
          }
          try {
            verifiedLedger = await importPort.importReadyLedger(
              authorization,
              validatedLedger,
              importController.signal,
            );
          } catch (error) {
            if (
              error instanceof LedgerFileRepositoryError &&
              error.code ===
                LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_RECOVERY_BLOCKED
            ) {
              stopForImportRecoveryFatal(
                translateDefault("persistence.importRecoveryBlocked"),
              );
              return {
                ok: false,
                code: "LEDGER_IMPORT_RECOVERY_BLOCKED",
              };
            }
            if (
              error instanceof LedgerFileRepositoryError &&
              error.code ===
                LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_FAILED_BASE_RESTORED
            ) {
              if (mountedRef.current) {
                setPersistenceError(
                  translateDefault("persistence.importBaseRestored"),
                );
              }
              return {
                ok: false,
                code: "LEDGER_IMPORT_BASE_RESTORED",
              };
            }
            if (
              error instanceof LedgerFileRepositoryError &&
              error.code ===
                LEDGER_FILE_REPOSITORY_ERROR_CODES.IMPORT_AUTHORIZATION_FAILED
            ) {
              return {
                ok: false,
                code: importController.signal.aborted
                  ? "LEDGER_IMPORT_CANCELLED"
                  : "LEDGER_IMPORT_NOT_ALLOWED",
              };
            }
            if (
              error instanceof LedgerFileRepositoryError &&
              error.code ===
                LEDGER_FILE_REPOSITORY_ERROR_CODES.EXTERNAL_CHANGE
            ) {
              if (mountedRef.current) {
                setPersistenceError(
                  translateDefault("persistence.importExternalChange"),
                );
              }
              return {
                ok: false,
                code: "LEDGER_IMPORT_SOURCE_CHANGED",
              };
            }
            if (importController.signal.aborted) {
              return {
                ok: false,
                code: "LEDGER_IMPORT_CANCELLED",
              };
            }
            if (mountedRef.current) {
              setPersistenceError(
                translateDefault("persistence.importWriteFailed"),
              );
            }
            return {
              ok: false,
              code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
            };
          }
        } else {
          try {
            await precedingQueue;
            await operationRepository.save(validatedLedger);
          } catch {
            return {
              ok: false,
              code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
            };
          }
        }

        if (
          JSON.stringify(verifiedLedger) !== serializedCandidate
        ) {
          stopForImportRecoveryFatal(
            translateDefault("persistence.importCandidateMismatch"),
          );
          return {
            ok: false,
            code: "LEDGER_IMPORT_RECOVERY_BLOCKED",
          };
        }

        if (
          mountedRef.current &&
          currentRepositoryRef.current === operationRepository &&
          operationTokenRef.current === operationToken &&
          generationRef.current === hookGeneration
        ) {
          generationRef.current += 1;
          ledgerDataRef.current = verifiedLedger;
          lastPersistedSnapshotRef.current = serializedCandidate;
          latestScheduledSnapshotRef.current = null;
          failedSnapshotRef.current = null;
          retryAttemptRef.current = null;
          pendingHydrationRef.current = null;
          hydratedRepositoryRef.current = operationRepository;
          hydrationErrorRepositoryRef.current = null;
          publishPersistenceVersionState({
            mutationVersion: 0,
            persistedVersion: 0,
            persistenceStatus: "saved",
          });
          reducerDispatch({
            type: "ledger/replace",
            ledgerData: verifiedLedger,
          });
          setPersistenceError(null);
          setResourcePolicyError(null);
          readOnlyRef.current = false;
          setIsReadOnly(false);
          setHydrationStatus("ready");
          setLedgerEpoch((current) => current + 1);
        }

        return { ok: true };
      };

      void executeImport().then(
        resolveImport,
        () =>
          resolveImport({
            ok: false,
            code: LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
          }),
      );
      return importPromise;
    
}
