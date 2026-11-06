/**
 * 这个文件管记账页上的手动价格表单。
 * 保存的处理在 `priceFormActions.ts`，各栏的画面在 `PriceFormFields.tsx`。
 * 不显然的决定：没有币安对的币也能手填价格；2026-08-19 定（W14 01A 第三节）。
 */
"use client";

import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";

import type {
  ApplyLedgerActionResult,
  PersistenceStatus,
} from "@/app";
import {
  createPriceWorkspaceDraft,
  type PriceWorkspaceDraft,
} from "./priceWorkspaceDraft";
import type { LedgerData, PriceSnapshot } from "@/core/models";
import {
  captureLedgerTime,
  systemLedgerClock,
  type LedgerClock,
  type LedgerTimeSnapshot,
} from "@/core/shared";
import { SUCCESS_FEEDBACK_MS, useLanguage } from "@/ui";
import type { PriceFormState, PriceFormField } from "./priceFormHelpers";
import {
  runPendingPriceSaveEffect,
  runPriceAssetRepairEffect,
  runPriceEpochResetEffect,
} from "./priceFormEffects";
import { doHandleSubmit } from "./priceFormActions";
import { PriceFormFields } from "./PriceFormFields";

type PriceFormProps = Readonly<{
  clock?: LedgerClock;
  ledgerData: LedgerData;
  ledgerEpoch?: number;
  mutationVersion?: number;
  persistedVersion?: number;
  persistenceStatus?: PersistenceStatus;
  onPriceSnapshotCreated: (
    priceSnapshot: PriceSnapshot,
    timeSnapshot: LedgerTimeSnapshot,
  ) => ApplyLedgerActionResult;
  draft?: PriceWorkspaceDraft;
  onDraftChange?: (draft: PriceWorkspaceDraft) => void;
  onReset?: (
    preserve: Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt">,
  ) => void;
  focusTargetRef?: Ref<HTMLSelectElement>;
}>;

/**
 * 这个组件画记账页的手动价格表单。
 * 填币、价格、日期、时间、地点和备注。
 * 点「保存」记一条手动价格。
 * 传了 `draft` 和 `onDraftChange` 时，表单值由记账页保管。
 * 存好后显示「已保存」，过一会儿自动消失。
 */
export function PriceForm({
  clock = systemLedgerClock,
  ledgerData,
  ledgerEpoch = 0,
  mutationVersion,
  persistedVersion,
  persistenceStatus,
  onPriceSnapshotCreated,
  draft,
  onDraftChange,
  onReset,
  focusTargetRef,
}: PriceFormProps) {
  const { t } = useLanguage();
  const certifiedSavedMessage = t("prices.status.certifiedSaved");
  const savingMessage = t("prices.status.saving");
  const defaultAssetSymbol = ledgerData.assets[0]?.symbol ?? "";
  const [localForm, setLocalForm] = useState<PriceFormState>(() =>
    createPriceWorkspaceDraft(
      defaultAssetSymbol,
      captureLedgerTime(clock).todayKey,
      clock,
    ),
  );
  const form = draft ?? localForm;
  const [errors, setErrors] = useState<
    Partial<Record<PriceFormField, string>>
  >({});
  const [successMessage, setSuccessMessage] = useState("");
  const [pendingMutationVersion, setPendingMutationVersion] = useState<
    number | null
  >(null);
  const pendingResetRef = useRef<
    Pick<PriceWorkspaceDraft, "assetSymbol" | "recordedAt"> | undefined
  >(undefined);

  function commitForm(next: PriceFormState) {
    if (draft && onDraftChange) {
      onDraftChange(next);
      return;
    }
    setLocalForm(next);
  }

  useEffect(() => {
    return runPriceAssetRepairEffect(
      {
        commitForm,
        form,
        ledgerData,
      },
    );
    // 只在币的清单变了时修一次表单。
    // 不把两个函数列进依赖，否则每次重画都会跑一遍。
    // 照交易表单同样的写法，日志里没写理由。
    // 这是猜的，要核。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在币的清单变时才修表单，理由是猜的，见上方
  }, [ledgerData.assets]);

  useEffect(() => {
    return runPriceEpochResetEffect(
      {
        clock,
        draft,
        ledgerData,
        pendingResetRef,
        setLocalForm,
        setPendingMutationVersion,
        setSuccessMessage,
      },
    );
    // 只有换了一本账本，才清空表单的状态。
    // 照交易表单同样的写法，日志里没写理由。
    // 这是猜的，要核。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在换账本时清空，理由是猜的，见上方
  }, [ledgerEpoch]);

  useEffect(() => {
    return runPendingPriceSaveEffect(
      {
        certifiedSavedMessage,
        clock,
        draft,
        onReset,
        pendingMutationVersion,
        pendingResetRef,
        persistedVersion,
        persistenceStatus,
        setErrors,
        setLocalForm,
        setPendingMutationVersion,
        setSuccessMessage,
        t,
      },
    );
  }, [
    clock,
    certifiedSavedMessage,
    draft,
    onReset,
    pendingMutationVersion,
    persistedVersion,
    persistenceStatus,
    t,
  ]);

  useEffect(() => {
    if (!successMessage || successMessage === savingMessage) return;
    const timeout = setTimeout(
      () => setSuccessMessage(""),
      SUCCESS_FEEDBACK_MS,
    );
    return () => clearTimeout(timeout);
  }, [savingMessage, successMessage]);

  const selectedAsset =
    ledgerData.assets.find((asset) => asset.symbol === form.assetSymbol) ??
    ledgerData.assets[0];
  const currency = selectedAsset?.quoteCurrency ?? "";

  function updateField<Field extends keyof PriceFormState>(
    field: Field,
    value: PriceFormState[Field],
  ) {
    if (pendingMutationVersion !== null) return;
    commitForm({ ...form, [field]: value });
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setSuccessMessage("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    return doHandleSubmit(
      {
        clock,
        currency,
        form,
        ledgerData,
        mutationVersion,
        onPriceSnapshotCreated,
        pendingMutationVersion,
        pendingResetRef,
        persistedVersion,
        persistenceStatus,
        savingMessage,
        setErrors,
        setLocalForm,
        setPendingMutationVersion,
        setSuccessMessage,
        t,
      },
      event,
    );
  }

  return (
    <form
      aria-busy={pendingMutationVersion !== null}
      className={`grid gap-4 ${
        successMessage === certifiedSavedMessage
          ? "motion-safe:animate-[ledger-save-pop_200ms_ease-out]"
          : ""
      }`}
      onSubmit={handleSubmit}
    >
      <PriceFormFields
        clock={clock}
        currency={currency}
        errors={errors}
        focusTargetRef={focusTargetRef}
        form={form}
        ledgerData={ledgerData}
        pendingMutationVersion={pendingMutationVersion}
        savingMessage={savingMessage}
        successMessage={successMessage}
        t={t}
        updateField={updateField}
      />
    </form>
  );
}
