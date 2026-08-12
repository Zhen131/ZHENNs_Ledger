"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import packageJson from "../../../package.json";
import { downloadBackupJson } from "../../backup/backupDownload";
import {
  createBackupEnvelope,
  serializeBackupEnvelope,
  type BackupEnvelopeError,
} from "../../backup/backupEnvelope";
import {
  confirmBackupImportSuspiciousGroups,
  createLedgerBackupImportEvidence,
  isBackupImportSuspicionConfirmationValid,
  preflightBackupJson,
  revokeBackupImportPreflightReceipt,
  type BackupImportPreflightResult,
  type BackupPreflightDetail,
  type BackupSuspicionConfirmationReceipt,
  type LedgerBackupImportEvidence,
} from "../../backup/backupImportPreflight";
import { formatBackupImportReportMarkdown } from "../../backup/backupImportReport";
import type { PersistenceOperation } from "../../hooks/usePersistentLedger";
import type { LedgerData } from "@/core/models";
import type { HydrationStatus } from "../../state/hydrationState";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import {
  evaluateLedgerByteLengthResourcePolicy,
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "@/core/validation";

type ImportState =
  | "idle"
  | "reading"
  | "preflighting"
  | "preflight-blocked"
  | "ready-without-suspicions"
  | "awaiting-suspicion-confirmation"
  | "awaiting-confirmation"
  | "importing"
  | "success"
  | "write-error";

type CopyState = "idle" | "copying" | "copied" | "error";

type BackupControlsProps = {
  clock?: LedgerClock;
  ledgerData: LedgerData;
  hydrationStatus: HydrationStatus;
  persistenceOperation: PersistenceOperation;
  persistenceStatus: "idle" | "saving" | "saved" | "error";
  isReadOnly: boolean;
  isDirty: boolean;
  /**
   * This capability controls only the final write. Pure B preflight remains
   * available to a ready C session while this value is false.
   */
  canImportBackup?: boolean;
  requiresHistoricalRawText?: boolean;
  preflight?: typeof preflightBackupJson;
  onImport: (
    candidate: LedgerData,
    timeSnapshot?: LedgerTimeSnapshot,
    evidence?: LedgerBackupImportEvidence,
    signal?: AbortSignal,
  ) => Promise<{
    ok: boolean;
    code?: string;
    errors?: BackupEnvelopeError[];
  }>;
};

export function BackupControls({
  clock = systemLedgerClock,
  ledgerData,
  hydrationStatus,
  persistenceOperation,
  persistenceStatus,
  isReadOnly,
  isDirty,
  canImportBackup = true,
  requiresHistoricalRawText = !canImportBackup,
  preflight = preflightBackupJson,
  onImport,
}: Readonly<BackupControlsProps>) {
  const [importState, setImportState] = useState<ImportState>("idle");
  const [message, setMessage] = useState("");
  const [importErrors, setImportErrors] = useState<BackupEnvelopeError[]>([]);
  const [preflightResult, setPreflightResult] =
    useState<BackupImportPreflightResult | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const selectedPreflightRef =
    useRef<BackupImportPreflightResult | null>(null);
  const suspicionConfirmationRef =
    useRef<BackupSuspicionConfirmationReceipt | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectionGenerationRef = useRef(0);
  const importAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importAbortControllerRef.current?.abort();
      selectionGenerationRef.current += 1;
      if (selectedPreflightRef.current) {
        revokeBackupImportPreflightReceipt(
          selectedPreflightRef.current,
        );
      }
      selectedPreflightRef.current = null;
      suspicionConfirmationRef.current = null;
    };
  }, []);

  const showExport = hydrationStatus === "ready";
  const showPreflight =
    (hydrationStatus === "ready" && !isReadOnly) ||
    hydrationStatus === "error";
  const canExport = showExport && persistenceOperation === "idle";
  const canSelect =
    showPreflight &&
    persistenceOperation === "idle" &&
    importState !== "importing";
  const canCommit =
    canImportBackup &&
    persistenceOperation === "idle" &&
    preflightResult?.hardErrorCount === 0 &&
    preflightResult.candidate !== undefined &&
    preflightResult.candidateIdentity !== undefined &&
    hasCurrentSuspicionConfirmation(
      preflightResult,
      suspicionConfirmationRef.current,
    );

  function resetFileSelection() {
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

  function cancelSelection() {
    resetFileSelection();
    setImportState("idle");
  }

  function handleExport() {
    const exportedAt = captureLedgerTime(clock).now.toISOString();
    const envelopeResult = createBackupEnvelope(ledgerData, {
      appVersion: packageJson.version,
      exportedAt,
    });

    if (!envelopeResult.ok) {
      setMessage("无法导出：当前账本未通过结构校验。");
      return;
    }

    const serialized = serializeBackupEnvelope(envelopeResult.value);
    const bytePolicy = evaluateLedgerJsonResourcePolicy(serialized);
    if (!bytePolicy.ok) {
      setMessage(
        "无法导出：当前 v1 无法安全导出该超大账本；未创建备份文件。",
      );
      return;
    }

    const ledgerPolicy = evaluateLedgerResourcePolicy(ledgerData);
    if (!isReadOnly && !ledgerPolicy.ok) {
      setMessage("无法导出：当前账本超过资源上限。");
      return;
    }

    const downloadResult = downloadBackupJson(serialized, exportedAt);
    if (!downloadResult.ok) {
      setMessage(
        "导出过程中出现异常，无法确认下载是否成功；请检查浏览器下载列表后再重试。",
      );
      return;
    }

    setMessage(
      isReadOnly
        ? "已发起只读救援备份下载。备份为明文、未加密，可能因集合或字符串超限而无法由当前版本重新导入；请检查浏览器下载是否成功及实际保存位置，并将文件移至安全位置或在不再需要时删除。"
        : isDirty ||
            persistenceStatus === "saving" ||
              persistenceStatus === "error"
          ? "已发起救援备份下载。备份为明文、未加密，包含当前页面数据，可能新于最后成功保存的版本；请检查浏览器下载是否成功及实际保存位置，并将文件移至安全位置或在不再需要时删除。"
          : "已发起备份下载。备份为明文、未加密；请检查浏览器下载是否成功及实际保存位置，并将文件移至安全位置或在不再需要时删除。",
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
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
      setMessage("无法导入：文件超过 8 MiB 限制。");
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
          setMessage("无法读取备份文件。");
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
          // C's new historical path is strict. Existing generic rescue restore
          // keeps the optional rawText schema contract.
          requireHistoricalRawText: requiresHistoricalRawText,
        });
      } catch {
        if (isCurrentSelection(selectionGeneration)) {
          setImportState("preflight-blocked");
          setMessage("预检执行失败；未写入当前账本或 C 文件。");
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
        setMessage("预检发现硬错误；不得继续导入。");
        return;
      }
      if (result.suspiciousGroupCount > 0) {
        setImportState("awaiting-suspicion-confirmation");
        setMessage(
          "预检没有硬错误，但发现可疑重复组；应用未自动修改、删除、合并或去重。",
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
          ? "预检通过；确认后才会进入既有备份恢复写入。"
          : "预检通过；当前 C 只开放只读预检，未调用导入或保存写入口。",
      );
    })();
  }

  function confirmSuspiciousGroups() {
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
        ? "已确认当前可疑组；仍未写入，需再次确认完整覆盖。"
        : "已确认当前可疑组；当前 C 仍只开放只读预检，未调用任何写入口。",
    );
  }

  async function copyPreflightReport() {
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

  async function confirmImport() {
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
      resetFileSelection();
      setImportState("success");
      setMessage("备份已恢复并保存到本地。");
      return;
    }

    if (importResult.errors) {
      setImportErrors(importResult.errors);
    }
    setImportState("write-error");
    setMessage(
      importResult.code === "LEDGER_IMPORT_NOT_ALLOWED"
        ? "当前状态不允许恢复备份。"
        : importResult.code === "LEDGER_IMPORT_INVALID_BACKUP"
          ? "备份内容未通过校验。"
          : importResult.code === "LEDGER_IMPORT_CANCELLED"
            ? "已取消导入；当前页面未替换。"
            : importResult.code === "LEDGER_IMPORT_BASE_RESTORED"
              ? "导入未完成；已复读确认 C 恢复为导入前的完整版本，当前页面未变更。"
              : importResult.code === "LEDGER_IMPORT_SOURCE_CHANGED"
                ? "导入写入前发现 C 已发生外部变化；本次导入没有写入，请重新打开该 C。"
                : importResult.code === "LEDGER_IMPORT_RECOVERY_BLOCKED"
                  ? "无法确认导入结果，也无法证明 C 已恢复；当前会话已停止写入，请立即锁定并保留文件用于恢复。"
                  : "导入失败；当前页面未变更。没有取得可进一步确认底层存储状态的证据，请按错误提示处理。",
    );
  }

  function isCurrentSelection(selectionGeneration: number): boolean {
    return (
      mountedRef.current &&
      selectionGenerationRef.current === selectionGeneration
    );
  }

  function isSamePreflight(
    selectionGeneration: number,
    contentIdentity: string,
  ): boolean {
    return (
      isCurrentSelection(selectionGeneration) &&
      selectedPreflightRef.current?.contentIdentity.value === contentIdentity
    );
  }

  return (
    <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
        账本备份是未加密明文，任何能访问文件的人都可能读取完整资产、交易和价格。导出只会发起浏览器下载，请确认实际下载结果和保存位置，并将文件移至安全位置或在不再需要时删除。若保存到
        iCloud Drive、OneDrive 等同步目录，系统可能自动上传或同步。
      </p>
      <div className="flex flex-wrap gap-3">
        {showExport ? (
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canExport}
            onClick={handleExport}
            type="button"
          >
            导出完整账本备份
          </button>
        ) : null}
        {showPreflight ? (
          <label className="w-fit cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            选择备份文件并预检
            <input
              accept="application/json,.json"
              aria-label="选择账本备份文件"
              className="sr-only"
              disabled={!canSelect}
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
          </label>
        ) : null}
      </div>

      {hydrationStatus === "loading" ? <p>读取完成前不可预检、导入或导出。</p> : null}
      {hydrationStatus === "error" ? (
        <>
          <p>可使用有效备份恢复本地账本。</p>
          <p>系统会先做纯预检；只有具备写入 capability 时才可恢复。</p>
        </>
      ) : null}
      {isReadOnly ? (
        <p>当前账本只读，仅可导出受 8 MiB 限制的救援备份；备份可能因集合或字符串超限而无法由当前版本重新导入；当前只读保护禁止预检后覆盖超限账本。</p>
      ) : null}
      {persistenceStatus === "saving" || persistenceStatus === "error" ? (
        <p>可导出当前页面账本作为救援备份。备份为明文，可能新于最后成功保存的版本。</p>
      ) : null}

      {importState === "reading" || importState === "preflighting" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p aria-live="polite">
            {importState === "reading"
              ? "正在读取备份文件。"
              : "正在执行只读预检；不会写入当前账本或 C 文件。"}
          </p>
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
            onClick={cancelSelection}
            type="button"
          >
            取消
          </button>
        </div>
      ) : null}

      {preflightResult ? (
        <PreflightReportView
          copyState={copyState}
          onCopy={() => void copyPreflightReport()}
          result={preflightResult}
        />
      ) : null}

      {importState === "awaiting-suspicion-confirmation" ? (
        <div className="grid gap-3 border-t border-slate-200 pt-3">
          <p className="font-medium text-amber-900">
            请核对报告中的全部可疑重复组。确认只表示你已阅读告警，不会自动删除、合并或修改交易。
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md bg-amber-700 px-3 py-2 font-medium text-white"
              onClick={confirmSuspiciousGroups}
              type="button"
            >
              我已核对全部可疑组
            </button>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
              onClick={cancelSelection}
              type="button"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {importState === "awaiting-confirmation" ? (
        <div className="grid gap-3 border-t border-slate-200 pt-3">
          <p className="font-medium text-amber-900">
            {hydrationStatus === "error"
              ? "恢复成功后覆盖损坏 record；失败保留原 record。"
              : isDirty
                ? "导入将完整覆盖当前账本，不合并数据。页面中尚未落盘的数据也会被覆盖；可先导出救援备份。"
                : "导入将完整覆盖当前账本，不合并数据。"}
          </p>
          <p className="text-sm leading-6 text-amber-900">
            你选择的原备份文件仍是未加密明文；本应用不会移动、删除或主动上传该文件。若原文件位于
            iCloud Drive、OneDrive 等同步目录，系统可能自动同步。
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md bg-slate-950 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canCommit}
              onClick={() => void confirmImport()}
              type="button"
            >
              确认恢复备份
            </button>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
              onClick={cancelSelection}
              type="button"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {importState === "ready-without-suspicions" && !canImportBackup ? (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">
          当前 C 仅开放 B 的只读预检与报告复制；没有导入写 capability，本次操作未调用
          save、clear 或任何 C writable。
        </p>
      ) : null}

      {importState === "preflight-blocked" ||
      (preflightResult &&
        importState === "ready-without-suspicions") ? (
        <button
          className="w-fit rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
          onClick={cancelSelection}
          type="button"
        >
          取消
        </button>
      ) : null}

      {importState === "preflight-blocked" && preflightResult ? (
        <p className="font-medium text-red-800">
          存在硬错误；“继续导入”不可用，也不能被可疑组确认绕过。
        </p>
      ) : null}

      {importState === "importing" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p aria-live="polite">
            正在写入并复读验证 C；若写入已经开始，取消时会尝试恢复并复读导入前的完整
            C；如果无法确认恢复，当前会话会停止后续写入并明确报错。
          </p>
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
            onClick={cancelSelection}
            type="button"
          >
            取消
          </button>
        </div>
      ) : null}

      {importErrors.length > 0 ? (
        <div aria-live="polite" className="grid gap-2 text-sm text-red-800">
          <p>
            发现 {importErrors.length} 项导入错误，显示前{" "}
            {Math.min(importErrors.length, 5)} 项。
          </p>
          <ul className="grid gap-1">
            {importErrors.slice(0, 5).map((error, index) => (
              <li key={`${error.code}-${error.path}-${index}`}>
                <code>{error.code}</code> · <code>{error.path}</code> ·{" "}
                {error.message}
                {"limit" in error
                  ? `（限制 ${error.limit}，实际 ${error.actual}）`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {message ? <p aria-live="polite">{message}</p> : null}
    </div>
  );
}

function PreflightReportView({
  copyState,
  onCopy,
  result,
}: Readonly<{
  copyState: CopyState;
  onCopy: () => void;
  result: BackupImportPreflightResult;
}>) {
  return (
    <section className="grid gap-3 border-t border-slate-200 pt-3">
      <h3 className="font-semibold text-slate-900">B 历史导入预检报告</h3>
      <p className="text-sm text-amber-900">
        隐私提醒：报告可能包含交易日期、资产、买卖方向、数量和金额；复制前请确认目标位置安全。
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm text-slate-700">
        <div>
          <dt className="text-slate-500">应用版本</dt>
          <dd>{result.metadata?.appVersion ?? "不可得"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">导出时间</dt>
          <dd>{result.metadata?.exportedAt ?? "不可得"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">资产</dt>
          <dd>{result.metadata?.assetCount ?? "不可得"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">交易</dt>
          <dd>{result.metadata?.tradeCount ?? "不可得"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">价格快照</dt>
          <dd>{result.metadata?.priceSnapshotCount ?? "不可得"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">手续费规则</dt>
          <dd>{result.metadata?.feeRuleCount ?? "不可得"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">硬错误</dt>
          <dd>{result.hardErrorCount}</dd>
        </div>
        <div>
          <dt className="text-slate-500">可疑重复组</dt>
          <dd>{result.suspiciousGroupCount}</dd>
        </div>
      </dl>
      <p className="break-all text-xs text-slate-600">
        B SHA-256：<code>{result.contentIdentity.sha256}</code>
      </p>
      {result.hardErrorCount > 0 ? (
        <p>
          发现 {result.hardErrorCount} 项导入错误，页面显示前{" "}
          {Math.min(
            result.hardErrorCount,
            result.visibleDetails.filter(
              (detail) => detail.kind === "hard-error",
            ).length,
          )}{" "}
          项。
        </p>
      ) : null}

      {result.visibleDetails.length > 0 ? (
        <ol
          aria-label="预检详情（页面最多 50 项）"
          className="grid max-h-80 gap-2 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-sm"
        >
          {result.visibleDetails.map((detail, index) => (
            <li key={detailKey(detail, index)}>
              {detail.kind === "hard-error" ? (
                <>
                  <strong>硬错误</strong> · <code>{detail.code}</code> ·{" "}
                  <code>{detail.path}</code> · {detail.message}
                  {detail.line !== undefined && detail.column !== undefined
                    ? `（第 ${detail.line} 行，第 ${detail.column} 列）`
                    : ""}
                </>
              ) : (
                <>
                  <strong>
                    {detail.group.level === "high"
                      ? "高度可疑"
                      : "一般可疑"}
                  </strong>{" "}
                  ·{" "}
                  {detail.group.tradePaths.map((path) => (
                    <code className="mr-1" key={path}>
                      {path}
                    </code>
                  ))}
                  · 未自动修改、删除、合并或去重
                </>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p>未发现硬错误或可疑重复组。</p>
      )}

      <p className="text-sm text-slate-700">
        页面显示前 {result.visibleDetails.length} 项；复制报告保留{" "}
        {result.retainedDetailCount} / {result.totalDetailCount} 项。
        {result.truncated
          ? " 第 1001 项后已截断，请修正后重新检查。"
          : ""}
      </p>
      {result.skippedChecks.length > 0 ? (
        <div className="text-sm text-amber-900">
          <p>以下检查未安全执行，不能写成通过：</p>
          <ul>
            {result.skippedChecks.map(({ check, reason }) => (
              <li key={check}>
                <code>{check}</code> · {reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={copyState === "copying"}
          onClick={onCopy}
          type="button"
        >
          复制 Markdown 报告
        </button>
        {copyState === "copying" ? <span>正在复制报告。</span> : null}
        {copyState === "copied" ? <span>报告已复制。</span> : null}
        {copyState === "error" ? (
          <span className="text-red-800">
            复制失败；没有把本次操作标记为已复制。
          </span>
        ) : null}
      </div>
    </section>
  );
}

function hasCurrentSuspicionConfirmation(
  result: BackupImportPreflightResult,
  confirmation: BackupSuspicionConfirmationReceipt | null = null,
): boolean {
  return isBackupImportSuspicionConfirmationValid(
    result,
    confirmation,
  );
}

function detailKey(detail: BackupPreflightDetail, index: number): string {
  return detail.kind === "hard-error"
    ? `hard-${detail.stage}-${detail.code}-${detail.path}-${index}`
    : `group-${detail.group.tradeIndices.join("-")}-${index}`;
}
