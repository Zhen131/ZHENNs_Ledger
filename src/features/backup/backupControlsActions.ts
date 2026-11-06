/**
 * 这个文件管备份区每个按钮按下后做什么。
 * 按钮有导出、选文件、确认、复制报告、导入。
 * 画面在 `BackupControls.tsx`，导入后的配对在 `backupControlsPairing.ts`。
 * 不显然的决定：换文件、取消、离开页面都让旧的预检作废；2026-07-31 定（W11 03A 第 4.6 节）。
 */
import packageJson from "@root/package.json";
import type {
  ChangeEvent,
  Dispatch,
  RefObject,
  SetStateAction,
} from "react";
import type {
  CopyState,
  ImportState,
  PostImportPairingOperation,
  PostImportPairingState,
} from "./backupControlsTypes";
import type { preflightBackupJson } from "./backupImportPreflight";
import type {
  BackupImportPreflightResult,
  BackupSuspicionConfirmationReceipt,
  LedgerBackupImportEvidence,
} from "./backupImportPreflightResult";
import {
  confirmBackupImportSuspiciousGroups,
  createLedgerBackupImportEvidence,
  revokeBackupImportPreflightReceipt,
} from "./backupImportPreflightReceipts";
import type { BackupEnvelopeError } from "./backupEnvelope";
import type {
  LedgerClock,
  LedgerTimeSnapshot,
} from "@/core/shared";
import type { LedgerData } from "@/core/models";
import type { Translate } from "@/ui";
import { captureLedgerTime } from "@/core/shared";
import {
  createBackupEnvelope,
  serializeBackupEnvelope,
} from "./backupEnvelope";
import { SUPPORTED_LEDGER_SCHEMA_VERSION } from "@/platform/files";
import {
  evaluateLedgerByteLengthResourcePolicy,
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "@/core/validation";
import { downloadBackupJson } from "./backupDownload";
import { formatBackupImportReportMarkdown } from "./backupImportReport";
import { hasCurrentSuspicionConfirmation } from "./backupControlsHelpers";
import { listAssetsMissingBinanceMapping } from "@/features/market-data";

type BackupControlsMountEffectDeps = {
  importAbortControllerRef: RefObject<AbortController | null>;
  mountedRef: RefObject<boolean>;
  pairingOperationRef: RefObject<PostImportPairingOperation | null>;
  selectedPreflightRef: RefObject<BackupImportPreflightResult | null>;
  selectionGenerationRef: RefObject<number>;
  suspicionConfirmationRef: RefObject<BackupSuspicionConfirmationReceipt | null>;
};

/**
 * 这个函数在备份区出现时记下「在了」。
 * 它返回离开时要做的收尾。
 * 离开时：取消进行中的导入和配对，作废这次预检和确认。
 * 不会出错。
 */
export function runBackupControlsMountEffect(
  deps: BackupControlsMountEffectDeps,
) {
  const {
    importAbortControllerRef,
    mountedRef,
    pairingOperationRef,
    selectedPreflightRef,
    selectionGenerationRef,
    suspicionConfirmationRef,
  } = deps;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importAbortControllerRef.current?.abort();
      pairingOperationRef.current?.controller.abort();
      pairingOperationRef.current = null;
      selectionGenerationRef.current += 1;
      if (selectedPreflightRef.current) {
        revokeBackupImportPreflightReceipt(
          selectedPreflightRef.current,
        );
      }
      selectedPreflightRef.current = null;
      suspicionConfirmationRef.current = null;
    };
}

type ResetFileSelectionDeps = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  importAbortControllerRef: RefObject<AbortController | null>;
  selectedPreflightRef: RefObject<BackupImportPreflightResult | null>;
  selectionGenerationRef: RefObject<number>;
  setCopyState: Dispatch<SetStateAction<CopyState>>;
  setImportErrors: Dispatch<SetStateAction<BackupEnvelopeError[]>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPreflightResult: Dispatch<SetStateAction<BackupImportPreflightResult | null>>;
  suspicionConfirmationRef: RefObject<BackupSuspicionConfirmationReceipt | null>;
};

/**
 * 这个函数清掉已选的 B 文件和它的预检结果。
 * 进行中的导入会被取消，预检和确认都作废。
 * 不会出错。
 */
export function doResetFileSelection(
  deps: ResetFileSelectionDeps,
) {
  const {
    fileInputRef,
    importAbortControllerRef,
    selectedPreflightRef,
    selectionGenerationRef,
    setCopyState,
    setImportErrors,
    setMessage,
    setPreflightResult,
    suspicionConfirmationRef,
  } = deps;
    importAbortControllerRef.current?.abort();
    importAbortControllerRef.current = null;
    selectionGenerationRef.current += 1;
    if (selectedPreflightRef.current) {
      revokeBackupImportPreflightReceipt(
        selectedPreflightRef.current,
      );
    }
    selectedPreflightRef.current = null;
    suspicionConfirmationRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setPreflightResult(null);
    setImportErrors([]);
    setCopyState("idle");
    setMessage("");
}

type HandleExportDeps = {
  clock: LedgerClock;
  isDirty: boolean;
  isReadOnly: boolean;
  ledgerData: LedgerData;
  persistenceStatus: "idle" | "saving" | "saved" | "error";
  setMessage: Dispatch<SetStateAction<string>>;
  t: Translate;
};

/**
 * 这个函数处理「导出 B 文件」。
 * 包外壳、变文字、看大小，都过了才交给浏览器下载。
 * 举例：账本有改动还没存上 → 照样导出。
 * 这时提示这是一份救援备份，可能比已存的新。
 * 包不了、太大、超上限、下载出错：显示原因，不下载。
 */
export function doHandleExport(
  deps: HandleExportDeps,
) {
  const {
    clock,
    isDirty,
    isReadOnly,
    ledgerData,
    persistenceStatus,
    setMessage,
    t,
  } = deps;
    const exportTime = captureLedgerTime(clock);
    const exportedAt = exportTime.now.toISOString();
    const envelopeResult = createBackupEnvelope(ledgerData, {
      appVersion: packageJson.version,
      exportedAt,
    }, exportTime.todayKey);

    if (!envelopeResult.ok) {
      setMessage(
        t("backup.export.invalidLedgerPrefix") +
          SUPPORTED_LEDGER_SCHEMA_VERSION +
          t("backup.export.invalidLedgerSuffix"),
      );
      return;
    }

    const serialized = serializeBackupEnvelope(envelopeResult.value);
    const bytePolicy = evaluateLedgerJsonResourcePolicy(serialized);
    if (!bytePolicy.ok) {
      setMessage(
        t("backup.export.tooLargePrefix") +
          SUPPORTED_LEDGER_SCHEMA_VERSION +
          t("backup.export.tooLargeSuffix"),
      );
      return;
    }

    const ledgerPolicy = evaluateLedgerResourcePolicy(ledgerData);
    if (!isReadOnly && !ledgerPolicy.ok) {
      setMessage(t("backup.export.resourceLimit"));
      return;
    }

    const downloadResult = downloadBackupJson(serialized, exportedAt);
    if (!downloadResult.ok) {
      setMessage(
        t("backup.export.exception"),
      );
      return;
    }

    setMessage(
      isReadOnly
          ? t("backup.export.readOnlyRescueStarted")
        : isDirty ||
            persistenceStatus === "saving" ||
              persistenceStatus === "error"
          ? t("backup.export.rescueStarted")
          : t("backup.export.started"),
    );
}

type HandleFileChangeDeps = {
  canImportBackup: boolean;
  clock: LedgerClock;
  dismissPostImportPairing: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  importAbortControllerRef: RefObject<AbortController | null>;
  isCurrentSelection: (selectionGeneration: number) => boolean;
  preflight: typeof preflightBackupJson;
  requiresHistoricalRawText: boolean;
  selectedPreflightRef: RefObject<BackupImportPreflightResult | null>;
  selectionGenerationRef: RefObject<number>;
  setCopyState: Dispatch<SetStateAction<CopyState>>;
  setImportErrors: Dispatch<SetStateAction<BackupEnvelopeError[]>>;
  setImportState: Dispatch<SetStateAction<ImportState>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPreflightResult: Dispatch<SetStateAction<BackupImportPreflightResult | null>>;
  suspicionConfirmationRef: RefObject<BackupSuspicionConfirmationReceipt | null>;
  t: Translate;
};

/**
 * 这个函数处理「选了一个 B 文件」。
 * 先看大小，再读文字，再交给预检。
 * 读的过程中又选了别的文件，旧结果直接丢掉。
 * 预检有硬错误：停下；有疑似重复：等人确认；都没有：等人点导入。
 * 举例：选了一个 200 MiB 的文件 → 不读，直接说文件太大。
 */
export function doHandleFileChange(
  deps: HandleFileChangeDeps,
  event: ChangeEvent<HTMLInputElement>,
) {
  const {
    canImportBackup,
    clock,
    dismissPostImportPairing,
    fileInputRef,
    importAbortControllerRef,
    isCurrentSelection,
    preflight,
    requiresHistoricalRawText,
    selectedPreflightRef,
    selectionGenerationRef,
    setCopyState,
    setImportErrors,
    setImportState,
    setMessage,
    setPreflightResult,
    suspicionConfirmationRef,
    t,
  } = deps;
    dismissPostImportPairing();
    importAbortControllerRef.current?.abort();
    importAbortControllerRef.current = null;
    if (selectedPreflightRef.current) {
      revokeBackupImportPreflightReceipt(
        selectedPreflightRef.current,
      );
    }
    const file = event.target.files?.[0];
    const selectionTimeSnapshot = captureLedgerTime(clock);
    const selectionGeneration = selectionGenerationRef.current + 1;
    selectionGenerationRef.current = selectionGeneration;
    selectedPreflightRef.current = null;
    suspicionConfirmationRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setPreflightResult(null);
    setCopyState("idle");
    setMessage("");
    setImportErrors([]);

    if (!file) {
      setImportState("idle");
      return;
    }

    const bytePolicy = evaluateLedgerByteLengthResourcePolicy(file.size);
    if (!bytePolicy.ok) {
      setImportState("preflight-blocked");
      setMessage(t("backup.import.fileTooLarge"));
      setImportErrors(bytePolicy.errors);
      return;
    }

    setImportState("reading");
    void (async () => {
      let text: string;
      try {
        text = await file.text();
      } catch {
        if (isCurrentSelection(selectionGeneration)) {
          setImportState("preflight-blocked");
          setMessage(t("backup.import.readFailed"));
        }
        return;
      }

      if (!isCurrentSelection(selectionGeneration)) {
        return;
      }

      setImportState("preflighting");
      let result: BackupImportPreflightResult;
      try {
        result = await preflight(text, {
          todayKey: selectionTimeSnapshot.todayKey,
          selectionGeneration,
          sourceFileName: file.name,
          // 平常恢复备份，交易的原句可有可无。
          // 只有明确选了「历史导入」入口，才逐笔要原句。
          // 这条 2026-07-31 定（W11 03A 第 4.3 节第 5 条）。
          requireHistoricalRawText: requiresHistoricalRawText,
        });
      } catch {
        if (isCurrentSelection(selectionGeneration)) {
          setImportState("preflight-blocked");
          setMessage(t("backup.import.preflightFailed"));
        }
        return;
      }

      if (!isCurrentSelection(selectionGeneration)) {
        revokeBackupImportPreflightReceipt(result);
        return;
      }

      selectedPreflightRef.current = result;
      setPreflightResult(result);
      if (result.hardErrorCount > 0) {
        setImportState("preflight-blocked");
        setMessage(t("backup.import.hardErrors"));
        return;
      }
      if (result.suspiciousGroupCount > 0) {
        setImportState("awaiting-suspicion-confirmation");
        setMessage(
          t("backup.import.suspiciousGroups"),
        );
        return;
      }

      setImportState(
        canImportBackup
          ? "awaiting-confirmation"
          : "ready-without-suspicions",
      );
      setMessage(
        canImportBackup
          ? t("backup.import.preflightPassedWritable")
          : t("backup.import.preflightPassedReadOnly"),
      );
    })();
}

type ConfirmSuspiciousGroupsDeps = {
  canImportBackup: boolean;
  selectedPreflightRef: RefObject<BackupImportPreflightResult | null>;
  selectionGenerationRef: RefObject<number>;
  setImportState: Dispatch<SetStateAction<ImportState>>;
  setMessage: Dispatch<SetStateAction<string>>;
  suspicionConfirmationRef: RefObject<BackupSuspicionConfirmationReceipt | null>;
  t: Translate;
};

/**
 * 这个函数处理「疑似重复我看过了，照样导入」。
 * 只对当前这次预检有效；没有疑似重复或已换文件时，什么都不做。
 */
export function doConfirmSuspiciousGroups(
  deps: ConfirmSuspiciousGroupsDeps,
) {
  const {
    canImportBackup,
    selectedPreflightRef,
    selectionGenerationRef,
    setImportState,
    setMessage,
    suspicionConfirmationRef,
    t,
  } = deps;
    const result = selectedPreflightRef.current;
    if (
      !result ||
      result.hardErrorCount > 0 ||
      result.suspiciousGroupCount === 0 ||
      result.selectionGeneration !== selectionGenerationRef.current
    ) {
      return;
    }

    const confirmation =
      confirmBackupImportSuspiciousGroups(result);
    if (!confirmation) {
      return;
    }
    suspicionConfirmationRef.current = confirmation;
    setImportState(
      canImportBackup
        ? "awaiting-confirmation"
        : "ready-without-suspicions",
    );
    setMessage(
      canImportBackup
        ? t("backup.import.suspicionConfirmedWritable")
        : t("backup.import.suspicionConfirmedReadOnly"),
    );
}

type CopyPreflightReportDeps = {
  isSamePreflight: (selectionGeneration: number, contentIdentity: string) => boolean;
  selectedPreflightRef: RefObject<BackupImportPreflightResult | null>;
  selectionGenerationRef: RefObject<number>;
  setCopyState: Dispatch<SetStateAction<CopyState>>;
};

/**
 * 这个函数把预检报告复制到剪贴板。
 * 复制失败就显示失败，不假装复制好了。
 * 复制期间换了文件，结果不再显示。
 */
export async function doCopyPreflightReport(
  deps: CopyPreflightReportDeps,
) {
  const {
    isSamePreflight,
    selectedPreflightRef,
    selectionGenerationRef,
    setCopyState,
  } = deps;
    const result = selectedPreflightRef.current;
    if (
      !result ||
      result.selectionGeneration !== selectionGenerationRef.current
    ) {
      return;
    }

    const generation = result.selectionGeneration;
    const contentIdentity = result.contentIdentity.value;
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(
        formatBackupImportReportMarkdown(result),
      );
    } catch {
      if (isSamePreflight(generation, contentIdentity)) {
        setCopyState("error");
      }
      return;
    }

    if (isSamePreflight(generation, contentIdentity)) {
      setCopyState("copied");
    }
}

type ConfirmImportDeps = {
  canCommit: boolean;
  clock: LedgerClock;
  importAbortControllerRef: RefObject<AbortController | null>;
  isSamePreflight: (selectionGeneration: number, contentIdentity: string) => boolean;
  onImport: (candidate: LedgerData, timeSnapshot?: LedgerTimeSnapshot, evidence?: LedgerBackupImportEvidence, signal?: AbortSignal) => Promise<{ ok: boolean; code?: string; errors?: BackupEnvelopeError[]; }>;
  resetFileSelection: () => void;
  selectedPreflightRef: RefObject<BackupImportPreflightResult | null>;
  selectionGenerationRef: RefObject<number>;
  setImportErrors: Dispatch<SetStateAction<BackupEnvelopeError[]>>;
  setImportState: Dispatch<SetStateAction<ImportState>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPostImportPairing: Dispatch<SetStateAction<PostImportPairingState | null>>;
  suspicionConfirmationRef: RefObject<BackupSuspicionConfirmationReceipt | null>;
  t: Translate;
};

/**
 * 这个函数处理「确认导入」。
 * 它把预检过的账本交给写入那一步。
 * 零硬错误、疑似重复已确认、文件没换，才会去导入。
 * 导入成功后，列出还没配币安对的币，提示可以联网配对。
 * 导入失败：按原因显示。
 * 比如已恢复原样、外部改过、结果不确定。
 */
export async function doConfirmImport(
  deps: ConfirmImportDeps,
) {
  const {
    canCommit,
    clock,
    importAbortControllerRef,
    isSamePreflight,
    onImport,
    resetFileSelection,
    selectedPreflightRef,
    selectionGenerationRef,
    setImportErrors,
    setImportState,
    setMessage,
    setPostImportPairing,
    suspicionConfirmationRef,
    t,
  } = deps;
    const result = selectedPreflightRef.current;
    if (
      !result ||
      !canCommit ||
      result.selectionGeneration !== selectionGenerationRef.current ||
      result.hardErrorCount > 0 ||
      result.candidate === undefined ||
      result.candidateIdentity === undefined ||
      !hasCurrentSuspicionConfirmation(
        result,
        suspicionConfirmationRef.current,
      )
    ) {
      return;
    }

    const generation = result.selectionGeneration;
    const contentIdentity = result.contentIdentity.value;
    const evidence = createLedgerBackupImportEvidence(
      result,
      suspicionConfirmationRef.current,
    );
    if (!evidence) {
      return;
    }
    const importController = new AbortController();
    importAbortControllerRef.current?.abort();
    importAbortControllerRef.current = importController;
    setImportState("importing");
    setMessage("");
    const importResult = await onImport(
      structuredClone(result.candidate),
      captureLedgerTime(clock),
      evidence,
      importController.signal,
    );
    if (importAbortControllerRef.current === importController) {
      importAbortControllerRef.current = null;
    }
    if (!isSamePreflight(generation, contentIdentity)) {
      return;
    }
    if (importResult.ok) {
      const missingMappingSymbols = listAssetsMissingBinanceMapping(
        result.candidate,
      );
      resetFileSelection();
      setImportState("success");
      setMessage(t("backup.import.restored"));
      setPostImportPairing(
        missingMappingSymbols.length === 0
          ? null
          : {
              symbols: missingMappingSymbols,
              status: "prompt",
              message:
                t("backup.pairing.ready"),
              failures: [],
            },
      );
      return;
    }

    if (importResult.errors) {
      setImportErrors(importResult.errors);
    }
    setImportState("write-error");
    setMessage(
      importResult.code === "LEDGER_IMPORT_NOT_ALLOWED"
        ? t("backup.import.statusNotAllowed")
        : importResult.code === "LEDGER_IMPORT_INVALID_BACKUP"
          ? t("backup.import.validationFailed")
          : importResult.code === "LEDGER_IMPORT_CANCELLED"
            ? t("backup.import.cancelled")
            : importResult.code === "LEDGER_IMPORT_BASE_RESTORED"
              ? t("backup.import.restoredOriginal")
              : importResult.code === "LEDGER_IMPORT_SOURCE_CHANGED"
                ? t("backup.import.externalChange")
                : importResult.code === "LEDGER_IMPORT_RECOVERY_BLOCKED"
                  ? t("backup.import.resultUnknown")
                  : t("backup.import.failed"),
    );
}
