/**
 * 这个文件管拿到账本文件打开权后，手里那张凭条长什么样。
 * 它不管怎么拿到打开权，那在 coordination 区。
 * 没有特别的决定。
 */

/**
 * 这个类型是一张打开权凭条：编号、排队写文件、放手。
 * 写文件一次只做一件，放手以后不能再写。
 */
export interface LedgerFileSessionLease {
  readonly sessionId: string;
  runExclusiveWrite<T>(operation: () => Promise<T>): Promise<T>;
  release(): Promise<void>;
}
