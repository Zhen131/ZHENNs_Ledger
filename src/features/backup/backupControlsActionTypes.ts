/**
 * 这个文件只放备份区动作要用的两个类型，不放会运行的代码。
 * 动作本身在 `backupControlsActions.ts`；那个文件行数到顶，类型挪到这里。
 * 不显然的决定：只挪纯类型，内容逐字不变；2026-11-15 定（W26 04B 追加更正第 1 条）。
 */
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { CopyState, PostImportPairingOperation } from "./backupControlsTypes";
import type {
  BackupImportPreflightResult,
  BackupSuspicionConfirmationReceipt,
} from "./backupImportPreflightResult";
import type { BackupEnvelopeError } from "./backupEnvelope";

/** 备份区出现和离开时要碰的那些引用。 */
export type BackupControlsMountEffectDeps = {
  importAbortControllerRef: RefObject<AbortController | null>;
  mountedRef: RefObject<boolean>;
  pairingOperationRef: RefObject<PostImportPairingOperation | null>;
  selectedPreflightRef: RefObject<BackupImportPreflightResult | null>;
  selectionGenerationRef: RefObject<number>;
  suspicionConfirmationRef: RefObject<BackupSuspicionConfirmationReceipt | null>;
};

/** 清掉已选 B 文件时要碰的引用和设置函数。 */
export type ResetFileSelectionDeps = {
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
