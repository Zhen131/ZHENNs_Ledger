/**
 * 这个文件管一件事。
 * 只读地看一眼浏览器里退役的旧账本记录还在不在。
 * 它不管判断以后怎么办。
 * 那在 app 区的进账本前检查和退役页。
 * 不显然的决定：这里没有写、清、删的功能，故意只读。2026-11-06 定（W24 06 第二节第 2、4 条）。
 */

/**
 * 旧账本在浏览器里的位置：库名、版本、表名、记录名。
 * 为什么不能改：要和 2026-07～08 存下的旧记录对得上。这是猜的，日志里没写，要核。
 */
export const INDEXED_DB_STORAGE_DEFAULTS = {
  databaseName: "local-first-trading-ledger",
  databaseVersion: 1,
  storeName: "ledger",
  recordKey: "ledger:v1",
} as const;

/**
 * 打开旧记录时可以换掉的几样。
 * 包括库名、版本、表名、记录名、浏览器的库工厂。测试里用。
 */
export type IndexedDbStorageAdapterOptions = {
  databaseName?: string;
  databaseVersion?: number;
  storeName?: string;
  recordKey?: IDBValidKey;
  indexedDBFactory?: IDBFactory;
};

/**
 * 这个类只读地看浏览器里退役的旧账本记录。
 * 程序只用 read()，再把结果简化成「有没有旧账本」。
 * 这里什么都不写、不清、不删。
 * 唯一的副作用来自打开库本身。
 * 库和表还不存在时，会建出空的。
 *
 * 为什么只读：旧存储已经退役，不许碰用户的旧数据。
 * 2026-11-06 定（W24 06 第二节第 2、4 条；W24 09B 第一节）。
 *
 * 读不出来或浏览器不支持时，Promise 失败。
 */
export class IndexedDbStorageAdapter {
  private readonly databaseName: string;
  private readonly databaseVersion: number;
  private readonly storeName: string;
  private readonly recordKey: IDBValidKey;
  private readonly indexedDBFactory: IDBFactory | undefined;
  private databasePromise: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbStorageAdapterOptions = {}) {
    this.databaseName =
      options.databaseName ?? INDEXED_DB_STORAGE_DEFAULTS.databaseName;
    this.databaseVersion =
      options.databaseVersion ??
      INDEXED_DB_STORAGE_DEFAULTS.databaseVersion;
    this.storeName = options.storeName ?? INDEXED_DB_STORAGE_DEFAULTS.storeName;
    this.recordKey = options.recordKey ?? INDEXED_DB_STORAGE_DEFAULTS.recordKey;
    this.indexedDBFactory = options.indexedDBFactory ?? globalThis.indexedDB;
  }

  /**
   * 这个函数读出那条旧记录；没有就答 null。
   * 举例：从没用过旧版的浏览器 → 答 null。
   * 读失败时 Promise 失败。
   */
  async read(): Promise<unknown | null> {
    const database = await this.openDatabase();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, "readonly");
      const request = transaction.objectStore(this.storeName).get(this.recordKey);
      let result: unknown | null = null;

      request.onsuccess = () => {
        result =
          request.result === undefined
            ? null
            : request.result;
      };
      request.onerror = () => {
        reject(request.error ?? new Error("IndexedDB read request failed"));
      };
      transaction.oncomplete = () => {
        resolve(result);
      };
      transaction.onerror = () => {
        reject(
          transaction.error ?? new Error("IndexedDB read transaction failed"),
        );
      };
      transaction.onabort = () => {
        reject(
          transaction.error ?? new Error("IndexedDB read transaction aborted"),
        );
      };
    });
  }

  /** 这个函数关掉打开过的库；没打开过就什么都不做。 */
  async close(): Promise<void> {
    if (!this.databasePromise) {
      return;
    }

    const database = await this.databasePromise;
    database.close();
    this.databasePromise = undefined;
  }

  private openDatabase(): Promise<IDBDatabase> {
    const indexedDBFactory = this.indexedDBFactory;

    if (!indexedDBFactory) {
      return Promise.reject(
        new Error("IndexedDB is not available in this environment"),
      );
    }

    if (!this.databasePromise) {
      this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDBFactory.open(
          this.databaseName,
          this.databaseVersion,
        );

        request.onupgradeneeded = () => {
          const database = request.result;

          if (!database.objectStoreNames.contains(this.storeName)) {
            database.createObjectStore(this.storeName);
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            this.databasePromise = undefined;
          };
          resolve(database);
        };
        request.onerror = () => {
          reject(request.error ?? new Error("IndexedDB open failed"));
        };
        request.onblocked = () => {
          reject(new Error("IndexedDB upgrade is blocked by another connection"));
        };
      }).catch((error) => {
        this.databasePromise = undefined;
        throw error;
      });
    }

    return this.databasePromise;
  }
}
