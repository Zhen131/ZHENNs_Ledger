/**
 * 这个文件给测试一个放在内存里的假仓库，照样检查账本。
 * 真仓库要加密、写文件，在 `platform/files` 和 `platform/persistence` 里。
 * 不显然的决定：它和真仓库一样，存前查一遍，读回来再查一遍。
 */
import { vi } from "vitest";
import type { LedgerData } from "@/core/models";
import { validateLedgerData } from "@/core/validation";
import {
  LEDGER_REPOSITORY_ERROR_CODES,
  LedgerRepositoryError,
  type LedgerRepository,
} from "@/platform/persistence";

/**
 * 一份存着的账本，存成真仓库会写的 JSON 文字；没存过是 null。
 * 几个假仓库可以共用一份。
 * 测试靠这个模拟「重开一次还是那本账」。
 */
export type ValidatingMemoryLedgerStore = {
  serialized: string | null;
};

/** 测试能插进读、写、清空前的三个钩子。钩子抛错，那一步就失败。 */
export type ValidatingMemoryLedgerStoreHooks = Readonly<{
  /** 读出存着的文字之前调；抛错会让 `load` 失败。 */
  read?: () => Promise<void>;
  /** 新文字换掉旧文字之前调；抛错会让 `save` 失败，旧文字不变。 */
  write?: (serialized: string) => Promise<void>;
  /** 删掉存着的文字之前调；抛错会让 `clear` 失败，旧文字不变。 */
  clear?: () => Promise<void>;
}>;

/**
 * 这个函数造一份共用的存储，可以先放进一本账。
 * 举例：传入一本 5 笔交易的账 → 答存着它 JSON 文字的存储。
 * 不传就是空的。不会出错。
 */
export function createValidatingMemoryLedgerStore(
  initialLedger: LedgerData | null = null,
): ValidatingMemoryLedgerStore {
  return {
    serialized:
      initialLedger === null ? null : JSON.stringify(initialLedger),
  };
}

/**
 * 这个函数造一个内存里的假仓库，不加密，不写文件。
 * 它照做真仓库的三道检查：存前查账本；变成 JSON 文字；读回再查。
 * 举例：存一本卖超了的账 → `save` 抛错，错误码 `INVALID_LEDGER_DATA`。
 * 失败都抛 `LedgerRepositoryError`，错误码和真仓库同一套。
 * 返回仓库本身，外加几样给测试看的东西。
 */
export function createValidatingMemoryLedgerRepository(
  store: ValidatingMemoryLedgerStore = createValidatingMemoryLedgerStore(),
  hooks: ValidatingMemoryLedgerStoreHooks = {},
) {
  const write = vi.fn(async (serialized: string) => {
    await hooks.write?.(serialized);
    store.serialized = serialized;
  });
  const clearStored = vi.fn(async () => {
    await hooks.clear?.();
    store.serialized = null;
  });

  const repository: LedgerRepository = {
    async load(): Promise<LedgerData | null> {
      let serialized: string | null;
      try {
        await hooks.read?.();
        serialized = store.serialized;
      } catch (error) {
        throw new LedgerRepositoryError(
          LEDGER_REPOSITORY_ERROR_CODES.READ_FAILED,
          "Could not read saved ledger data",
          error,
        );
      }
      if (serialized === null) {
        return null;
      }

      let parsedData: unknown;
      try {
        parsedData = JSON.parse(serialized);
      } catch (error) {
        throw new LedgerRepositoryError(
          LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
          "Saved ledger payload could not be parsed",
          error,
        );
      }

      const validationResult = validateLedgerData(parsedData);
      if (!validationResult.ok) {
        throw new LedgerRepositoryError(
          LEDGER_REPOSITORY_ERROR_CODES.INVALID_STORED_DATA,
          "Saved ledger payload failed runtime validation",
          validationResult.errors,
        );
      }
      return validationResult.value;
    },

    async save(ledgerData: LedgerData): Promise<void> {
      const validationResult = validateLedgerData(ledgerData);
      if (!validationResult.ok) {
        throw new LedgerRepositoryError(
          LEDGER_REPOSITORY_ERROR_CODES.INVALID_LEDGER_DATA,
          "Ledger data failed runtime validation before save",
          validationResult.errors,
        );
      }
      try {
        await write(JSON.stringify(validationResult.value));
      } catch (error) {
        throw new LedgerRepositoryError(
          LEDGER_REPOSITORY_ERROR_CODES.WRITE_FAILED,
          "Could not save ledger data",
          error,
        );
      }
    },

    async clear(): Promise<void> {
      try {
        await clearStored();
      } catch (error) {
        throw new LedgerRepositoryError(
          LEDGER_REPOSITORY_ERROR_CODES.CLEAR_FAILED,
          "Could not clear saved ledger data",
          error,
        );
      }
    },
  };

  return {
    repository,
    store,
    /** 记下每一次写入，失败的也算。 */
    write,
    /** 记下每一次清空，失败的也算。 */
    clear: clearStored,
    /** 把存着的 JSON 文字读回成对象；没存东西时是 null。 */
    readStoredLedger: (): unknown =>
      store.serialized === null ? null : JSON.parse(store.serialized),
  };
}
