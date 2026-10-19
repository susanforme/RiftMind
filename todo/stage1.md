# 一期计划：完整基座、设置页、对局列表

状态：主体实施中，尚未完成全部验收。日期：2026-10-19。实现与已执行检查见 [一期验收记录](../docs/stage1-verification.md)；未勾选项仍需补齐或验证，不能视为完成。

总体架构见 [架构设计](../docs/architecture.md)。本文决定一期交付范围；总体架构中的复盘、图表、训练闭环等安排不得扩大一期页面范围。

## 1. 一期交付目标与范围

交付一套可以继续开发复盘功能的完整 Windows 应用基座，以及两个可实际使用的页面：**设置页 `/settings`、对局列表 `/matches`**。根路由跳转对局列表。连接信息、任务进度和启动/恢复提示放在应用外壳、页内区域或弹窗，不新增第三个业务页面。

前端基座参考 Akari 的 **左侧功能区 + 顶部多标签 + 主内容区**。多标签承载上述两个页面的实例，不增加业务页面类型。一期完整实现默认配色下的浅色、暗色和跟随系统；未来可扩展粉色等主题，但一期不实现额外主题、主题市场或主题编辑器。

产品仅支持 Windows；开发者当前使用 macOS。**Mac 可以开发和自动测试业务核心及页面，不要求安装 LoL，也不构建或发布 macOS 桌面客户端。** 保留 Windows 宿主限制，不为运行测试而删掉该限制。

“完整基座”包含真实业务链路：启动检查、类型化 IPC、自动识别国服/外服、LCU 会话、国服 SGP 优先的数据选择、同步任务、Rust SQLite、Store 配置、i18n、版本资源、日志诊断、备份恢复、退出管理、Windows 构建与更新基础，以及贯穿这些模块的可重复测试。不能以静态假数据页面、空接口或仅安装依赖作为完成。

| 一期必须交付 | 一期明确不交付 |
| --- | --- |
| 自动发现客户端，识别国服/外服、具体区服及当前账号 | 视频录制、ROFL 解析、局内浮窗 |
| 当前账号与本地已保存账号的对局列表、筛选、分页、同步及离线阅读 | 玩家搜索、跨区远端玩家查询的 UI、批量多账号同步 |
| 设置、语言、主题、连接状态、同步偏好、存储维护及诊断 | 复盘详情页、时间线详情、训练目标和反馈页 |
| 真实持久化、任务取消/恢复、资源缓存与错误恢复 | 指标分析引擎、QQ101 统计、AI/LLM、云账号和云同步 |
| 全部基座能力的适配边界、实现、测试入口及验收记录 | 为未来功能创建空表、空服务、无行为的设置开关 |

列表使用 SUMMARY 和已验证的 LCU 等价结算字段，一期不批量请求 DETAILS。Apache ECharts 保留总体选型，随图表页面接入；一期没有图表，不引入图表运行代码。

## 2. 固定技术与工程边界

| 层次 | 一期方案 |
| --- | --- |
| 宿主 | Tauri 2 + Rust，Windows 原生交互限定于宿主 |
| 页面 | React + TypeScript、TanStack Router hash history、Tailwind CSS + shadcn/ui |
| 应用外壳 | 参考 Akari 的左侧功能导航、顶部工作标签和内容布局，使用现有 React 技术栈实现 |
| 视觉主题 | 语义化 CSS tokens；配色 themeId 与 light/dark 模式分离，一期仅 default 配色 |
| 状态 | TanStack Query 管理 Commands 查询结果；Zustand 仅共享临时 UI 状态；筛选归 Router |
| i18n | i18next + react-i18next，本地打包简体中文与英语文案 |
| 业务核心 | 独立 `riftmind-core` Rust crate：模型、转换、识别策略、同步、任务、配置规则及存储用例 |
| SQLite | 官方 Tauri SQL 插件管理生产连接池与迁移；core 的存储接收兼容版本的 SQLx SqlitePool |
| 配置 | 生产使用 Tauri Store Plugin；核心定义设置 schema、校验、迁移与保存规则 |
| Windows 基础 | 单实例、托盘、日志、受控文件选择/外链、更新插件；应用侧负责状态和权限 |
| 资源 | Rust 管理 Community Dragon 版本映射、清单、下载和本地图片缓存 |
| 自动化 | Vitest + React Testing Library；Playwright 浏览器 E2E；Rust 测试 + 临时 SQLite + 本地 HTTP/WebSocket fixtures |

依赖的准确兼容版本在 S1-0 验证并锁定，特别是现有 Vite/TypeScript、Rust 工具链、SQL 插件与 SQLx。Rust → TS 生成方案须同时覆盖 DTO、错误、Commands 和事件，先以实际枚举/空值/字符串 ID 验证，再选定并锁定工具，避免前后端手写两套类型。

### 2.1 为 Mac 测试建立最小工程拆分

目标目录（按实现创建）：

```text
Cargo.toml                         # workspace；默认成员仅 core，Mac 不隐式构建 Tauri 宿主
crates/riftmind-core/
  src/{contracts,domain,clients,services,storage,settings}/
  tests/                           # 使用真实业务代码与临时 SQLite
src-tauri/
  migrations/                      # 生产和测试复用同一组迁移
  src/{main,app,bootstrap}.rs
  src/adapters/                    # Windows 发现、Store、日志、托盘/更新等宿主适配
tools/dev-harness/                 # 仅开发/测试：调用 core 的本地桥接程序
src/
  app/                             # Router、QueryClient、providers、启动外壳
  app/shell/                       # AppShell、侧栏、工作标签栏、窗口控制
  app/theme/                       # 模式解析与默认主题定义；未来主题的唯一扩展入口
  routes/                          # 仅 matches、settings 与根路由/错误处理
  features/{matches,settings}/
  components/ui/
  styles/themes/default.css        # default 配色的 light/dark 成对语义变量
  stores/workspace-tabs.ts          # 标签元数据、顺序及非活动视图快照，不复制业务数据
  generated/                       # Rust 生成的类型和绑定
  lib/transport/                   # desktop、fixture、dev-harness 三种接入
  i18n/locales/{zh-CN,en-US}/
tests/
  fixtures/                        # 脱敏或明确标记为合成的数据、事件、资源及来源清单
  e2e/                             # 两页的浏览器回归
.github/workflows/                 # Mac/core 检查与 Windows 构建/宿主测试
```

- [x] Windows API、Tauri、Store/SQL 插件不作为 core 的依赖；core 不引用窗口、AppHandle 或全局 Tauri state。
- [x] 宿主通过插件取得生产池并注入 core；Mac 测试自行创建临时 SQLite 池，使用相同迁移、查询与事务代码，不用内存 Map 代替数据库。
- [ ] `ClientDiscovery`、设置持久化、事件接收、时钟等外部边界可替换；仅为实际 I/O 建接口，不构造通用依赖注入框架。
- [x] 国服/外服判断、来源选择、去重、状态迁移放在 core；Windows 适配器只收集原始发现信息和执行原生操作。
- [x] 测试使用临时目录和专用数据库，禁止读取开发者的真实客户端凭证、正式设置或历史库。
- [x] Mac 的 core 测试和类型生成无需执行 `src-tauri/build.rs`，无需 WebView2、Windows SDK 或 LoL。

### 2.2 一期 Commands、错误与事件契约

| Commands | 输入/输出和范围 |
| --- | --- |
| `get_app_state` / `get_connection_state` | 启动状态、workspaceEpoch、当前实例/身份、识别结果和端点能力；不含凭证 |
| `list_client_instances` / `select_client_instance` / `retry_connection` | 列举脱敏候选并选择实例 ID；前端不指定端口、token 或任意进程 |
| `get_settings` / `update_settings` | 返回设置及修订；更新按字段校验并提交 expectedRevision |
| `list_players` / `list_matches` | 查询本地缓存；按玩家键、合法筛选、游标及有限 page size 返回摘要 |
| `sync_player_matches` | 一期只接受当前会话玩家，提交范围预算并返回持久化 taskId；缓存玩家不自动触发远端查询 |
| `get_task_status` / `cancel_task` | 按 taskId 读取/取消任务，取消只在安全检查点生效 |
| `resolve_assets` | 输入版本/资源 ID/语言，返回引用、实际版本和可用性；不接受任意 URL |
| `get_storage_usage` / `clear_asset_cache` | 分类占用和图片缓存清理结果，不删除业务库 |
| `create_backup` / `restore_backup` / `export_diagnostics` | 通过受控文件选择得到目标引用，长任务返回 ID；恢复进入维护流程 |
| `check_for_updates` / `install_update` | 通过宿主更新服务执行并返回真实状态；无配置返回明确不可用原因 |

错误包含 `code / params / retryable / requestId`，有任务时带 taskId。至少区分 `APP_NOT_READY`、`CLIENT_NOT_FOUND`、`WAITING_AUTH`、`REGION_UNKNOWN`、`REGION_CONFLICT`、`ENDPOINT_UNSUPPORTED`、`RATE_LIMITED`、`SETTINGS_CONFLICT`、`STORAGE_UNAVAILABLE`、`UPDATE_NOT_CONFIGURED`；展示文案由 i18n 映射，内部详情只进入脱敏日志。

事件包括应用/连接/任务/战绩/设置/资源/更新状态变更与 `workspace-reset`。信封统一包含 runtimeId、workspaceEpoch、sequence 和对象修订；不直接推送完整战绩表。订阅后读快照，事件用于精确失效；漏发、重载、恢复焦点时从本地对账，不隐式触发远端同步。

## 3. 基座工作清单

### S1-0：先建立可测试工程与契约

- [x] 完成上述 workspace 拆分，保留 Windows 宿主编译限制；提供明确的 Mac 命令，不使用会构建宿主的默认 `cargo test --workspace`。
- [x] 建立版本化 DTO、错误码、事件信封和 Commands 注册表；外部 ID 跨 IPC 用字符串。
- [x] 建立 `desktop / fixture / dev-harness` 传输选择；业务组件只依赖同一接口，不分叉渲染逻辑。
- [x] 默认生产构建仅包含 desktop；模拟模式只能通过显式开发入口启用，并显示固定“模拟数据”标识。桌面 IPC 故障不能自动切换成假数据。
- [ ] 提供 fixture 场景重置、时钟控制、错误注入和可重复事件脚本；测试互不共享状态。
- [x] 完成 Router、QueryClient、Zustand、Tailwind、shadcn/ui 基础配置，删除模板 greet 和演示 UI。
- [ ] 完成 AppShell、侧栏、多标签与路由联动；实现主题 tokens 和模式解析，具体交互与设计验收见 4.0。
- [ ] 在安装更多业务依赖前，让 core 单元测试、一条真实 SQLite 测试和两个空路由的浏览器导航测试可运行。

验收：Mac 不启动 Tauri 即可运行 core 测试和浏览器预览；生成契约能被两页与所有测试适配器共同消费。

### S1-1：启动、配置、数据库和生命周期

- [ ] 启动状态为 `booting / migrating / ready / recovery_required / shutting_down`；本地 ready 与客户端联网状态独立。
- [ ] 顺序固定为单实例、配置/库版本检查、迁移前备份、迁移、本地服务 ready、恢复任务、发现客户端。
- [ ] SQL 插件 preload 会执行迁移，因此必须在迁移前检查通过后初始化；验证初始化失败仍能显示恢复界面，不能先迁移后备份。
- [ ] `settings.json` 使用 Store 持久化，字段校验、默认值、schema 迁移、串行保存和 `expectedRevision` 冲突处理完整。
- [ ] 语言、主题模式、侧栏折叠、有效标签会话、关闭窗口行为、自动连接、自动同步、同步范围等偏好重启可恢复；保存失败不显示成功，保留编辑草稿。
- [x] Rust 是 SQLite 唯一业务入口；移除 `src/lib/database.ts`、前端 SQL 依赖与通用 SQL 执行权限。
- [x] 一期建表：`players`、`matches`、`match_participants`、`source_snapshots`、`match_revisions`、`jobs`、`sync_state`、`resource_manifests`。不提前建立复盘、目标和模型表。
- [ ] 迁移与连接配置包含外键、WAL、有限 busy timeout；在各池连接验证配置，事务内不请求网络。
- [ ] 备份包含数据库、配置和资源清单；可下载图片可省略。恢复先校验、保留旧数据，再进入维护状态替换，失败可恢复旧工作区。
- [ ] 恢复后更新 `workspaceEpoch`，清空旧查询缓存、游标和任务订阅；缺失图片重新解析。
- [ ] 单实例、托盘、关闭到托盘/真正退出有完整行为；退出停止接单、取消网络、保存检查点和配置，在安全点关闭连接。
- [ ] 日志轮转、敏感字段脱敏、诊断导出、磁盘满/损坏/锁占用错误全部有状态及测试。

验收：设置和对局重启可恢复；迁移失败不破坏旧库；浏览器+harness 能验证数据库备份/恢复，Store 插件及原生退出行为另由 Windows 宿主测试验证。

### S1-2：自动识别国服/外服与客户端连接

**客户端归属、具体服务器、界面语言是三个独立维度。** 不按系统语言、IP、时区、昵称或安装路径名称推断国服；不能把所有外服合并为一个固定端点。

- [ ] Windows 发现器取得候选实例的 PID、启动标识、端口和启动参数；凭证留在 Rust，完整命令行不得写日志。lockfile 可用于连接信息，但不单独证明区服。
- [ ] 解析显式 `region`、`rsoPlatformId`，兼容已核实的 `--rso_platform_id` / `--rso-platform-id` 写法，保留原值供规范化。
- [ ] 结合已验证的 LCU 会话字段核对身份；识别证据冲突或关键字段缺失时返回 `unknown / resolving / conflict`，重新发现，不默认成国服或某个外服。
- [ ] 规范化输出含 `realm: tencent | riot | unknown`、`environment: live | pbe | unknown`、`serverId`、`region`、`rsoPlatformId`、`mappingVersion` 和脱敏识别依据。
- [ ] 国服使用显式区服映射，外服使用显式别名映射和端点能力表；复用 Akari 已核实逻辑时保留出处，不能直接用拼接结果当域名。
- [ ] 配置覆盖参考源码中的国服和外服条目，逐条标记已验证/待验证/不支持；PBE 与正式服隔离，未知区服不发送带凭证的猜测请求。
- [ ] 单客户端自动连接；多个候选时在外壳/设置页选择实例，选择后仍自动识别区服，不要求用户手动选择“国服模式”。
- [ ] 连接、登录等待、两类 token 就绪、WS 重连、进程退出、切号和休眠恢复形成完整状态机。
- [ ] 每次实例/身份变化更新 sessionEpoch；旧请求不能提交到新会话，同一凭证类型的 401 刷新合并。

| 识别结果 | 一期数据路由 |
| --- | --- |
| 已识别国服，SGP 配置/对应 token/能力就绪 | SGP 优先获取战绩 SUMMARY |
| 国服 token 尚未初始化 | 等待授权；不因为慢就立即回退 LCU |
| 已识别外服，有已核实 SGP 配置和能力 | 使用对应外服 SGP；不会复用国服 URL 或令牌用途 |
| 已识别国服或外服，SGP 确认不支持或有限重试失败 | 仅按能力表允许同区 LCU 回退；保存来源和回退原因 |
| 401 / 403 / 429 | 分别刷新一次/明确失败/服务冷却；不切源绕过权限或限流 |
| 未识别、冲突、未支持环境 | 展示状态与诊断入口；本地战绩继续可读，不发猜测性远端请求 |

一期不提供跨区远端查询 UI，但来源策略仍要测试“跨区不得回退当前区 LCU”。自动识别通过样本测试不等于所有区服均已联网验证，验证等级必须可查询。

验收：相同的纯 Rust 识别函数在 Mac fixtures 和 Windows 生产发现器中执行；覆盖国服、多个外服、别名、大小写、缺失、冲突、多进程及切服场景。

### S1-3：战绩同步、任务与版本资源

- [ ] 首次连接同步最近一页；手动同步、赛后补拉和重连对账复用同一入口；自动同步可关闭。
- [ ] 只同步当前已登录账号；历史缓存可以在独立列表标签查看。切号时激活新账号标签，旧标签保留明确的玩家/区服及本地缓存身份，不把旧标签内容重新绑定到新账号。
- [ ] 分页有范围/页数预算，按对局键去重，处理新对局插入导致的偏移变化，展示实际覆盖范围。
- [x] 分离 source DTO 与标准列表模型；未知队列/英雄保留原始 ID，缺失统计保存空值，不填零。
- [ ] 原始快照、新修订、列表投影、任务阶段和检查点在短事务中协调提交；相同内容不反复增加修订。
- [ ] 任务持久化后返回 ID；重复请求合并，有限并发/超时/退避/429 冷却、取消和重启恢复可测。
- [ ] 当前用户操作优先于历史补拉与资源预取；已提交数据在取消后仍可读取。
- [ ] Community Dragon 只下载列表所需英雄、装备、符文/召唤师技能等资源和名称数据；按对局版本解析，不镜像全站。
- [ ] 资源清单记录版本、语言、路径和哈希；缺失图标有占位，缺失名称显示翻译后的“未知对象 + ID”。
- [ ] 离线读取本地图片；缓存清理不删除对局及清单依据；资源失败不阻塞对局入库。

验收：真实 core+SQLite 链路完成“同步 → 关闭 harness → 重启 → 离线查列表”，并能证明取消、重复分页、失败重试和切号不会串数据。

### S1-4：权限与发布基础

- [ ] Commands 使用窗口权限和业务入参校验，不暴露任意 SQL、URL、文件路径和 Shell 执行入口。
- [ ] 生产 CSP、asset protocol 缓存范围、外链协议和外部文本渲染受控；昵称/资源描述不执行 HTML。
- [ ] LCU 回环连接绕过代理，本地 TLS 处理不影响 SGP/资源远端 TLS；凭证不跨源或跨会话。
- [ ] Windows CI 编译宿主、执行适配器测试、构建 MSI/NSIS，并保存日志/产物；Mac 不冒充 Windows 构建验证。
- [ ] Updater 接入检查、下载、签名验证和重启协调的完整状态；设置页展示版本及更新状态。
- [ ] 没有发布地址/密钥时明确显示“更新服务未配置”，不得返回“已是最新”；使用测试密钥和本地更新 fixture 验证成功/失败签名流程，不在正式包中携带测试密钥。
- [ ] 测试 harness、场景控制和 fixture 凭证不进入正式安装包；CI 检查生产构建入口与打包内容。

发布服务地址和签名证书属于发布环境配置；可在尚无生产发布环境时完成可配置且已测的更新基座，生产签名发布状态单独记录。

## 4. 两个页面的完整规格

### 4.0 前端外壳：参考 Akari

参考 Akari 的布局与交互组织，使用 React + Tailwind + shadcn/ui 实现 RiftMind 自己的外壳；不引入 Akari 的 Vue/Naive UI 或 Electron 层。参考代码的侧栏具有折叠和固定功能区域，玩家标签支持激活、关闭与排序；以下是适配一期范围的明确设计，不声称逐像素复刻。

```text
┌──────────────┬──────────────────────────────────────────┐
│ RiftMind     │ 对局·玩家A  对局·玩家B  设置   窗口控制   │
│              ├──────────────────────────────────────────┤
│ 对局列表     │ 当前标签的工具栏、筛选与状态               │
│              │                                          │
│              │ 对局列表 / 设置内容                       │
│              │                                          │
│ 连接状态     │                                          │
│ 模式 / 设置  │                                          │
└──────────────┴──────────────────────────────────────────┘
```

**左侧功能区与窗口布局：**

- [ ] 侧栏顶部为品牌区，中部为业务入口，底部固定连接状态、模式切换和设置入口；一期只展示对局列表和设置，不放未实现功能的空按钮。
- [ ] 支持展开/折叠；折叠态保留图标、选中标识和双语 tooltip。持久化用户折叠偏好，窄窗口临时折叠不覆盖用户偏好。
- [ ] 标签栏固定在内容区上方，列表/设置内容独立滚动；侧栏和窗口控制不随长列表消失。长标题省略并提供完整名称提示。
- [ ] Windows 标题栏留出明确拖动区域；标签、菜单、关闭按钮和窗口控制排除拖动命中。最小化、最大化/还原、关闭通过受控宿主能力执行，关闭窗口遵循托盘偏好。
- [ ] 初始设计按 1280×800 展开，兼顾现有 800×600 窗口下的折叠布局；尺寸为设计起点，不锁死像素。内容和标签使用各自的溢出策略，窗口缩小时不能挤掉关闭按钮或核心操作。

**顶部多标签行为：**

| 行为 | 一期规则 |
| --- | --- |
| 标签类型 | 设置为单例；对局列表按玩家键（含区服）唯一。无客户端且无缓存时显示一个默认列表标签 |
| 打开与激活 | 左侧入口激活已有标签；本地玩家选择提供“在新标签打开”，同一玩家重复打开只激活已有标签，不触发重复远端同步 |
| 当前账号变化 | 默认空标签可在首次识别后绑定玩家；已绑定玩家的标签不随登录身份换内容。切号激活新账号标签，旧账号仍可浏览缓存，远端同步只对当前登录账号开放 |
| 切换与保留 | 每个列表标签保留自己的筛选、分页和滚动位置；设置草稿在切换时保留，不因非活动页面卸载丢失 |
| 关闭 | 支持关闭当前、关闭其他和关闭右侧；活动标签关闭后优先激活左邻，再右邻。最后一个标签关闭后回到默认列表，不退出窗口 |
| 未保存设置 | 设置标签关闭前可选择保存/放弃/取消；保存失败保持标签和草稿。批量关闭先确认草稿处理，再统一更新标签集合 |
| 排序与溢出 | 支持拖动排序及键盘可用的左右移动操作；标签过多时横向滚动并提供标签列表菜单，活动标签自动进入可见区 |
| 任务与生命周期 | 关闭标签只解除视图订阅，不自动取消 Rust 同步任务；取消任务必须走显式操作。只挂载活动页，避免每个标签重复建立监听和定时器 |
| 键盘与可访问性 | 标签具有 tablist/tab/tabpanel 语义、选中状态和键盘导航；关闭按钮有独立名称，焦点在切换/关闭后落到合理目标 |

**状态归属与会话恢复：** Router 是当前活动标签 ID、页面和有效搜索参数的权威；Zustand 保存打开标签、顺序、非活动标签最后位置及临时草稿。非活动路由快照仅用于恢复，不成为另一份正在生效的筛选状态；Query 缓存仍按玩家/筛选/workspaceEpoch 去重，不按标签复制战绩数据。

Store 中增加版本化 `workspaceTabs` 与 `sidebarCollapsed` 偏好，仅持久化可校验的标签键、顺序、有效路径/搜索参数和活动标识，不保存业务响应、凭证或未提交设置草稿。标签会话写入与设置保存由 Rust 按字段串行合并，避免标签自动保存覆盖编辑中的设置；持久化失败保留本次会话并提示无法恢复。恢复数据库后重新核验玩家键并丢弃失效游标。浏览器刷新、前进/后退、恢复已关闭标签对应的历史路径都必须经过同一标签解析器，避免路由与高亮各自变化。

### 4.0.1 浅色/暗色与未来多主题的设计

**配色与明暗是两个维度：** `themeId` 描述配色方案，`colorModePreference: light | dark | system` 描述用户模式偏好，`resolvedColorMode: light | dark` 是当前计算结果。一期仅注册 `themeId = default`，设置页和快捷入口只提供浅色、暗色、跟随系统，不显示粉色等未实现主题选项。

未来增加 `pink` 等主题时，添加同一份 token 契约下的 light/dark 成对变量与主题元数据即可；页面、侧栏和标签不得出现按主题 ID 分支的业务逻辑。主题 ID 和模式偏好保存在 Store，解析结果不持久化。遇到未识别 themeId 使用 default 并记录可诊断的回退，不加载任意外部 CSS。

| 设计层次 | 必须覆盖的语义变量与状态 |
| --- | --- |
| 应用外壳 | 窗口背景、侧栏、标题/标签栏、内容面板、分隔线；两种模式都能区分层次 |
| 文本与交互 | 正文、次级文字、禁用、链接、hover、pressed、selected、键盘焦点 |
| 标签 | 活动/非活动、悬停、关闭、拖动、未保存、任务状态；使用边框/指示和文字辅助，不只换背景色 |
| 表单与浮层 | 输入、下拉、开关、弹窗、菜单、tooltip、toast、遮罩和滚动条；portal 内容同样使用根主题 |
| 对局语义 | 胜/负/重开/未知、SGP/LCU 来源、连接状态、错误/警告/成功；配色变更不能改变语义 |
| 游戏图片 | 保持原图色彩，不使用全局反色；透明图标和占位在两种背景上都可辨识 |

- [ ] 以 CSS 自定义属性定义颜色、表面和语义状态，映射到 Tailwind/shadcn/ui；组件消费语义 token，不散落硬编码浅色/暗色值。新增 token 必须同时有 light/dark 定义。
- [ ] 根节点设置 themeId 与模式选择器，并同步浏览器 `color-scheme`；只在 system 模式订阅系统变化，显式 light/dark 不被系统变化覆盖。
- [ ] 侧栏快捷入口与设置页共享同一 `update_settings` 和解析逻辑；保存成功后统一应用，保存失败保留旧模式并显示错误，不另存 localStorage 主题。
- [ ] 启动先解析已保存偏好再显示业务外壳，启动背景与最终主题协调，避免每次启动先闪一屏白色。恢复模式使用可用的本地默认 tokens，不依赖联网。
- [ ] 切换主题不重建 Router/QueryClient、不重载页面、不触发远端同步；保留当前标签、滚动、筛选、表单草稿及焦点。
- [ ] 中文/英文、展开/折叠、活动/非活动标签、加载/空/错误状态在两种模式下都设计；普通正文对比度以至少 4.5:1 为验收目标，焦点和选中状态可辨识。
- [ ] 动画只作用于必要的颜色/交互变化，遵循减少动态效果偏好；不对整个页面使用笼统 `transition: all` 导致布局晃动。
- [ ] Windows 窗口背景、标题栏/窗口按钮与主题协调；Mac 浏览器测试只验证 Web 外壳，原生窗口效果保留 Windows 验证项。

设计交付包括：两页各自的浅色/暗色布局、token 对照表、标签/侧栏交互状态、浮层和失败状态。先完成 default 的两套成品，再开始页面业务接线；不把“支持 dark class”作为设计完成。技术依据见 [shadcn/ui 主题](https://ui.shadcn.com/docs/theming)、[Tailwind 暗色模式](https://tailwindcss.com/docs/dark-mode)。

### 4.1 设置页 `/settings`

| 分组 | 一期必须可用的内容 |
| --- | --- |
| 通用 | 跟随系统/简体中文/English、浅色/暗色/跟随系统、侧栏展开/折叠、关闭到托盘/退出；一期无额外配色主题选择器 |
| 客户端 | 自动连接开关、当前客户端/账号/国服外服/区服/识别状态、多实例选择、重试连接 |
| 同步 | 自动同步开关、默认历史范围、最近同步状态；不开放修改底层端点或无限并发 |
| 存储 | 数据/图片缓存占用、清理图片、创建备份、恢复备份、恢复影响说明 |
| 诊断 | 应用/数据库/配置版本、脱敏连接状态、导出诊断；失败显示稳定错误及 request ID |
| 更新 | 检查更新、可用版本/进度/失败状态；未配置发布服务时明确说明 |

- [ ] 设置初始读取有加载、失败及重试状态；修改、保存中、已保存、失败和版本冲突可区分。
- [ ] 主题/语言保存成功后全局应用；失败保留草稿并恢复已保存的全局配置，不出现“界面变了但重启丢失”。
- [ ] 点击恢复备份或退出到安全点有真实反馈；维护状态阻止新的同步/设置写入。
- [ ] 原生文件对话框在 Windows 使用受控适配；浏览器 harness 通过测试专用上传/下载边界走相同备份用例。
- [ ] 表单标签、校验消息、弹窗、工具提示、键盘焦点和危险操作说明双语完整。
- [x] 不显示未实现的 AI、图表或训练设置；不把假开关当作“基座预留”。

### 4.2 对局列表 `/matches`

| 区域 | 一期必须可用的内容 |
| --- | --- |
| 上下文 | 当前标签绑定玩家、国服/外服及具体区服、连接状态；本地玩家可在独立标签查看，明确当前登录账号 |
| 操作 | 手动同步、同步进度/取消、已保存数量、最后同步时间及历史覆盖范围 |
| 筛选 | 队列/模式、英雄、时间范围；筛选和分页进入已校验的路由参数 |
| 对局行 | 胜负/重开/未知、英雄图标和名称、模式、比赛时间、时长、KDA；有数据时展示位置、补刀和装备 |
| 数据状态 | SGP/LCU 来源、回退或缺失说明；不把未知英雄/队列或空字段当解析失败 |
| 分页 | 本地默认 50 条、最大 100，稳定排序和游标；新记录通过刷新列表头部展示 |

- [ ] 明确区分首次无数据、筛选无结果、同步中、失败但缓存可读、尚有历史未加载和不支持区服。
- [ ] 离线仍能筛选、分页和查看缓存；所有远程失败都不清空现有列表。
- [ ] 切号后清理旧会话请求、激活新玩家标签；旧标签保持原玩家缓存身份。恢复数据库后核验所有标签并清理失效游标；刷新和前进后退保留合法筛选。
- [ ] 一期不添加“打开复盘”死链接，不生成详情页；行内信息已满足列表浏览需求。
- [ ] 键盘可操作、状态不只靠颜色、长英文/玩家名不撑破布局，Windows 常见缩放比例纳入检查。

## 5. i18n 必须一期完成

- [x] 使用 i18next + react-i18next，内置 `zh-CN`、`en-US` 两套资源；命名空间按 `common / settings / matches / errors / connection` 拆分。
- [ ] Store 保存 `languagePreference: system | zh-CN | en-US`；首次默认 system，系统中文映射简体中文，其余语言回退英语。读取系统语言失败时回退简体中文并可手动改。
- [ ] 明确区分 `languagePreference`、`resolvedUiLanguage`、客户端 locale 和实际资源 locale；切语言不改变区服、端点、账号或数据源策略。
- [x] 禁止 i18n detector 自动写 localStorage 形成第二份偏好；配置权威来源保持 Rust/Store，测试适配器模拟相同契约。
- [ ] 错误、任务和连接状态由 Rust 返回 code + 有类型的参数，React 翻译展示；托盘/原生提示使用共享翻译资源或受校验的对应子集。
- [ ] 日期、数字和复数使用语言规则，数据库保留 UTC 和原始值；时间范围查询统一转换为 UTC，比赛时长不按时区转换。
- [ ] 游戏名词来自匹配版本和语言的资源；翻译缺失时回退同版本资源，再显示 ID，不用更换区服解决语言缺失。
- [ ] 两种语言 key 和插值参数一致；所有可见静态文案、错误、空状态、保存提示、ARIA 标签和模拟标识均覆盖。（页面 key/参数检查已通过；原生托盘随语言切换仍待 Windows 验收。）
- [ ] 自动测试系统语言选择、手动覆盖、重启保持、缺失 key、长英文布局，以及“英文国服/中文外服”组合。

参考：[i18next 配置](https://www.i18next.com/overview/configuration-options)、[react-i18next](https://react.i18next.com/)。

## 6. Mac 上怎么开发和测到真实逻辑

### 6.1 三种运行接入

| 接入 | 用途 | 数据与持久化 |
| --- | --- | --- |
| desktop | Windows 正式应用 | Tauri IPC → 相同 core → SQL 插件池 / Store / 实际客户端 |
| fixture | Mac 快速页面开发、穷举异常状态 | 类型化命令与事件模拟；明确标识模拟模式，不据此证明数据库或网络逻辑正确 |
| dev-harness | Mac 集成与浏览器 E2E | 浏览器 → 仅开发本地桥 → 相同 core → 临时真实 SQLite + 本地 LCU/SGP/资源模拟服务 |

dev-harness 是测试工具，不是新增产品服务：仅绑定 `127.0.0.1` 随机端口，使用进程级随机访问凭据、Origin 白名单和封闭命令注册表；不接受任意 URL/SQL/文件路径。不依赖生产 `.env` 密钥，不扫描本机 LoL，不允许外网监听。场景控制和模拟端点覆盖只存在于测试构建。

浏览器和桌面复用页面、query options、DTO、错误语义和事件桥；仅 transport 不同。harness 复用实际 HTTP 客户端/解析/同步/事务代码，模拟外部响应，不能另外写一份“测试专用同步算法”。设置适配使用临时 JSON 文件实现同一持久化契约，**其通过不代表 Tauri Store 插件已验证**，Windows 测试还要跑生产适配器。

- [ ] 本地 mock HTTP/WS 服务支持响应序列、断连、延迟、401/403/429、分页变动；SGP/LCU/资源服务使用不同模拟来源以检测令牌泄漏。
- [ ] 时间与重试测试使用可控时钟，等待业务状态而非固定长 sleep；取消测试验证真实取消检查点。
- [ ] fixtures 有来源、脱敏方法、schema 版本与哈希；合成数据明确标注，不能标为实际国服/外服抓包。
- [ ] 至少有一个集成场景真正重启 harness 并复用同一测试目录，验证持久化，而非只刷新浏览器内存。
- [ ] Playwright 失败输出截图、trace、场景 ID 和脱敏 core 日志；每个用例有独立工作目录。
- [ ] Windows 宿主测试复用同一套 core fixtures，验证 Tauri Commands、权限和事件序列与 harness 契约一致。

### 6.2 必须实现的开发/检查命令

下列是计划中的脚本名称，**当前尚未实现**。实现时在 README 写明依赖及一键启动方式，脚本自动管理 Vite、harness 和 fixture 服务的启动/退出。

| 命令 | 执行环境与职责 |
| --- | --- |
| `bun run dev:mock` | Mac/Windows：启动两页 fixture 预览，场景切换为开发控件，不新增业务路由 |
| `bun run dev:integration` | Mac/Windows：启动浏览器、Rust harness、模拟远端和独立持久化测试目录 |
| `bun run check` | 类型检查、lint、翻译完整性与生成契约差异检查 |
| `bun run test:unit` | Vitest + 组件测试，覆盖两页与事件/查询边界 |
| `cargo test -p riftmind-core --locked` | Mac/Windows：核心逻辑、真实 SQLite、网络 fixtures 与配置契约 |
| `bun run test:e2e` | Playwright 驱动 dev-harness，验证真实 core 和两页闭环 |
| `bun run verify:stage1` | 汇总 Mac 可运行检查、core 测试、E2E 和前端构建，输出验证报告 |
| `bun run tauri build` | 仅 Windows：生产构建，测试服务和模拟入口不进入包 |

Mac 的集成测试使用 Playwright Chromium，验证 Web 前端交互；它不是 Windows WebView2 的原生验收。Tauri 原生 mock 同样不执行实际 WebView，不能把它当作完整宿主验证。[Tauri 测试说明](https://v2.tauri.app/develop/tests/)、[Cargo workspace](https://doc.rust-lang.org/cargo/reference/workspaces.html)。

## 7. 场景与验收矩阵

| 编号 | 场景 | 必须断言 | 主要验证层 |
| --- | --- | --- | --- |
| T01 | 首次启动、无客户端 | 两页可用、创建库/配置、连接提示正确 | Mac core + E2E |
| T02 | 国服 TENCENT + 已知区服 | 自动识别，SGP 优先，当前玩家列表入库 | Mac core + HTTP fixtures + E2E |
| T03 | 外服及别名，如 NA/NA1、EUW/EUW1 | 映射到正确条目，不请求国服端点 | Mac core + fixtures |
| T04 | 中文外服、英文国服 | 语言不改变识别和路由；页面文案正确 | Mac E2E |
| T05 | 未知区服、缺字段、冲突、PBE | 明确状态，不猜测 URL，不串正式服数据 | Mac core + E2E |
| T06 | 多实例、切号/切服、旧响应晚到 | 当前会话唯一，旧响应不覆盖新账号 | Mac core + scripted WS |
| T07 | token 未就绪、并发 401、403、429 | 等待不误降级、刷新合并、拒绝/冷却正确 | Mac core + HTTP fixtures |
| T08 | SGP 同区降级及跨区请求 | 同区按规则回退且标来源，跨区不走当前 LCU | Mac core |
| T09 | 分页重复/移动、任务取消、崩溃恢复 | 对局不重复，检查点一致，覆盖范围不夸大 | Mac SQLite integration |
| T10 | 离线重启、切换本地玩家、筛选与分页 | 实际 SQLite 数据可读，路由/账号键隔离 | Mac harness + E2E |
| T11 | 设置保存、失败、冲突、重启 | 配置持久化，失败保留草稿、不伪报成功 | Mac contract + E2E；Windows Store adapter |
| T12 | 中英切换、system、缺 key、长文案 | 偏好持久化、key/参数一致、布局不溢出 | Mac unit + E2E |
| T13 | 历史资源缺失、下载失败、清理缓存 | 占位与版本明确，对局记录不丢失 | Mac HTTP + SQLite + E2E |
| T14 | 备份/恢复、迁移失败、较新 schema | 先备份后迁移，旧数据可恢复，缓存 epoch 更新 | Mac core；Windows 初始化顺序 |
| T15 | 事件重复/丢失、页面刷新 | 查询快照对账正确，无重复监听和陈旧界面 | Mac E2E + Windows IPC adapter |
| T16 | 敏感日志、恶意昵称/路径/超大参数 | 日志脱敏、文本不执行、非法输入拒绝 | Mac unit/E2E；Windows capability |
| T17 | 单实例、托盘、真正退出、更新签名 | 宿主行为正确，未配置和签名失败有真实状态 | Windows CI 的宿主/打包测试 |
| T18 | 已登录的真实国服/外服客户端 | 实际发现、凭证、端点、列表字段与行为匹配 | 后续 Windows 真实客户端验证 |
| T19 | 标签打开/去重/排序/关闭、筛选隔离、草稿及重启恢复 | 路由与高亮一致，玩家不串号，草稿不误丢，关闭视图不取消后台任务 | Mac unit + harness E2E |
| T20 | 浅色/暗色/system、运行时系统切换、保存失败 | 显式模式不被覆盖，偏好重启保留，无状态重置或额外远端请求 | Mac unit + E2E |
| T21 | 两页 × 明暗 × 中英、侧栏折叠、溢出标签和浮层 | 8 组基础视觉基线，核心状态均可读；缩放与拖动区域分别检查 | Mac 截图/键盘 E2E；Windows 原生窗口 |
| T22 | token 契约与未知 themeId | 默认主题明暗 tokens 完整，未知 ID 安全回退；无粉色等主题选择入口 | Mac unit + production build 检查 |

性能基线：1 万条合成摘要，50 条分页；在记录硬件的机器上观察本地查询 p95、同步批次耗时和内存。以 p95 500ms 为初始目标，Mac 结果只记录为 Mac 测量，不推定 Windows 性能。网络性能由可控 fixture 测量重试与超时边界，不用公共接口速度决定 CI 成败。

主题测试使用 Playwright 模拟系统 colorScheme 并在运行中切换，实际检查 portal、图标占位、胜负状态和键盘焦点，不只断言根节点 class。截图使用固定 fixture、字体与时间，人工检查首次基线；更新快照不能替代审阅。Mac 上分别检查 1280×800 与 800×600，Windows 的 100%/125%/150% 缩放和标题栏拖动另行验收。

## 8. 执行顺序与完成判定

| 顺序 | 交付 | 退出条件 |
| --- | --- | --- |
| 1 | S1-0 工程、契约、传输、外壳与明暗设计基线 | Mac core/SQLite/路由测试可运行，侧栏/标签行为与两套 tokens 明确 |
| 2 | S1-1 持久化与启动 + i18n/主题/标签会话 | 设置保存/重启/恢复、中英/明暗切换和标签恢复贯通 |
| 3 | S1-2 识别/会话 + S1-3 同步/资源 | 国服、外服和错误场景在同一 core 链路通过 |
| 4 | 两页全部交互与异常状态 | 不依赖 LoL 的浏览器闭环完整通过 |
| 5 | S1-4 权限/更新/Windows 基础及回归 | CI 产物、权限、生产打包隔离和验证记录齐全 |

### 8.1 Mac 上可完成的验收

- [ ] 所有一期业务逻辑、两页、翻译、备份与恢复均有真实实现，非静态 mock 交付。
- [ ] `verify:stage1` 可重复通过，包含 Rust SQLite 集成与 harness 浏览器测试。
- [ ] fixtures 覆盖 T01–T16、T19–T22 的 Mac 部分，测试断言关键结果，不能只判断页面无报错。
- [ ] 左侧功能区、顶部多标签和两页明暗设计全部落地；未来多主题只保留 token/配置扩展边界，一期没有额外配色主题实现。
- [x] README 说明模拟/集成启动、场景重置、测试目录、错误排查和 Windows 构建入口。
- [x] 没有新增复盘/详情/训练页面，设置中没有无行为的占位配置。

### 8.2 Windows CI 与真实环境的独立状态

- [ ] 提交 Windows workflow，运行 Windows 宿主编译、适配器测试、安装包构建和可自动化的原生冒烟，产物与日志可追踪。
- [ ] 宿主桌面交互需要交互式 session 时明确 runner 前置条件；不能静默跳过后标记通过。
- [x] 若当前没有远程仓库/可用 runner，记录为“Windows CI 未执行”，不能仅凭 YAML 已写好宣称通过。
- [ ] T18 独立记录国服和外服验证区服/客户端版本/结果；普通 hosted runner 没有真实客户端时保持“未验证”。

最终交付报告必须分别列出 **Mac 自动化结果、Windows CI 结果、真实客户端联网结果、生产发布配置状态**。当前 Mac 环境可以完成计划中的开发与模拟验证，不等待真机才开展；但“Windows 原生已验证”“国服/外服实际可联网”和“可正式发布”不能由模拟测试代替。

## 9. 参考与后续边界

- [总体架构](../docs/architecture.md)：状态归属、SGP 优先、版本资源、备份与证据设计。
- [Akari 客户端参数解析](https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/main/shards/league-client-ux/ux-command-line-parser.ts)：国服/外服识别输入；移植代码需保留许可。
- [Akari 服务器标识规范化](https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/shared/utils/sgp.ts)：区服别名依据，不能替代实际连接验证。
- [Akari 服务配置](https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/main/shards/akari-api/builtin.ts)：国服与外服配置条目及能力参考。
- [Akari 左侧功能区](https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/renderer/src-main-window/components/sidebar/Sidebar.vue)：侧栏折叠与固定区域的布局参考。
- [Akari 顶部玩家标签](https://github.com/LeagueAkari/LeagueAkari/blob/56cdfde00e56148f4641d1a8cf86acb66e903124/src/renderer/src-main-window/components/titlebar/player-tabs-title/PlayerTabsTitle.vue)：标签激活、关闭与排序的交互参考。
- [Community Dragon 资源文档](https://github.com/CommunityDragon/Docs/blob/master/assets.md)：版本资源和路径解析。

二期才加入 DETAILS、复盘详情、指标证据、ECharts 和训练闭环；一期的 core、存储和事件契约应能承接它们，但不以提前实现二期功能证明基座完整。
