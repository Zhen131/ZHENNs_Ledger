# Local-First Personal Trading Ledger

一个使用 Next.js、React 和 TypeScript 构建的浏览器本地优先交易账本原型。

## 当前状态

截至 2026-07-25，Week 10 的日期兼容、Binance 最新行情、统一价格选择、共享持仓重放、
三张 ECharts 图与持久化安全回归已经在本地功能分支
`zhennn/week10-charts-binance` 完成。该分支尚未合并、尚未推送，等待用户审查。
`LedgerData.schemaVersion` 仍为 `1`，Week 9 的 IndexedDB V2 静态加密主链保持不变。

当前功能分支已实现：

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
- 日期与兼容：统一日期 key、稳定排序和可注入本地时钟；新事实与 strict import 拒绝未来日期，既有未来事实进入受限纠正模式。
- 币种边界：USD/USDT 按 `1 USDT ≈ 1 USD` 估值并常驻披露；其他旧币种只允许救援，不进入自动估值。
- Binance 最新行情：固定读取公开 `exchangeInfo` 与 `ticker/price`，8 秒超时、无重试、无轮询、无 WebSocket；BTC、ETH、ADA 提供默认映射。
- 批量刷新：逐资产报告成功或失败，同日 API 价格执行 upsert，一次批量 mutation 保存；旧请求受 mapping signature、`ledgerEpoch`、卸载和 Repository 状态保护。
- 统一价格选择：`priceSelectionService.selectPriceAsOf(...)` 是持仓表、饼图和历史曲线的唯一选择入口；自动模式同日优先 Binance，手动模式优先手动价格，缺价保持缺失。
- 共享持仓重放：当前持仓和历史曲线复用 `positionReplay` 的 DCA、卖出与剩余成本规则，不存在第二套成本算法。
- 三张图：当前 USD 等值持仓饼图、总市值/持仓成本阶梯曲线、最近 365 天交易热力图；支持 1 日、7 日、30 日、365 日和全部范围。
- 真实缺价表达：全缺价不渲染误导性饼图，部分缺价显式列出未估值资产，曲线缺价断开且不使用成交价、成本、未来价格或 `0` 回填。
- 热力交互：点击日期过滤交易列表，再次点击取消；导入与 clear 会重置日期筛选。
- 派生边界：`Position[]`、分配切片、曲线点、热力等级、当前估值模式和选中日期均不进入 `LedgerData`、IndexedDB 或备份。

当前自动化结果：

```text
Week 10 最终验收：41 个测试文件、362 项测试
npm run lint  -> 无 warning / error
npm run build -> Compiled successfully
git diff --check -> 通过
```

生产 UI 验收结果：

```text
真实交易 -> BTC/ETH/ADA 4 笔，3 项当前持仓，三图同步
真实 Binance -> 3 项更新、0 项失败；BTC/ETH/ADA 最新价格与来源、as-of 可见
同日手动 BTC 70000 -> 自动模式仍选 Binance；手动模式改选 70000
区间切换 -> 1/7/30/365/全部的点数、缺口与 1 日免责声明正确
缺价场景 -> 全缺价、部分缺价和单资产均按真实数据表达
热力点击 -> 日期筛选、再次点击取消与 clear/import 重置通过
备份闭环 -> 导出明文提示、clear、无刷新导入、刷新解锁恢复通过
持久化 -> 映射、API/manual provenance 与事实恢复；派生/会话字段未进入备份
未来输入 -> 2099-01-01 在 production UI 被拒绝，交易仍为 4 笔
390 / 1280 宽度 -> 页面级无横向溢出，宽表仅局部滚动
production console -> 0 warning / 0 error
```

Week 8 production DevTools 历史证据：旧 `ledger:v1` record 为
`formatVersion = 1` 明文。Week 9 对该旧格式明确拒绝自动覆盖，用户确认其为测试数据后，
通过固定确认文本精确清除并建立 V2 密文 record。

## 核心原则

- `Trade`、`PriceSnapshot` 和 Binance 映射是事实数据。
- `Position[]` 与全部图表数据由事实临时推导，不写入 reducer、IndexedDB 或备份。
- 数量和金额使用 `DecimalString -> decimal.js`，不使用 JavaScript 浮点数重算账本。
- 不可信表单、IndexedDB 和未来 JSON 输入必须先通过运行时校验。
- 市场价缺失就是缺失；不得以成交价、成本、未来价格或 `0` 伪造。
- Binance 是可失败的外部输入，不是本地账本可用性的前置条件。
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

Binance 最新行情与统一价格选择：

```text
MarketDataControls
-> BinanceMarketDataClient(exchangeInfo + ticker/price)
-> binancePriceRefreshService(逐资产结果 + 同日 upsert)
-> LedgerData.priceSnapshots
-> priceSelectionService.selectPriceAsOf(...)
-> 持仓表 / 饼图 / 历史曲线
```

三图派生：

```text
LedgerData facts
-> positionReplay(共享 DCA / sell / cost)
-> chartDataService
-> allocation / step history / 365-day heatmap
-> chartOptionBuilders
-> EChart(Canvas 生命周期适配层)
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
  components/    访问门禁、Dashboard、行情控制、三图、备份控制和事实表单/列表
  marketData/    Binance 公共 REST 客户端、响应校验与超时
  models/        Asset、Trade、PriceSnapshot、Position、LedgerData 等类型
  utils/         Decimal 运算统一入口
  calculators/   共享持仓重放、成本和盈亏纯计算
  policies/      新事实、导入、日期、币种与旧未来事实边界
  validators/    交易、价格、ISO 日期和完整 LedgerData 运行时校验
  services/      事实写入、行情刷新、统一选价、持仓与图表纯派生
  state/         初始账本、reducer、replace 与 hydration 状态
  repositories/  整账 load / save / clear 与运行时校验边界
  encryption/    V2 envelope、Base64URL、密码规则、PBKDF2 与 AES-GCM
  adapters/      原生 IndexedDB whole-blob 适配器
  composition/   具体 Adapter、加密与 Repository 的唯一组装点
  test/          共享 golden fixtures
```

## 主要安全边界

- 交易日期和价格日期只接受严格的 `YYYY-MM-DD` 或带时区 ISO datetime；新事实不得晚于注入时钟的今天。
- 旧未来事实只允许救援、导出、删除或纠正，不能继续新增普通事实或自动行情。
- 自动估值域固定为 USD/USDT，持续披露 `1 USDT ≈ 1 USD`；其他旧币种不参与自动估值。
- Binance 客户端固定公开 GET、8 秒超时且不重试；单个资产失败不得清除旧价或阻塞本地操作。
- `priceSelectionService` 是所有估值消费者的唯一价格选择算法。
- 历史曲线只使用点位当时已经发生的事实和价格，缺价输出断点。
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
- 图表 option、曲线点、热力等级、估值模式和日期筛选均为内存派生/会话状态。

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

- Binance 只读取最新公开价格，不读取历史 Kline/OHLC，不轮询、不使用 WebSocket；网络、地区、限流或 CORS 失败时保留旧事实并继续使用本地账本。
- production UI 能证明未来新事实拒绝；既有 legacy future 事实的受限纠正模式和请求竞态只能用确定性自动化覆盖，未伪造浏览器场景。
- 手动/自动估值模式只属于当前解锁会话，刷新后回到自动模式。
- 用户导出的备份仍是明文文件；加密备份不在 Week 10 范围。
- 分页、virtual list 和大账本性能预算仍待 Week 11 benchmark 定义，不能据此宣称 25,000 笔交易流畅。
- 情景价格、未来价格模拟、动画、主题、K 线、指标、dataZoom、账户、订单和下单不在 Week 10 范围。
- 安装 ECharts 后 npm 摘要报告 7 个 high 漏洞；本轮未获准向外部 advisory 服务发送依赖元数据，因此没有完成在线归因，也未执行 `npm audit fix`。

## Git 状态

- 当前源码分支：`zhennn/week10-charts-binance`。
- Week 10 从 `main@7f974e0` 分出；功能与测试提交为 `bdc7a84`、`375a96f`、`dfa75a0`、`247eb8e`、`28eb0fe`、`45f2359`、`06cef3b`。
- 当前功能分支未合并、未 push、未 rebase，等待用户审查。
