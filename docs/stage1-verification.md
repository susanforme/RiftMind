# 一期实施与验证记录

日期：2026-10-19。状态：**主体实现已落地，尚未完成一期全部验收**。
本记录区分实现、已执行检查和未验证项目，不能把已写 workflow 或模拟数据当作生产证据。

## 已实现的链路

- 独立 `riftmind-core` workspace 默认成员；Windows 宿主 guard 保留，Mac core/类型生成不执行宿主 build.rs。
- Rust 版本化 DTO、SCREAMING_SNAKE_CASE 错误、Command 注册表及事件信封；ts-rs 生成共同 TS 输入/输出类型。
- desktop / fixture / dev-harness 同一 transport；fixture 与本地桥入口仅开发加载。生产包隔离检查已执行。
- TanStack hash Router、Query、Zustand 工作标签、左侧导航；玩家键/区服隔离、标签关闭/排序、草稿、滚动及会话保存。
- default 语义主题，light/dark/system；未知主题回退；i18next 五个命名空间和简中/英语，无 localStorage 配置副本。
- 设置页的偏好、实例选择、连接重试、同步范围、存储、备份、恢复、诊断与更新入口。
- 对局列表的本地查询、队列/英雄/日期筛选、稳定游标分页、同步任务和取消，保留离线数据与来源信息。
- SQLite 八张业务表，真实事务、WAL/FK/busy timeout；内容去重与修订、任务检查点、重启续跑、账号代次隔离。
- 已参考映射的国服/外服识别；未知/冲突/PBE 阻止远端。SGP SUMMARY 优先，同区受控 LCU 回退，不请求 DETAILS。
- Windows 进程发现、LCU HTTP/WS 订阅重连、会话轮询、entitlements 刷新合并和赛后同步入口。
- 按版本清单核验的 Community Dragon 英雄/装备/符文/技能资源解析，哈希缓存、同版本语言回退、离线图像与占位。
- 备份/恢复/诊断持久化维护任务；恢复校验哈希、schema、完整性与外键，保留旧副本，更新 workspaceEpoch。
- Windows Store/SQL 插件池注入、托盘/单实例、安全退出、受控原生文件选择、CSP、窗口权限与轮转日志。
- 官方 Updater 检查、下载/签名、进度和退出协调；无生产配置时明确不可用。
- 本地 harness 随机回环端口、进程凭据、Origin 白名单、命令注册表、合成 HTTP 服务与资源；Windows/Mac workflows。

## Mac 已执行

| 检查 | 结果与适用范围 |
| --- | --- |
| `bun run check` | 通过：TypeScript、ESLint、中英 key/插值、明暗 token 对齐、fixture 哈希、生成契约差异 |
| `bun run test:unit` | 6 项通过，含语言/主题、路由验证、标签和保存失败保留草稿 |
| Rust core 全套（维护任务改动阶段） | 14 项通过；真实临时 SQLite、HTTP、备份、离线重启、取消、切号、资源缓存、检查点恢复等 |
| 后续针对性测试 | 维护任务备份/恢复结果可观察测试通过；LCU participantIdentities 匹配与补刀计算测试通过。当前源码共 18 项 core 测试，最后四项是在全套之后分别执行（含中断恢复的跨文件回滚） |
| `cargo clippy -p riftmind-core -p dev-harness --locked -- -D warnings` | 通过 |
| `cargo fmt --all --check` | 通过 |
| 浏览器 E2E | 曾有 3/3 通过：设置真正进程重启；HTTP 同步/筛选/分页/备份/恢复/离线重启/切账号；两页明暗中英及 800×600 |
| 最后一次 E2E 复测 | **未执行**：后续维护任务/资源/更新状态/截图等待调整后，自动审批服务多次容量不足或超时；不能沿用先前 3/3 作为最终源码全套通过证据 |
| `bun run build` / `check:production` | 通过，产物未包含 fixture/harness 入口或合成凭据。主 JS 约 507 KB，有 Vite chunk 大小提示 |
| 宿主源码/测试的 Mac 类型检查 | 仅报告预期 Windows compile_error，无其他类型错误；这是源码检查，不是 Windows 构建或原生测试通过 |

性能样本：macOS/aarch64、10,000 条合成摘要、每页 50 条、100 次查询，p95 **11.58ms**；
批量写入约 **715ms**。硬件型号和进程峰值内存未测得；debug 构建，不能推断 Windows 性能。

手动浏览器检查覆盖初始空列表、设置和 HN1 合成同步。8 组截图已人工查看，发现截到了切换过渡：
测试已改为等待活动导航、已保存状态与 color-scheme，并禁用截图动画；新的完整视觉基线仍待最终 E2E 重跑与审阅。

## Windows CI

**未执行。** 当前目录没有 Git 元数据、远程仓库或可用 Windows runner。

已提供 Windows build、Store 插件持久化/保存失败测试，以及官方 Updater 本地签名成功/篡改失败测试。
更新测试只下载合成字节，不运行安装器；测试密钥只保留公钥和签名，生产代码不引用测试包。
交互式托盘、单实例、窗口拖动、退出、WebView2、缩放与安装升级测试需要独立交互式 runner。
未配置烟测命令时 workflow 显式失败，不能宣称原生通过。

## 真实客户端联网

**未验证。** 没有在 Windows 登录的国服或外服客户端上执行 T18。
所有服务器条目的等级是 `reference_only`，PBE/PREPBE 为不支持环境。
LCU 会话字段、token 生命周期、接口等价性、端点可达性与跨服边界仍需逐区实机核验。

## 生产发布

**未配置。** 没有正式更新 URL、公钥对应的生产私钥、更新托管或 Windows 代码签名证书。
当前不能作为正式签名发布包交付。代码会返回 UPDATE_NOT_CONFIGURED，不谎报最新版本。
正式 updater 制品配置、Windows 签名与安装升级验收仍需发布环境完成。

## 尚需完成的验收与限制

- 在审批可用后执行 `bun run verify:stage1`，补齐最终源码的完整报告；随后运行 Windows CI 与实机验收。
- 当前 fixture 控制有固定时钟；harness 的真实 HTTP 重试使用 Tokio 时间，尚没有覆盖全矩阵的可控时钟/事件脚本。
- T06/T07/T15 等仍缺完整的多进程/WS 断连、并发 401 刷新和事件丢失/乱序自动化场景；不能将现有 18 项测试等同于 T01–T22 全覆盖。
- 已加入恢复回滚日志，Mac 故障注入证明下次启动可一起还原 DB/设置；Windows 启动迁移失败后的插件重建、原生恢复回滚和磁盘满/锁占用故障注入仍需更全面验证。
- 托盘退出标签已接入共享语言资源和 Windows 系统语言解析，随设置事件更新；仍待 Windows 原生 i18n 验收。
- Windows 更新安装/失败恢复及下载进度只完成实现和源码类型检查，未执行宿主签名测试与原生安装测试。
- E2E 的八组截图和 keyboard/portal/contrast/缩放基线尚需扩充。已测核心明暗文本 token 配对均达到 4.5:1；实际页面、浮层和原生缩放仍需人工验收。
- 备份/诊断的原生文件导出在返回时会等待核心维护任务完成；大库下的完整任务进度、取消与打断恢复仍需原生验收。

这些条目保留为未完成，不通过勾选清单掩盖。总体范围仍只有设置与列表，未新增二期业务页面。

## 2026-10-19 UI 调整复查

已参考 Akari 官方截图和主题源码，调整侧栏、标签、对局卡片及设置分组。
本次通过应用内浏览器完成两页 × 中英 × 明暗共 8 组截图，以及 800×600
窄窗口、模式筛选/重置、侧栏折叠、设置分组跳转、语言和外观保存检查。
控制台无警告或错误；开发图片未进入生产包。证据及修复记录见
[design-qa.md](../design-qa.md)。

`bun run check`、6 项前端单测、最终 production build 和 production isolation
检查通过。旧 E2E 的标题和导航定位已同步到新 UI；本次未重新运行完整 Rust
harness E2E。以上浏览器检查使用明确标记的模拟数据，不替代 Windows 原生、
真实客户端、发布签名或完整 T01–T22 验收。
