/**
 * 这个文件给测试在浏览器旧存储里塞一条假的旧账本。
 * 检查有没有旧账本的那段在 `platform/legacy` 里，这里只造现场。
 * 塞的内容是虚构的。
 * 因为检查只问有没有，不读内容。
 * 没有特别的决定。
 */
import {
  INDEXED_DB_STORAGE_DEFAULTS,
  type IndexedDbStorageAdapterOptions,
} from "@/platform/legacy";

/**
 * 这个函数在旧账本原来住的地方放一条非空的值。
 * 产品自己从不往那里写，只有测试通过它写。
 * 它和被测的检查用同一套库名、表名、键名。
 * 举例：不传参数调一次 → 默认库里多一条假记录。
 * 打开库或写入失败时，返回的 Promise 失败。
 */
export function seedRetiredBrowserLedgerRecord(
  options: IndexedDbStorageAdapterOptions = {},
  value: unknown = { fictionalRetiredLedger: true },
): Promise<void> {
  const factory = options.indexedDBFactory ?? globalThis.indexedDB;
  const databaseName =
    options.databaseName ?? INDEXED_DB_STORAGE_DEFAULTS.databaseName;
  const storeName = options.storeName ?? INDEXED_DB_STORAGE_DEFAULTS.storeName;
  const recordKey = options.recordKey ?? INDEXED_DB_STORAGE_DEFAULTS.recordKey;

  return new Promise((resolve, reject) => {
    const request = factory.open(
      databaseName,
      INDEXED_DB_STORAGE_DEFAULTS.databaseVersion,
    );
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(value, recordKey);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}
