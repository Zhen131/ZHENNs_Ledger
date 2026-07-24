# Local-First Personal Trading Ledger

一个使用 Next.js、React 和 TypeScript 构建的浏览器本地优先交易账本原型。

## 当前状态

截至 2026-07-24，Week 9 IndexedDB 静态加密实现、P1 恢复修复与主 production 链验收已完成；
主实现 `aca6c53` 与恢复修复 `b17b58e` 已通过合并提交 `4fadfb6` 进入并推送至 `main`。功能分支仅作保留，不是当前开发分支。
IndexedDB 固定槽位现只接受 `StoredLedgerEnvelopeV2`；首次使用必须设置密码，
刷新或关闭后必须重新解锁。明文备份仍由用户自行持有。

当前 `main` 已实现：

- 交易表单：校验成功后写入 `LedgerData.trades`，列表和持仓同步更新。
- 安全删除：删除后若会破坏后续卖出时间线，则拒绝删除。
- 价格表单：写入 `PriceSnapshot` 后更新最新价格、市值和未实现盈亏。
- 真实交互回归：覆盖合法新增、非法输入、超卖、安全删除、价格联动。
- 整账运行时校验：保存或恢复前检查 schema、实体、Decimal、日期、引用、唯一性和交易时间线。
- IndexedDB 静态加密：PBKDF2-SHA-256（600,000 次）派生不可导出的 AES-256-GCM 会话密钥。
- V2 密文 envelope：固定记录槽位保存版本、KDF、salt、IV 与 ciphertext；每次保存使用新 IV。
- 启动访问门禁：严格区分首次设置、已有密文解锁、旧/未知格式、损坏密文与读取失败。
- 首次设密恢复：密文写入成功但验证回读失败时保留 V2 record，页面自动转入重新解锁，不再停留在首次设置死路。
- 会话边界：密码和 `CryptoKey` 不持久化，刷新或关闭后必须重新输入密码。
- 忘记密码重置：未解锁状态必须输入固定确认文本，只删除当前加密账本记录。
- 安全 hydration：恢复数据真正进入 reducer 前保持 `loading`，禁止 dispatch 和自动保存。
- 串行自动保存：快速连续修改按顺序写入；失败时保留页面状态并显示错误。
- 保存状态语义：页面区分“已加入账本”“正在保存到本地”“已保存到本地”和保存失败。
- 失败安全重试：最新保存失败可重试，旧 snapshot、旧 Repository generation 和重复点击不能覆盖新账本。
- dirty 离开保护：pending / save error 会标记未落盘，离开页面或切换 Repository 前会警告或要求明确放弃。
- ResourcePolicy：v1 限制文件 8 MiB、assets 500、trades 25,000、priceSnapshots 5,000、feeRules 500 和关键字符串长度。
- 超限保护：既有结构合法但超限的账本只读恢复；新 mutation 在进入 reducer 前拒绝，禁止自动保存与 clear 覆盖旧数据。
- 自动化重挂载验收：使用真实组装链和 fake IndexedDB 证明交易、价格可在卸载后恢复。
- 安全 clear：正常状态和 hydration error 状态均使用固定文本二段确认，完整删除本地账本并恢复全新的内置资产初始账本。
- 通用持久化操作互斥：dispatch、自动保存和 clear 共用同步 operation ref 与写队列；重复 clear 共享同一 Promise。
- clear 生命周期保护：覆盖排队写入、前置保存失败、clear 失败、Repository 切换和组件卸载。
- clear 后空库保护：清空成功不自动保存初始账本；第一次新用户写入才重新生成 record。
- 完整账本备份：`BackupEnvelopeV1` 只包含版本元数据与完整 `LedgerData`，不包含 `Position[]`。
- 原子恢复：复用 Repository 整账 `save`，写入成功后才替换页面；失败保留页面和旧 record。
- 导入失效保护：取消、卸载、Repository 切换和旧 `File.text()` 完成均不得修改当前页面。
- 只读救援边界：允许导出当前内存账本，并明确超限备份可能无法由当前版本重新导入。
- 八列资产汇总：直接展示 `Position.costBasis` 和 `Position.realizedPnl`，并明确当前手续费不计入口径。
- golden UI 回归：逐笔填写真实表单，覆盖 5 条 golden、BTC 价格、ADA 超卖和两类删除。
- 响应式收口：宽窄屏页面不再整体横向溢出，宽表只在自己的容器内滚动。

当前自动化结果：

```text
Week 9 最终验收：30 个测试文件、290 项测试
npm run lint  -> 无 warning / error
npm run build -> Compiled successfully
git diff --check -> 通过
```

生产 UI 验收结果：

```text
5 条 golden -> BTC / ETH / ADA 数量、剩余成本、已实现盈亏通过
BTC 70000 USD -> 市值 11.4716 USD，未实现盈亏 0.4716 USD
ADA 超卖 -> 拒绝且账本仍为 5 条交易
不安全删除 -> 拒绝；安全删除 BTC -> 4 条交易且 BTC 持仓消失
390 / 1280 宽度 -> 页面级无横向溢出，控制台无 warning / error
Week 8 production -> BTC 交易与价格保存、导出提示、clear、刷新空库通过
受控真实文件 -> BTC / ETH 交易与 BTC 价格恢复，二次导出规范化 ledgerData 一致
最终复验 -> BTC、ETH 两条交易及持仓存在，刷新后仍完整；先前空页面为恢复后的正常删除
production console -> 0 warning / 0 error
Week 9 clear 闭环 -> 2 条交易和 1 条价格导出、Dashboard clear、无刷新导入、V2 直读、刷新解锁恢复通过
Week 9 V2 直读 -> PBKDF2 600000 / AES-GCM / 固定六字段；测试账本明文特征零命中
```

Week 7 固定 production build 样例：

```text
BTC 0.001 @ 70000 USD -> 成本 70 USD，已实现盈亏 0 USD
BTC 80000 USD         -> 市值 80 USD，未实现盈亏 10 USD
ETH 0.005 @ 2000 USD  -> 保存刷新后总交易数 2
删除 ETH 并刷新        -> 总交易数 1，BTC 数值保持不变
clear 并刷新           -> 空交易、空持仓；首次新写入可再次刷新恢复
控制台                  -> 无 warning / error
```

Week 8 production DevTools 历史证据：旧 `ledger:v1` record 为
`formatVersion = 1` 明文。Week 9 对该旧格式明确拒绝自动覆盖，用户确认其为测试数据后，
通过固定确认文本精确清除并建立 V2 密文 record。

## 核心原则

- `Trade` 和 `PriceSnapshot` 是事实数据。
- `Position[]` 由交易和价格临时推导，不写入 reducer 或 IndexedDB。
- 数量和金额使用 `DecimalString -> decimal.js`，不使用 JavaScript 浮点数重算账本。
- 不可信表单、IndexedDB 和未来 JSON 输入必须先通过运行时校验。
- UI、Service 和 Reducer 不直接操作 IndexedDB。
- IndexedDB whole-blob 使用 AES-256-GCM 静态加密；Noop EncryptionService 仅供隔离测试。
- 明文备份不属于 IndexedDB 静态加密范围，导出 UI 必须持续提示“备份为明文，未加密”。
- Week 7 只保证单标签页内的顺序与 clear 安全；另一标签页可能在 clear 后把旧状态重新写回。

## 已实现数据流

交易写入：

```text
TradeForm
-> createValidatedTrade(...)
-> validateTradeDraft(...)
-> dispatch(trade/add)
-> LedgerData.trades
-> positionService
-> positionCalculator
-> 列表与持仓
```

价格写入：

```text
PriceForm
-> createValidatedPriceSnapshot(...)
-> validatePriceSnapshotDraft(...)
-> dispatch(priceSnapshot/add)
-> LedgerData.priceSnapshots
-> positionCalculator
-> 最新价格 / 市值 / 未实现盈亏
```

启动与持久化：

```text
page
-> LedgerAccessGate
-> inspect / setup / unlock
-> PBKDF2 + non-extractable CryptoKey
-> DashboardShell(required repository)
-> usePersistentLedger
-> LedgerRepository
-> WebCryptoEncryptionService
-> IndexedDbStorageAdapter
-> IndexedDB StoredLedgerEnvelopeV2
```

恢复：

```text
IndexedDB
-> Repository 解包与整账校验
-> ledger/replace
-> 确认 reducer 已显示恢复快照
-> hydration ready
-> 才允许用户写入和自动保存
```

## 目录职责

```text
src/
  app/           Next.js 页面入口
  backup/        BackupEnvelopeV1、规范化序列化与浏览器下载
  components/    访问门禁、Dashboard、交易表单、价格表单、备份控制和交易列表
  models/        Asset、Trade、PriceSnapshot、Position、LedgerData 等类型
  utils/         Decimal 运算统一入口
  calculators/   持仓、成本和盈亏纯计算
  validators/    交易、价格、ISO 日期和完整 LedgerData 运行时校验
  services/      交易创建、安全删除、价格创建和持仓派生
  state/         初始账本、reducer、replace 与 hydration 状态
  repositories/  整账 load / save / clear 与运行时校验边界
  encryption/    V2 envelope、Base64URL、密码规则、PBKDF2 与 AES-GCM
  adapters/      原生 IndexedDB whole-blob 适配器
  composition/   具体 Adapter、加密与 Repository 的唯一组装点
  test/          共享 golden fixtures
```

## 主要安全边界

- 交易日期和价格日期只接受严格的 `YYYY-MM-DD` 或带时区 ISO datetime。
- 候选卖出加入完整时间线后，任一时点都不能出现负持仓。
- 删除交易前重新验证候选账本；Reducer 仍只负责不可变状态更新。
- 保存前和恢复后都运行完整 `LedgerData` Validator。
- 空数据库返回 `null`，不会伪装成“已经保存的空账本”。
- hydration 失败后自动保存保持关闭，避免空状态覆盖旧记录。
- clear 只在 ready 或 hydration error 的受控恢复入口执行；loading 状态不可清空。
- dispatch、save 和 clear 共用同一 operation/queue 顺序边界，clear 期间全部写入口禁用。
- clear 成功后初始账本不会自动重建 `ledger:v1`，第一次新用户写入才会保存。
- 导入在 `File.text()` 前检查声明大小，解析前复核 UTF-8 字节数，再运行整账 Validator 与 ResourcePolicy。
- 导入、clear 和自动保存共用写队列；导入期间所有写入口与备份入口同步禁用。
- schema 版本错误每个冲突只返回一项结构化错误，不重复报告。
- IndexedDB 只出现在 Adapter；具体实例只在 composition 组装点创建。
- Adapter 的 `read()` 返回 `unknown | null`；AccessController 与 Repository 分别执行同一 V2 runtime validator。
- 未解锁时不挂载 Dashboard、持久化 Hook 或备份入口。
- `formatVersion: 1`、未知格式和损坏 V2 record 均不得自动迁移或覆盖。
- 保存顺序固定为校验账本、序列化、加密、校验 envelope、原子写入。

## 本地运行

建议使用 Node.js 20、22 或 24+。

```bash
npm install
npm run dev
```

浏览器访问：

```text
http://localhost:3000
```

完整检查：

```bash
npm test
npm run lint
npm run build
git diff --check
```

## 已知限制与后续范围

- Week 9 已按调整后的 Gate 合并并推送；整机硬断网已取消、未验证，不作为本轮阻塞项，也不得写成通过。
- S-07 已完成；大账本性能预算、分页和 virtual list 仍待 Week 11 benchmark 定义，不能据此宣称 25,000 笔交易流畅。
- load / save / clear、排队写入、重复 clear、Repository 切换和卸载均已有确定性故障注入测试；Week 9 的 production 主链与 V2 DevTools 直读均已通过。
- 分页、virtual list 和大账本性能上限尚未定义。
- 交易列表仍按保存顺序展示；回填交易的显示排序规则尚未确定。
- 加密备份不在 Week 9 范围；用户导出的备份仍是明文文件。
- 图表、benchmark 和论文发布门尚未实现。
- `npm audit` 当前报告 5 个依赖漏洞；Next.js 与 lint 工具链升级需要单独评估，未执行强制大版本修复。

## Git 状态

- 当前源码分支：`main`。
- 当前主线提交：`4fadfb6`（`合并：完成第九周静态加密开发`），已推送至 `origin/main`。
- `zhennn/week9-encryption-at-rest` 保留为已合并功能分支；仅在用户要求时清理。
