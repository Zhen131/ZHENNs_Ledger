# adapters

外部存储细节放在这里。

当前已实现 `IndexedDbStorageAdapter`：

- 使用原生 IndexedDB。
- 固定 key 保存一份 whole-blob `StoredLedgerEnvelope`。
- 支持 `read / write / clear`。
- 空库返回 `null`。
- 写入失败时由 IndexedDB 事务保留上一份成功记录。

Adapter 不解析 `LedgerData`、不负责加密、不计算业务数据，也不能把 IndexedDB
API 泄露到 UI、Service、Reducer 或 Calculator。未来 JSON、文件和行情接口仍应
以独立 Adapter 接入。
