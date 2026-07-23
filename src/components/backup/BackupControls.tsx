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
  parseBackupJson,
  serializeBackupEnvelope,
} from "../../backup/backupEnvelope";
import type { PersistenceOperation } from "../../hooks/usePersistentLedger";
import type { LedgerData } from "../../models";
import type { HydrationStatus } from "../../state/hydrationState";
import {
  evaluateLedgerByteLengthResourcePolicy,
  evaluateLedgerJsonResourcePolicy,
  evaluateLedgerResourcePolicy,
} from "../../validators";

type ImportState =
  | "idle"
  | "reading"
  | "invalid"
  | "awaiting-confirmation"
  | "importing"
  | "success"
  | "write-error";

type BackupControlsProps = {
  ledgerData: LedgerData;
  hydrationStatus: HydrationStatus;
  persistenceOperation: PersistenceOperation;
  persistenceStatus: "idle" | "saving" | "saved" | "error";
  isReadOnly: boolean;
  isDirty: boolean;
  onImport: (candidate: LedgerData) => Promise<{
    ok: boolean;
    code?: string;
  }>;
};

export function BackupControls({
  ledgerData,
  hydrationStatus,
  persistenceOperation,
  persistenceStatus,
  isReadOnly,
  isDirty,
  onImport,
}: Readonly<BackupControlsProps>) {
  const [importState, setImportState] = useState<ImportState>("idle");
  const [message, setMessage] = useState("");
  const selectedLedgerRef = useRef<LedgerData | null>(null);
  const selectionGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      selectionGenerationRef.current += 1;
    };
  }, []);

  const canExport =
    hydrationStatus === "ready" && persistenceOperation === "idle";
  const canImport =
    persistenceOperation === "idle" &&
    ((hydrationStatus === "ready" && !isReadOnly) || hydrationStatus === "error");
  const isImporting =
    persistenceOperation === "importing" || importState === "importing";

  function handleExport() {
    const exportedAt = new Date().toISOString();
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
      setMessage("无法导出：备份文件超过 8 MiB 限制。");
      return;
    }

    const ledgerPolicy = evaluateLedgerResourcePolicy(ledgerData);
    if (!isReadOnly && !ledgerPolicy.ok) {
      setMessage("无法导出：当前账本超过资源上限。");
      return;
    }

    downloadBackupJson(serialized, exportedAt);
    setMessage(
      isReadOnly
        ? "已导出只读救援备份。备份文件未加密。"
        : "已导出备份。备份文件未加密。",
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectionGeneration = selectionGenerationRef.current + 1;
    selectionGenerationRef.current = selectionGeneration;
    selectedLedgerRef.current = null;
    setMessage("");

    const file = event.target.files?.[0];
    if (!file) {
      setImportState("idle");
      return;
    }

    const bytePolicy = evaluateLedgerByteLengthResourcePolicy(file.size);
    if (!bytePolicy.ok) {
      setImportState("invalid");
      setMessage("无法导入：文件超过 8 MiB 限制。");
      return;
    }

    setImportState("reading");
    void file.text().then(
      (text) => {
        if (
          !mountedRef.current ||
          selectionGenerationRef.current !== selectionGeneration
        ) {
          return;
        }

        const result = parseBackupJson(text);
        if (!result.ok) {
          setImportState("invalid");
          setMessage("无法导入：备份文件格式或内容无效。");
          return;
        }

        selectedLedgerRef.current = result.value.ledgerData;
        setImportState("awaiting-confirmation");
      },
      () => {
        if (
          mountedRef.current &&
          selectionGenerationRef.current === selectionGeneration
        ) {
          setImportState("invalid");
          setMessage("无法读取备份文件。");
        }
      },
    );
  }

  async function confirmImport() {
    const selectedLedger = selectedLedgerRef.current;
    if (!selectedLedger || !canImport) {
      return;
    }

    setImportState("importing");
    setMessage("");
    const result = await onImport(selectedLedger);
    if (!mountedRef.current) {
      return;
    }
    if (result.ok) {
      selectedLedgerRef.current = null;
      setImportState("success");
      setMessage("备份已恢复并保存到本地。");
      return;
    }

    setImportState("write-error");
    setMessage(
      result.code === "LEDGER_IMPORT_NOT_ALLOWED"
        ? "当前状态不允许恢复备份。"
        : result.code === "LEDGER_IMPORT_INVALID_BACKUP"
          ? "备份内容未通过校验。"
          : "恢复写入失败，当前页面与本地记录未变更。",
    );
  }

  return (
    <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap gap-3">
        {canExport ? (
          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isImporting}
            onClick={handleExport}
            type="button"
          >
            导出完整账本备份
          </button>
        ) : null}
        {canImport ? (
          <label className="w-fit cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            选择备份文件
            <input
              accept="application/json,.json"
              aria-label="选择账本备份文件"
              className="sr-only"
              disabled={isImporting}
              onChange={handleFileChange}
              type="file"
            />
          </label>
        ) : null}
      </div>

      {hydrationStatus === "loading" ? <p>读取完成前不可导入或导出。</p> : null}
      {hydrationStatus === "error" ? <p>可使用有效备份恢复本地账本。</p> : null}
      {isReadOnly ? <p>当前账本只读，仅可导出受 8 MiB 限制的救援备份。</p> : null}
      {persistenceStatus === "saving" || persistenceStatus === "error" ? (
        <p>可导出当前页面账本作为救援备份。</p>
      ) : null}
      {importState === "reading" ? <p aria-live="polite">正在读取备份文件。</p> : null}
      {importState === "awaiting-confirmation" ? (
        <div className="grid gap-3 border-t border-slate-200 pt-3">
          <p className="font-medium text-amber-900">
            {hydrationStatus === "error"
              ? "恢复将替换无法读取的本地记录。"
              : isDirty
                ? "恢复将覆盖当前未保存的页面更改和本地账本。"
                : "恢复将覆盖当前本地账本。"}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md bg-slate-950 px-3 py-2 font-medium text-white"
              onClick={() => void confirmImport()}
              type="button"
            >
              确认恢复备份
            </button>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700"
              onClick={() => {
                selectionGenerationRef.current += 1;
                selectedLedgerRef.current = null;
                setImportState("idle");
                setMessage("");
              }}
              type="button"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
      {importState === "importing" ? (
        <p aria-live="polite">正在恢复备份，请勿关闭页面。</p>
      ) : null}
      {message ? <p aria-live="polite">{message}</p> : null}
    </div>
  );
}
