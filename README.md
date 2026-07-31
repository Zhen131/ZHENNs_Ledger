# Local-First Personal Trading Ledger

一个使用 Next.js、React 和 TypeScript 构建的浏览器本地优先交易账本原型。

## 当前状态

截至 2026-07-31，Week 10 的三图、Binance 行情与收尾修复均已完成。当前解析版本为
Next `15.5.22`、React / React DOM `19.2.8`、ESLint `9.39.5` 和
eslint-config-next `15.5.22`。02B 指出的 Next WebSocket upgrade SSRF 已通过升级关闭；
旧未来事实已提供逐条纠正入口，普通危险删除统一为两段确认。03D 独立验收没有发现 P0，
形式上的两个 P1 是长按 Enter 后取消会吞掉下一次点击，以及常驻备份警告少写
“应用不主动上传”；产品负责人已接受这些低风险项并批准主线收口，不再追加开发或复验。
`LedgerData.schemaVersion` 仍为 `1`。Week 9 的 IndexedDB V2 静态加密账本不再是正常入口：若检测到旧完整账本，用户只能先解锁并迁移到新的 C，待新 C 关闭、复读、身份和内容验证成功后，再以固定文本确认删除旧记录。

Week 11 第一批 `.lftl` C 文件合同与安全保存已经通过 01D-6 最终独立复验：
FILE-001、FILE-002、FILE-004、FILE-005 完成。用户可以通过系统文件选择器新建或选择一个
`.lftl`；同名目标由操作系统询问是否替换，取消则不写入，用户主动确认替换后允许创建新 C。
第二批实现已经完成 C 正式接管、上一版恢复、单写入者、重连、密码生命周期与安全清空；02C 独立复跑确认 51 个测试文件、596 项测试以及 typecheck、lint、production build 和 whitespace 全部通过，没有发现强制 FAIL。02D 最终仍判 BLOCKED：受自动化环境限制，真实 Google Chrome 没有弹出 macOS 系统文件选择器，因而缺少真实文件、权限、双标签页和 raw IndexedDB 等强制浏览器证据。该结论不能表述为最终独立 PASS，六个 FILE 目标也不能据此回写完成。含手续费净盈亏、单条编辑、新首页、历史 K 线和 NLP 录入仍属于待实现或待验收范围。
本 README 只陈述源码事实，不能替代外层 000、00A、00B 或批次执行与独立审查文档。

Week 11 第一批候选实现与独立结论：

- 候选实现包含 `.lftl V1` 文件合同、唯一文件句柄、current + previous 双代、保存后同句柄复读，以及 C 会话 capability 接入。
- 01D-2 已关闭 salt metadata 漂移、旧 picker 复活和正式测试缺口；新增 9 项正式对抗测试。
- 01D-3 独立重跑确认 F-01～F-03 有效，同时因 KDF 版本常量耦合判定 F-04 / FILE-001 强制失败。
- 01D-5 开发修复已新增格式无关的显式参数 primitive；C V1 与 IndexedDB V2 分别使用自己的版本常量，V2 原包装接口不变。
- 修复前固定 C V1 密文兼容测试通过；独立全量为 49 个测试文件、445 项测试，typecheck、lint、production build 和 diff-check 通过。
- 真实 Chrome 完成宿主可见 `.lftl`、外层保密、BTC / ETH / ADA 保存、错密零写入、正密重开、picker 取消和 300 / 301 / 302 双代闭环。
- 01D-6 最终判定 PASS；FILE-001、FILE-002、FILE-004、FILE-005 已允许回写外层 00B。

Week 11 第二批实现与 02D BLOCKED 边界：

- 正常产品入口只使用用户选定的 `.lftl`；IndexedDB 仅保存独立的 C 连接记录（文件句柄和最小身份信息），不保存密码、解密材料、完整 `LedgerData` 或隐藏回退账本。
- current 损坏、previous 有效时提供可取消的恢复；使用 `isSameEntry()`、跨页面 lease、短时写锁和写前复读，防止同一真实文件被双写或旧页面覆盖。
- 刷新重连、权限丢失、文件移动 / 删除、错选文件和旧异步结果全部 fail closed；密码只活在当前运行期，立即锁定先处理未保存内容，再清除密码并释放文件。
- 已迁移的 legacy IndexedDB 完整账本只在新 C 经过完整复核且用户固定文本确认后删除；取消、失败、源数据变化或卸载晚到时都保留 legacy。
- 清空只允许 ready C 在明确确认后进行：保存合法空账本为新 current，旧 current 成为 previous，关闭和复读验证成功后才显示完成。

当前已实现：

- 交易表单：校验成功后写入 `LedgerData.trades`，列表和持仓同步更新。
- 统一删除确认：普通交易、Binance 映射、未来事实逐条删除和删除全部未来事实均使用共享两段按钮；第一次确认不 mutation、不保存。
- 安全删除：普通或未来交易在第二次确认后都先重放完整交易时间线；若会破坏后续卖出依赖则拒绝删除。
- 未来事实纠正：未来交易和未来价格可按完整 ID 逐条删除，同日期同资产记录仍可区分，失败保存保持 dirty 并可重试。
- 价格表单：写入 `PriceSnapshot` 后更新最新价格、市值和未实现盈亏。
- 真实交互回归：覆盖合法新增、非法输入、超卖、安全删除、价格联动。
- 整账运行时校验：保存或恢复前检查 schema、实体、Decimal、日期、引用、唯一性和交易时间线。
- IndexedDB 静态加密：PBKDF2-SHA-256（600,000 次）派生不可导出的 AES-256-GCM 会话密钥。
- V2 密文 envelope：固定记录槽位保存版本、KDF、salt、IV 与 ciphertext；每次保存使用新 IV。
- 启动访问门禁：严格区分首次设置、已有密文解锁、旧/未知格式、损坏密文与读取失败。
- 首次设密恢复：密文写入成功但验证回读失败时保留 V2 record，页面自动转入重新解锁，不再停留在首次设置死路。
- 会话边界：密码和 `CryptoKey` 不持久化，刷新或关闭后必须重新输入密码。
- 密码临时核对：设置、确认和解锁三处密码均支持小眼睛按住查看，松开、失焦、页面隐藏、disabled 或 submit 后立即恢复遮蔽。
- 忘记密码重置：未解锁状态必须输入固定确认文本，只删除当前加密账本记录。
- 安全 hydration：恢复数据真正进入 reducer 前保持 `loading`，禁止 dispatch 和自动保存。
- 串行自动保存：快速连续修改按顺序写入；失败时保留页面状态并显示错误。
- 保存状态语义：页面区分“已加入账本”“正在保存到本地”“已保存到本地”和保存失败。
- 失败安全重试：最新保存失败可重试，旧 snapshot、旧 Repository generation 和重复点击不能覆盖新账本。
- dirty 离开保护：pending / save error 会标记未落盘，离开页面或切换 Repository 前会警告或要求明确放弃。
- ResourcePolicy：v1 限制文件 8 MiB、assets 500、trades 25,000、priceSnapshots 5,000、feeRules 500 和关键字符串长度。
- 超限保护：既有结构合法但超限的账本只读恢复；新 mutation 在进入 reducer 前拒绝，禁止自动保存与 clear 覆盖旧数据。
- 自动化重挂载验收：使用真实组装链和 fake IndexedDB 证明交易、价格可在卸载后恢复。
- 安全 clear：legacy IndexedDB 只在已验证迁移后以固定文本删除；ready C 的 clear 以固定文本二段确认，写入空账本的新 current，不删除 `.lftl` 文件。
- 通用持久化操作互斥：dispatch、自动保存和 clear 共用同步 operation ref 与写队列；重复 clear 共享同一 Promise。
- clear 生命周期保护：覆盖排队写入、前置保存失败、clear 失败、Repository 切换和组件卸载。
- clear 后空库保护：清空成功不自动保存初始账本；第一次新用户写入才重新生成 record。
- 完整账本备份：`BackupEnvelopeV1` 只包含版本元数据与完整 `LedgerData`，不包含 `Position[]`。
- 明文备份边界：备份区常驻提示未加密风险；导出只声明已发起浏览器下载，并要求核对实际结果、保存位置和同步目录风险。
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
- 派生边界：`Position[]`、分配切片、曲线点、热力等级、当前估值模式和选中日期均不进入 `LedgerData`、C、连接记录或备份。

当前自动化结果：

```text
Week 11 第二批独立自动化：51 个测试文件、596 项测试通过
Week 11 第一批最终独立自动化：49 个测试文件、445 项测试
Week 11 原 F-01～F-03 对抗测试：salt 三路径、Hook 状态门、5 类 stale-selection 场景 PASS
Week 11 F-04 开发修复：C V1 / IndexedDB V2 参数显式分流，固定 C V1 fixture PASS
Week 11 最新独立结论：02D BLOCKED（真实 Chrome / 系统 picker 关键证据缺失；未发现强制 FAIL）
Week 10 收尾修复开发侧回归：42 个测试文件、383 项测试
npm run typecheck -> 0 error
npm run lint  -> 无 warning / error
git diff --check -> 通过
```

独立测试与最终处置：

```text
前次 T0 -> 41 files / 362 tests、lint、build、diff-check 通过
T2 -> timeout / offline / 418 / 429 / 500 / partial 全部通过
前次 T3 -> 未来事实隔离与整体恢复通过；交易/价格逐条删除 FAIL
T4 -> mapping / 整账替换 / 并发普通交易的旧响应保护通过
T5 -> 响应式与重新解锁恢复通过；raw V2 envelope 证据 BLOCKED
前次 T6 -> Next WebSocket SSRF 为 production 可达 P1
本轮开发侧 -> T3 缺口与 T6 框架漏洞已修复；42 files / 383 tests 与质量 Gate 通过
03D 复验 -> 真实下载、reduced-motion、V2、备份恢复、真实 Binance 和多数受控场景取得证据
最终处置 -> 无 P0；产品负责人接受两个形式 P1、两个 P2 与测试基础设施 BLOCKED，批准收口
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
- `Position[]` 与全部图表数据由事实临时推导，不写入 reducer、C、连接记录或备份。
- 数量和金额使用 `DecimalString -> decimal.js`，不使用 JavaScript 浮点数重算账本。
- 不可信表单、IndexedDB 和未来 JSON 输入必须先通过运行时校验。
- 市场价缺失就是缺失；不得以成交价、成本、未来价格或 `0` 伪造。
- Binance 是可失败的外部输入，不是本地账本可用性的前置条件。
- UI、Service 和 Reducer 不直接操作 IndexedDB 或 File System Access API。
- legacy IndexedDB whole-blob 使用 AES-256-GCM 静态加密；正常账本在 C，IndexedDB 只保存 C 的连接记录。Noop EncryptionService 仅供隔离测试。
- 明文备份不属于 IndexedDB 静态加密范围，备份 UI 必须在操作前常驻披露未加密、浏览器保存位置和同步目录风险。
- `dev` / `start` 的项目脚本默认显式绑定 `127.0.0.1`，减少开发者误暴露；使用者仍可通过额外命令行参数覆盖 hostname，这不是绝对网络隔离。
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
  repositories/  C 与 legacy 的整账 load / save / clear、迁移和运行时校验边界
  encryption/    IndexedDB V2 与候选 .lftl 文件合同、Base64URL、PBKDF2 和 AES-GCM
  adapters/      legacy IndexedDB whole-blob、C 连接记录与文件句柄适配器
  coordination/  同一真实 C 的跨页面 lease 与短时写锁
  composition/   legacy 迁移与 C 正常入口的组装点
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

建议使用 Node.js 20、22 或 24+。项目脚本默认只监听本机 loopback：

```bash
npm ci
npm run dev
```

浏览器访问：

```text
http://127.0.0.1:3000
```

完整检查：

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

## 已知限制与后续范围

- Binance 只读取最新公开价格，不读取历史 Kline/OHLC，不轮询、不使用 WebSocket；网络、地区、限流或 CORS 失败时保留旧事实并继续使用本地账本。
- production UI 能证明未来新事实拒绝；受控测试确认既有 future 事实不会进入持仓和三图，并能按 ID 逐条删除未来交易和价格。
- 手动/自动估值模式只属于当前解锁会话，刷新后回到自动模式。
- 用户导出的备份仍是明文文件；加密备份不在 Week 10 范围。
- `.lftl` C 文件第二批已通过独立自动化与质量门，但 02D 因真实 Chrome / 系统 picker 关键证据缺失判 BLOCKED；不得将其说成最终 PASS、iCloud 自动同步或多设备协调。B 仍是明文救援材料，不由应用自动上传或删除。
- 分页、virtual list 和大账本性能预算仍待后续 benchmark 定义，不能据此宣称 25,000 笔交易流畅；benchmark 已保留但不再是当前 Week 11 的直接开发入口。
- 历史 K 线和单资产详情页已经进入外层产品共识，但源码仍未实现；情景价格、未来价格模拟、动画、主题、指标、dataZoom、账户、订单和下单同样不属于当前能力。
- 开发侧在线复核确认原 Next SSRF advisory 不再命中。`npm audit --omit=dev`
  仍将 Next 的传递 `postcss` / `sharp` 链聚合为 high：当前应用仅处理仓库内受信任 CSS，
  未使用 `next/image` 或直接调用 sharp，也没有不可信 CSS / 图片处理入口，因此没有识别出
  可达的 production high / critical；这不是声称 audit 归零。本轮未执行 `npm audit fix`。

## Week 10 发布基线

- Week 10 功能源码验收基线：`5a21529c10d4a27048e4d26d07c7a1641e4c7b87`。
- 收尾修复功能提交：`39a0ab6`、`bf77864`、`ad8c5ff`、`c88f06a`、`225434f`。
- 03D 保留独立测试的原始“不通过”事实；产品负责人随后接受剩余低风险并批准合并发布。
- 实际分支、远端同步和发布状态以 Git 当前 `main` 为准，不再由 README 保存易过时的“未合并”快照。
