/**
 * 这个文件管导入后「联网配币安对」那一块的画面。
 * 配对怎么跑在 `backupControlsPairing.ts`。
 * 不显然的决定：只给按钮，不自动联网；2026-08-19 定（W14 01B 第 5.3 节）。
 */
"use client";

import { isPostImportPairingBusy } from "./backupControlsHelpers";
import type {
  ApplyLedgerMutation,
  PostImportPairingState,
} from "./backupControlsTypes";
import type { Translate } from "@/ui";

/**
 * 这个组件画导入后的配对提示。
 * 列出还没配币安对的币。
 * 给「联网自动配对」和「稍后处理」两个按钮。
 * 跑完后显示结论和每种币的失败原因。
 * 账本不能写时，说明现在配不了。
 */
export function BackupControlsPairingPanel({
  applyLedgerMutation,
  dismissPostImportPairing,
  isWritable,
  postImportPairing,
  startPostImportPairing,
  t,
}: Readonly<{
  applyLedgerMutation: ApplyLedgerMutation | undefined;
  dismissPostImportPairing: () => void;
  isWritable: boolean;
  postImportPairing: PostImportPairingState;
  startPostImportPairing: () => Promise<void>;
  t: Translate;
}>) {
  return (
        <section
          aria-label={t("backup.pairing.ariaLabel")}
          className="grid gap-3 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950"
        >
          <h3 className="font-semibold">{t("backup.pairing.heading")}</h3>
          <p aria-live="polite">{postImportPairing.message}</p>
          <p>
            {t("backup.pairing.pending")}<strong>{postImportPairing.symbols.join(t("backup.pairing.separator"))}</strong>
          </p>
          {postImportPairing.failures.length > 0 ? (
            <ul className="grid gap-1 text-red-800">
              {postImportPairing.failures.map((failure, index) => (
                <li key={`${failure.assetSymbol}-${failure.code}-${index}`}>
                  <strong>{failure.assetSymbol}</strong> ·{" "}
                  <code>{failure.code}</code> · {failure.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md bg-sky-900 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                isPostImportPairingBusy(postImportPairing.status) ||
                !isWritable ||
                !applyLedgerMutation
              }
              onClick={() => void startPostImportPairing()}
              type="button"
            >
              {isPostImportPairingBusy(postImportPairing.status)
                ? t("backup.pairing.running")
                : postImportPairing.status === "prompt"
                  ? t("backup.pairing.autoPair")
                  : t("backup.pairing.retry")}
            </button>
            <button
              className="rounded-md border border-sky-300 bg-white px-3 py-2 font-medium text-sky-900"
              disabled={isPostImportPairingBusy(postImportPairing.status)}
              onClick={dismissPostImportPairing}
              type="button"
            >
              {t("backup.pairing.later")}
            </button>
          </div>
          {!isWritable || !applyLedgerMutation ? (
            <p>
              {t("backup.pairing.notWritable")}
            </p>
          ) : null}
        </section>
  );
}
