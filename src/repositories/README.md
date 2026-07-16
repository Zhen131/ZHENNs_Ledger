# repositories

账本整账读写入口放在这里。

当前 `LedgerRepository` 提供：

- `load(): Promise<LedgerData | null>`
- `save(ledgerData): Promise<void>`
- `clear(): Promise<void>`

`DefaultLedgerRepository` 负责调用 EncryptionService、序列化 JSON，并在保存前和
恢复后执行完整 `LedgerData` 运行时校验。空库的 `null` 与“已保存的空账本”语义
不同。

Repository 不知道 IndexedDB 的 database、store 或事务细节；这些只属于 Adapter。
