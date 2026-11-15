/**
 * 这个文件放测试用的账本权限，全部打开。
 * 正式程序的权限默认怎么开，在 `platform/persistence` 里定。
 * 正式程序不会这样全开，只有测试这样用。
 * 没有特别的决定。
 */
import type { LedgerSessionCapabilities } from "@/platform/persistence";

/**
 * 账本权限全开的一份设置。
 * 能清空，能导入备份。
 * 测试要试导入备份时，拿它绕开默认设置。
 */
export const ALL_ENABLED_TEST_LEDGER_CAPABILITIES: LedgerSessionCapabilities =
  Object.freeze({
    canClearReadyLedger: true,
    canImportBackup: true,
  });
