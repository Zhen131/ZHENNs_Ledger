/**
 * 这个文件管一件事：把一条超上限错误写成给人看的说明。
 * 量大小、判超没超，在旁边的 `resourcePolicy.ts`；显示在哪，由页面决定。
 * 不显然的决定：说明按错误里的四个字段现拼，不读错误自带的 `message`。
 * 这样英文界面能拼出英文；2026-11-15 定（W26 04B 第三节第 1 条第 3 点）。
 * 它不引用 `resourcePolicy.ts` 的类型，免得两个文件互相引用。
 */
import { translateDefault, type Translate } from "@/ui";

/**
 * 这个函数回答：这条超上限错误，用哪种语言怎么说？
 * 文件太大时说「账本文件」，别的超限说出错的位置。
 * 举例：`trades` 上限 250000、实际 250001，中文。
 * → 答「trades 超过资源上限（250001 > 250000）」。
 * `t` 不传时用中文；页面上显示时要传当前界面语言的 `t`。
 * 不会出错。
 */
export function describeLedgerResourcePolicyError(
  error: Readonly<{ code: string; path: string; limit: number; actual: number }>,
  t: Translate = translateDefault,
): string {
  const label =
    error.code === "LEDGER_RESOURCE_FILE_TOO_LARGE"
      ? t("policy.resource.ledgerFileLabel")
      : error.path;
  return `${label}${t("policy.resource.overLimitMiddle")}${error.actual} > ${error.limit}${t("policy.resource.overLimitSuffix")}`;
}
