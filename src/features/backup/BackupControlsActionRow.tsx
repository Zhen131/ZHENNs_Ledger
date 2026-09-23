"use client";

import type {
  ChangeEvent,
  RefObject,
} from "react";
import type { PersistenceOperation } from "@/app";
import type { useLanguage } from "@/ui";



export function BackupControlsActionRow({
  canExport,
  canSelect,
  fileInputRef,
  handleExport,
  handleFileChange,
  persistenceOperation,
  presentation,
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
  presentation: "legacy" | "transfer";
  showExport: boolean;
  showPreflight: boolean;
  t: ReturnType<typeof useLanguage>["t"];
}>) {
  return (
      <div
        className={
          presentation === "transfer"
            ? "grid gap-3 min-[1100px]:grid-cols-[minmax(220px,.7fr)_minmax(0,1.3fr)]"
            : "flex flex-wrap gap-3"
        }
      >
        {showExport ? (
          <button
            aria-describedby={persistenceOperation !== "idle" ? "backup-controls-disabled-reason" : undefined}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canExport}
            onClick={handleExport}
            type="button"
          >
            {presentation === "transfer"
              ? t("backup.action.exportPlaintext")
              : t("backup.action.export")}
          </button>
        ) : null}
        {showPreflight ? (
          <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-center font-medium text-slate-800 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            {presentation === "transfer"
              ? t("backup.action.selectPlaintext")
              : t("backup.action.select")}
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
