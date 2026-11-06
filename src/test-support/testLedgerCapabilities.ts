/**
 * 这个文件放测试用的账本权限，全部打开。
 * 正式程序的权限默认怎么开，在 `platform/persistence` 里定。
 * 不显然的决定：正式程序不会这样全开，只有测试这样用。
 */
import type { LedgerSessionCapabilities } from "@/platform/persistence";

/**
 * 账本权限全开的一份设置。
 * 能清空，能在读坏后清空，能导入备份。
 * 正式程序里没有哪个会话是这样全开的。
 * 测试要试读坏后清空、导入备份时，拿它绕开默认设置。
 */
export const ALL_ENABLED_TEST_LEDGER_CAPABILITIES: LedgerSessionCapabilities =
  Object.freeze({
    canClearReadyLedger: true,
    canClearHydrationError: true,
    canImportBackup: true,
  });
