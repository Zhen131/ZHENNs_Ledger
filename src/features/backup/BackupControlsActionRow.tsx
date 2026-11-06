/**
 * 这个文件管备份区最上面那一排按钮。
 * 一个「导出」，一个「选文件」。
 * 点了以后做什么由上层 `BackupControls.tsx` 管。
 * 没有特别的决定。
 */
"use client";

import type {
  ChangeEvent,
  RefObject,
} from "react";
import type { PersistenceOperation } from "@/app";
import type { Translate } from "@/ui";



/**
 * 这个组件画「导出 B 文件」和「选 B 文件」两个按钮。
 * 账本打开好了才显示导出。
 * 正在存盘时按钮不能点，并说明原因。
 */
export function BackupControlsActionRow({
  canExport,
  canSelect,
  fileInputRef,
  handleExport,
  handleFileChange,
  persistenceOperation,
  showExport,
  showPreflight,
  t,
}: Readonly<{
  canExport: boolean;
  canSelect: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleExport: () => void;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  persistenceOperation: PersistenceOperation;
  showExport: boolean;
  showPreflight: boolean;
  t: Translate;
}>) {
  return (
      <div
        className="grid gap-3 min-[1100px]:grid-cols-[minmax(220px,.7fr)_minmax(0,1.3fr)]"
      >
        {showExport ? (
          <button
            aria-describedby={persistenceOperation !== "idle" ? "backup-controls-disabled-reason" : undefined}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canExport}
            onClick={handleExport}
            type="button"
          >
            {t("backup.action.exportPlaintext")}
          </button>
        ) : null}
        {showPreflight ? (
          <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-center font-medium text-slate-800 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            {t("backup.action.selectPlaintext")}
            <input
              accept="application/json,.json"
              aria-describedby={persistenceOperation !== "idle" ? "backup-controls-disabled-reason" : undefined}
              aria-label={t("backup.action.selectAriaLabel")}
              className="sr-only"
              disabled={!canSelect}
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
          </label>
        ) : null}
      </div>
  );
}
