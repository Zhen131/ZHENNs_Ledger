"use client";

import type {
  ChangeEvent,
  RefObject,
} from "react";
import type { PersistenceOperation } from "@/app";
import type { Translate } from "@/ui";



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
