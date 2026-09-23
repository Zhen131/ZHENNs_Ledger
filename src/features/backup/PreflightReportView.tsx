"use client";

import {
  type BackupImportPreflightResult,
  type BackupPreflightDetail,
} from "./backupImportPreflightResult";
import { LedgerNumber, useLanguage } from "@/ui";
import type { CopyState } from "./backupControlsTypes";

export function PreflightReportView({
  copyState,
  onCopy,
  result,
}: Readonly<{
  copyState: CopyState;
  onCopy: () => void;
  result: BackupImportPreflightResult;
}>) {
  const { t } = useLanguage();
  const unavailable = t("backup.report.unavailable");
  return (
    <section className="grid gap-3 border-t border-slate-200 pt-3">
      <h3 className="font-semibold text-slate-900">{t("backup.report.heading")}</h3>
      <p className="text-sm text-amber-900">
        {t("backup.report.privacy")}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm text-slate-700">
        <div>
          <dt className="text-slate-500">{t("backup.report.sourceFile")}</dt>
          <dd>{result.metadata?.sourceFileName ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.backupSchema")}</dt>
          <dd>
            {result.metadata?.backupFormatVersion ?? unavailable} /{" "}
            {result.metadata?.ledgerSchemaVersion ?? unavailable}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.appVersion")}</dt>
          <dd>{result.metadata?.appVersion ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.exportedAt")}</dt>
          <dd>{result.metadata?.exportedAt ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.assets")}</dt>
          <dd>{result.metadata?.assetCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.trades")}</dt>
          <dd>{result.metadata?.tradeCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.cashEvents")}</dt>
          <dd>{result.metadata?.cashEventCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.assetTransfers")}</dt>
          <dd>{result.metadata?.assetTransferCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.priceSnapshots")}</dt>
          <dd>{result.metadata?.priceSnapshotCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.feeRules")}</dt>
          <dd>{result.metadata?.feeRuleCount ?? unavailable}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.cashBalance")}</dt>
          <dd>
            {result.metadata?.cashBalance === undefined ? (
              unavailable
            ) : (
              <LedgerNumber kind="money" value={result.metadata.cashBalance} />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.cashDeficit")}</dt>
          <dd>
            {result.metadata?.cashDeficit === undefined ? (
              unavailable
            ) : (
              <LedgerNumber kind="money" value={result.metadata.cashDeficit} />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.hardErrors")}</dt>
          <dd>{result.hardErrorCount}</dd>
        </div>
        <div>
          <dt className="text-slate-500">{t("backup.report.suspiciousGroups")}</dt>
          <dd>{result.suspiciousGroupCount}</dd>
        </div>
      </dl>
      <p className="text-sm text-slate-700">
        {t("backup.report.missingMapping")}
        {result.metadata?.missingMappingSymbols === undefined
          ? unavailable
          : result.metadata.missingMappingSymbols.length === 0
            ? t("backup.report.none")
            : result.metadata.missingMappingSymbols.join(t("backup.pairing.separator"))}
      </p>
      {result.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p>{t("backup.report.warnings")}</p>
          <ul>
            {result.warnings.map((warning) => (
              <li key={warning.code}>
                <code>{warning.code}</code> · {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="break-all text-xs text-slate-600">
        {t("backup.report.sha256")}<code>{result.contentIdentity.sha256}</code>
      </p>
      {result.hardErrorCount > 0 ? (
        <p>
          {t("backup.errors.foundPrefix")} {result.hardErrorCount} {t("backup.errors.hardErrorVisiblePrefix")}{" "}
          {Math.min(
            result.hardErrorCount,
            result.visibleDetails.filter(
              (detail) => detail.kind === "hard-error",
            ).length,
          )}{" "}
          {t("backup.errors.suffix")}
        </p>
      ) : null}

      {result.visibleDetails.length > 0 ? (
        <ol
          aria-label={t("backup.report.detailsAriaLabel")}
          className="grid max-h-80 gap-2 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 text-sm"
        >
          {result.visibleDetails.map((detail, index) => (
            <li key={detailKey(detail, index)}>
              {detail.kind === "hard-error" ? (
                <>
                  <strong>{t("backup.report.hardErrors")}</strong> · <code>{detail.code}</code> ·{" "}
                  <code>{detail.path}</code> · {detail.message}
                  {detail.line !== undefined && detail.column !== undefined
                    ? `${t("backup.report.locationPrefix")}${detail.line}${t("backup.report.locationMiddle")}${detail.column}${t("backup.report.locationSuffix")}`
                    : ""}
                </>
              ) : (
                <>
                  <strong>
                    {detail.group.level === "high"
                      ? t("backup.report.highSuspicion")
                      : t("backup.report.normalSuspicion")}
                  </strong>{" "}
                  ·{" "}
                  {detail.group.tradePaths.map((path) => (
                    <code className="mr-1" key={path}>
                      {path}
                    </code>
                  ))}
                  · {t("backup.report.notAutoModified")}
                </>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p>{t("backup.report.noIssues")}</p>
      )}

      <p className="text-sm text-slate-700">
        {t("backup.report.visiblePrefix")} {result.visibleDetails.length} {t("backup.report.visibleMiddle")}{" "}
        {result.retainedDetailCount} / {result.totalDetailCount} {t("backup.report.itemsSuffix")}
        {result.truncated
          ? t("backup.report.truncated")
          : ""}
      </p>
      {result.skippedChecks.length > 0 ? (
        <div className="text-sm text-amber-900">
          <p>{t("backup.report.skippedChecks")}</p>
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
          {t("backup.report.copy")}
        </button>
        {copyState === "copying" ? <span>{t("backup.report.copying")}</span> : null}
        {copyState === "copied" ? <span>{t("backup.report.copied")}</span> : null}
        {copyState === "error" ? (
          <span className="text-red-800">
            {t("backup.report.copyFailed")}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function detailKey(detail: BackupPreflightDetail, index: number): string {
  return detail.kind === "hard-error"
    ? `hard-${detail.stage}-${detail.code}-${detail.path}-${index}`
    : `group-${detail.group.tradeIndices.join("-")}-${index}`;
}
