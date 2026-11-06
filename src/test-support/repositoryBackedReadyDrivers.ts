/**
 * 这个文件给测试一对清空和导入的执行者。
 * 它们的活最后落在给定的仓库上。
 * 正式程序里动文件的执行者在 `platform/persistence` 里。
 * 没有特别的决定。
 */
import type { LedgerData } from "@/core/models";
import {
  claimReadyLedgerClearExecutionContextForDriver,
  claimReadyLedgerImportExecutionContextForDriver,
  createReadyLedgerClearAuthorizationForDriver,
  createReadyLedgerImportAuthorizationForDriver,
  type LedgerReadyClearDriver,
  type LedgerReadyImportDriver,
  type LedgerRepository,
} from "@/platform/persistence";

/** 测试用的假文件身份：一个文件编号，一个核过的版本号。都是虚构的。 */
const TEST_FILE_EVIDENCE = Object.freeze({
  fileId: "repository-backed-test-file",
  verifiedRevisionId: "repository-backed-test-revision",
});

/**
 * 这个函数造一对清空和导入的执行者，活交给传进来的仓库。
 * 批准过的清空，会调 `repository.clear()`。
 * 批准过的导入，会调 `repository.save(candidate)` 再原样交回。
 * 举例：配进账本文件会话后点清空 → 仓库的 `clear` 被调一次。
 * 拿着没批准过的执行凭证来清空或导入，会抛错。
 */
export function createRepositoryBackedReadyDrivers(
  repository: LedgerRepository,
): Readonly<{
  readyClearDriver: LedgerReadyClearDriver;
  readyImportDriver: LedgerReadyImportDriver;
}> {
  const readyClearDriver: LedgerReadyClearDriver = {
    authorizeReadyClear: (context) =>
      createReadyLedgerClearAuthorizationForDriver(
        context,
        TEST_FILE_EVIDENCE,
      ),
    clearReadyLedger: async (authorization, executionContext) => {
      if (
        !claimReadyLedgerClearExecutionContextForDriver(
          executionContext,
          authorization,
          readyClearDriver,
        )
      ) {
        throw new Error("invalid ready clear execution");
      }
      await repository.clear();
    },
  };
  const readyImportDriver: LedgerReadyImportDriver = {
    authorizeReadyImport: (context) =>
      createReadyLedgerImportAuthorizationForDriver(
        context,
        TEST_FILE_EVIDENCE,
      ),
    importReadyLedger: async (
      authorization,
      candidate: LedgerData,
      executionContext,
    ) => {
      if (
        !claimReadyLedgerImportExecutionContextForDriver(
          executionContext,
          authorization,
          readyImportDriver,
        )
      ) {
        throw new Error("invalid ready import execution");
      }
      await repository.save(candidate);
      return candidate;
    },
  };
  return { readyClearDriver, readyImportDriver };
}
