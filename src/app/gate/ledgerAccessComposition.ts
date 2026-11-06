/**
 * 这个文件把进账本前那道检查要用的真东西配在一起。
 * 一个是账本文件打开器，一个是浏览器旧存储的探测器。
 * 每样东西本身在 `platform` 和 `app/file-access` 里。
 * 没有特别的决定。
 */
import {
  IndexedDbStorageAdapter,
  type IndexedDbStorageAdapterOptions,
} from "@/platform/legacy";
import { LedgerFileHandleAdapter } from "@/platform/files";
import {
  IndexedDbLedgerFileConnectionAdapter,
  type IndexedDbLedgerFileConnectionAdapterOptions,
} from "@/platform/files";
import { DefaultLedgerFileSessionCoordinator } from "@/platform/coordination";
import {
  LEDGER_ACCESS_ERROR_CODES,
  type LedgerAccessController,
} from "@/platform/legacy";
import {
  DefaultLedgerFileAccessController,
  type LedgerFileAccessController,
} from "@/app/file-access";

let defaultAccessController: LedgerAccessController | undefined;
let defaultFileAccessController: LedgerFileAccessController | undefined;

/**
 * 这个函数造一个只看浏览器里有没有旧账本的探测器。
 * 有旧账本答「要解锁」，没有答「要新建」，读不出来答出错。
 * 它从不读旧账本的内容。不抛错。
 */
export function createApplicationLedgerAccessController(
  storageOptions: IndexedDbStorageAdapterOptions = {},
): LedgerAccessController {
  const legacyPresenceStorage = new IndexedDbStorageAdapter(storageOptions);
  return Object.freeze({
    inspect: async () => {
      try {
        return (await legacyPresenceStorage.read()) === null
          ? { status: "setup-required" as const }
          : { status: "unlock-required" as const };
      } catch {
        return {
          status: "error" as const,
          code: LEDGER_ACCESS_ERROR_CODES.READ_FAILED,
        };
      }
    },
  });
}

/** 这个函数拿全应用共用的旧账本探测器，第一次调用时才造。 */
export function getDefaultLedgerAccessController(): LedgerAccessController {
  defaultAccessController ??= createApplicationLedgerAccessController();
  return defaultAccessController;
}

/**
 * 这个函数造一个真用的账本文件打开器。
 * 它配上浏览器选文件，一文件只许一处开，记住上次的文件。
 */
export function createApplicationLedgerFileAccessController(
  connectionOptions: IndexedDbLedgerFileConnectionAdapterOptions = {},
): LedgerFileAccessController {
  return new DefaultLedgerFileAccessController(
    new LedgerFileHandleAdapter(),
    {},
    new DefaultLedgerFileSessionCoordinator(),
    undefined,
    new IndexedDbLedgerFileConnectionAdapter(connectionOptions),
  );
}

/** 这个函数拿全应用共用的文件打开器，第一次调用时才造。 */
export function getDefaultLedgerFileAccessController(): LedgerFileAccessController {
  defaultFileAccessController ??=
    createApplicationLedgerFileAccessController();
  return defaultFileAccessController;
}
