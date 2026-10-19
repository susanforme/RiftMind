# RiftMind

仅支持 Windows 的英雄联盟本地对局工具。提供设置、对局列表、复盘与训练进展页面，使用
Tauri 2 / React / Rust / SQLite。macOS 用于开发和测试 core 与浏览器页面，不发行 Mac 客户端。

一期历史验证见 [一期验收记录](docs/stage1-verification.md)，本次实现与验证见 [二期验收记录](docs/stage2-verification.md)。
**尚未完成 Windows 原生验收、真实客户端联网验收和生产签名发布。**

二期实施规格见 [二期计划：可解释复盘、时间线与训练闭环](todo/stage2.md)。

## 环境与启动

需要 Bun 1.3.14、Rust 1.97.1；浏览器测试需要 Playwright Chromium。

```sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run dev:mock
```

打开 http://localhost:1420 。左侧导航包含对局、进展与设置；顶部标签按玩家与区服隔离。
模拟模式有固定标识，数据仅在内存中，可通过开发工具栏切换无客户端、国服、外服、等待授权、冲突等场景。
`fixture.ts` 提供重置、固定时钟及一次性错误注入；它不能证明数据库或网络代码正确。

真实核心的集成预览：

```sh
bun run dev:integration
```

脚本启动只监听 `127.0.0.1` 随机端口的 Rust harness、独立模拟远端和 Vite，并在退出时关闭子进程。
每次默认创建新的临时工作目录，路径显示在终端；不扫描本机 LoL，不读取真实设置或凭证。
希望测试重启持久化时显式指定独立测试目录：

```sh
RIFTMIND_TEST_DIR=/tmp/my-riftmind-test RIFTMIND_SCENARIO=tencent bun run dev:integration
# 停止进程后复用同一目录，以离线模式启动：
RIFTMIND_TEST_DIR=/tmp/my-riftmind-test RIFTMIND_SCENARIO=offline bun run dev:integration
```

Windows PowerShell 先设置 `$env:RIFTMIND_TEST_DIR` / `$env:RIFTMIND_SCENARIO`，再运行同一脚本。
不要把此路径指向正式工作区。备份与诊断保存在测试目录 `backups/` 中，浏览器用引用 ID 恢复。
开发工具栏只改变测试场景，不属于第三个业务页面。重置场景不会删除已缓存战绩；需要全新状态时使用新目录。

harness 使用进程级随机凭据、Origin 检查、封闭 Commands 注册表和请求大小限制。
访问令牌仅注入开发 Vite；正式构建只有 desktop IPC，连接失败不会自动改用模拟数据。

## 开发与生产模式

| 命令 | 模式 | 数据来源 | 开发工具栏 |
| --- | --- | --- | --- |
| `bun run dev:mock` | development | 内存模拟数据 | 显示 |
| `bun run dev:integration` | development | 测试 Rust / SQLite | 显示 |
| `bun run tauri dev` | development | 桌面 IPC | 隐藏 |
| `bun run build` / `bun run tauri build` | production | 桌面 IPC | 排除 |

`.env.development` 与 `.env.production` 分别保存两种模式的默认配置。
本地覆盖写入 `.env.development.local`（不提交）：

```dotenv
VITE_DEV_TOOLS=false
VITE_TRANSPORT=desktop
```

`VITE_DEV_TOOLS` 控制开发工具栏和测试备份编号输入；只在 development 模式生效。
`VITE_TRANSPORT` 支持 `desktop`、`fixture`、`dev-harness`，后两者只在开发时加载。
开发模式默认开启工具栏；可用 `.env.development.local` 或命令行环境变量关闭。
集成桥接令牌由启动脚本临时注入，不写入环境文件。

生产命令固定使用 production 模式。预览工具栏、开发文案和样式、模拟数据、测试图片、
HTTP/WebSocket 测试桥接均通过编译期条件和动态导入排除。
构建同时检查模块依赖和最终产物；即使外部误设 `VITE_TRANSPORT=fixture` 或
`VITE_DEV_TOOLS=true`，生产构建也不会加载开发模块。
`bun run test:e2e` 默认使用独立端口 1421；可通过 `RIFTMIND_E2E_PORT` 修改。

## 检查

```sh
bun run check
bun run test:unit
cargo test -p riftmind-core --locked
bun run test:e2e
bun run verify:stage2
```

`verify:stage1` 依次运行类型/lint/翻译/token/fixture 哈希/生成契约检查、前端测试、core 测试、
harness E2E、生产构建与测试代码隔离检查，写入 `.stage1-report.json`。
E2E 每个用例独立创建临时目录，含真正的 harness 进程重启；失败保留截图、trace、场景目录与脱敏 core 日志。
基础页面截图在测试输出中保存；截图需要人工审阅，不能以更新文件代替验收。

```sh
cargo fmt --all --check
cargo clippy -p riftmind-core -p dev-harness --locked -- -D warnings
bun run generate:contracts
bun scripts/fixture-manifest.ts
```

Rust DTO、错误、任务、事件与 Commands 是类型权威，通过 ts-rs 11.1.0 生成 TS。
修改 fixture 生成器后须审阅并刷新哈希。`Cargo.lock` 与 `bun.lock` 锁定依赖；SQL 插件 2.6.0
和 core 共用 SQLx 0.8.6。根 workspace 默认只构建 core，**Mac 不运行 `cargo test --workspace`**。

## Windows 宿主

安装 [Tauri Windows 前置依赖](https://v2.tauri.app/start/prerequisites/#windows) 后：

```sh
bun run tauri dev
cargo test -p riftmind --locked
bun run tauri build
```

安装包位于 workspace 的 `target/release/bundle/`。首次使用需启动并登录 LoL 客户端。
单个实例自动识别；多实例在设置中选择进程实例，用户无需手选国服模式。
每个服务器映射均带 `reference_only` 验证等级；PBE/PREPBE 明确不支持。未知/冲突区服不发送猜测请求。
国服与外服的 SUMMARY 使用对应配置和 entitlements 凭证，授权等待期间不立即回退。
404/有限网络重试失败才允许同区 LCU 回退；403/429 不换源，401 合并刷新一次。

正式配置与数据库在 `%APPDATA%\com.springbreeze.riftmind`。Rust 是 SQLite 唯一业务入口；
Store 保存版本化设置。启动先检查配置/数据库和迁移前备份，再动态初始化 SQL 插件并注入生产池。
备份含数据库、设置和资源解析记录；不含本地下载的资源文件。恢复先校验并保留当前副本，再用事务替换投影，
更新 workspaceEpoch。恢复回滚日志在下次启动处理跨文件中断；初始化失败显示恢复界面，旧文件不自动删除。

窗口默认关闭到托盘；可在设置改为退出。退出停止接单，等待同步/维护的安全点，再保存设置并关闭池。
宿主只向主窗口提供业务 dispatcher 和必要窗口能力，无通用 SQL/Shell/文件权限。
生产 CSP 与缓存资源范围独立于开发配置。日志只记录错误码、request ID 等脱敏字段，不记录命令行和令牌。

## 本地版本资源

资源通过 Tauri 异步自定义协议 `http://cdragon.localhost/<patch>/plugins/...` 按需读取。
首次使用由 Rust 从固定的 CommunityDragon 来源下载，上游 JSON 与 PNG 均保存；下载校验成功后原子落盘。
以后直接读取本地文件，不使用 TTL、ETag、HEAD 或后台更新；同版本上游修正不会自动替换首次下载的副本。
同路径并发下载合并，失败短暂冷却；半截文件、非法路径、重定向、超限响应及损坏 PNG/JSON 不会成为成功缓存。
仅明确版本可落盘，不使用 `latest`。文件被手动清理或读取损坏后才重新下载。

- 正式安装版和便携版：`riftmind.exe` 同级的 `assets/cdragon/<patch>/...`。
- `tauri dev` 和手工 `dev:integration`：项目根目录 `.riftmind-dev/assets/cdragon/<patch>/...`，Git 已忽略；与数据库、构建目录独立。
- 集成/自动化测试：显式 `RIFTMIND_TEST_DIR` 下的独立 `assets/`，不会污染开发或正式资源。
- 设置中的清理资源会清除这个资源目录，不影响战绩、复盘、笔记或设置；应用升级和普通卸载保留资源。

Windows 安装包统一使用 NSIS `currentUser`，无需管理员权限。新安装必须选择独立空目录；
识别到本应用的旧目录时允许升级并复用 assets，混有其他文件、链接目录、受保护系统路径或不可写目录会拒绝安装。
便携版也必须解压到独立可写目录，启动会检查资源目录写权限，不会静默切换保存位置。
默认不再生成 MSI，以免其安装模式绕开资源目录限制。

验证：`cargo test -p riftmind-core --locked`、`cargo test -p riftmind --locked`（宿主模拟测试可在 macOS 运行），
以及 Windows 上 `./scripts/test-installer.ps1`（先构建 NSIS，或传入 `-Makensis` 指定编译器）。
浏览器集成测试使用相同 Rust 下载层和本地桥接路由；Windows WebView2 原生请求仍需原生环境验收。

## 更新与发布

未设置更新环境时，页面明确显示“更新服务未配置”，不会显示“已是最新”。
构建时可设置 `RIFTMIND_UPDATE_URL`（HTTPS）与 `RIFTMIND_UPDATE_PUBLIC_KEY`，官方 Updater
执行检查、下载及签名校验，安装前走统一退出协调。不要把签名私钥提交到仓库。
正式发布还需要 updater 制品生成配置、更新托管、生产私钥与 Windows 代码签名证书。
测试公钥与合成签名包仅供 `#[cfg(test)]` 的宿主测试，不安装或打包进正式应用。

`.github/workflows/core.yml` 负责 Mac core/浏览器检查；`windows.yml` 编译宿主、执行 Store/签名测试，
使用仓库 `rust-toolchain.toml`、Bun 1.3.14 和锁文件，在 Windows runner 上构建 x64 NSIS 安装版。

- 自动构建：推送到 `master` 时执行；目标为 `master` 的 PR 执行 Windows 检查与构建，不上传分发产物。
- 手动构建：Actions → **Windows x64 build** → **Run workflow** → 在 **Branch** 下拉框选择分支。
  workflow 文件须先存在于默认分支，选中的分支也须包含此 workflow。
- 构建成功后，在该次运行的 **Artifacts** 下载以下三个文件，保留 14 天；不创建 GitHub Release。

| 文件（`<version>` 为应用版本，`<commit>` 为实际构建提交的短 SHA） | 用途 |
| --- | --- |
| `RiftMind-<version>-<commit>-source.zip` | `git archive HEAD` 导出的已提交源码，含锁文件，不含 `.git`、未提交文件和构建目录 |
| `RiftMind-<version>-<commit>-windows-x64-setup.exe` | NSIS 安装程序；缺少 WebView2 时默认联网安装运行时 |
| `RiftMind-<version>-<commit>-windows-x64-portable.zip` | 解压后直接运行 `riftmind.exe`，附使用说明；需要已安装 Microsoft Edge WebView2 Runtime |

便携 ZIP 免安装，资源保存在 exe 同级 `assets/`；配置和数据库仍写入 `%APPDATA%\com.springbreeze.riftmind`，不会随 ZIP 目录迁移。
CI 和本地默认均只生成 NSIS；上传时直接保留文件格式，不额外套 ZIP，也不上传报告、日志和校验和文件。
SHA256 输出到构建日志。构建产物尚未代码签名，Windows 可能显示 SmartScreen 提示。
本地 `bun run tauri build` 默认同样生成 NSIS，并应用目录检查钩子。

手动运行时默认不执行交互式原生验收。需要验收时勾选 `native_acceptance`，
并准备自托管 `interactive-riftmind` runner 和 `RIFTMIND_NATIVE_SMOKE_COMMAND`；缺少条件会失败，不伪报通过。
工作流配置验证不能替代 Windows 原生或真实 LoL 客户端验收。

配置依据：[GitHub 手动选择分支](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、
[Tauri Windows 安装包与 WebView2](https://v2.tauri.app/distribute/windows-installer/)、
[Tauri 社区 action 的便携模式说明](https://github.com/tauri-apps/tauri-action#usage)、
[直接上传单文件产物](https://github.com/actions/upload-artifact#usage)。

## 诊断与边界

- 端口 1420 被占用：先关闭上一预览；脚本不抢占其他进程。
- harness 启动失败：检查 Cargo 编译日志、临时目录权限，不把失败误当成离线模拟成功。
- 设置冲突：保留草稿，重新读取修订后再保存；不会用标签会话覆盖设置表单。
- 区服不支持/授权未就绪/远端限流：仍可查看、筛选和分页本地缓存。
- 历史资源缺失：显示对象 ID 和占位，使用同版本语言回退，不静默改用 latest。
- 合成 fixtures 的来源、哈希和许可见 [tests/fixtures](tests/fixtures/README.md) 与 [第三方声明](third-party/NOTICE.md)。

二期已接入按需详情、确定性报告、证据、图表、笔记/反馈和本地训练评估。列表不会批量下载 DETAILS；从“查看复盘”进入后补全，已有报告可离线阅读与写笔记。训练目标需用户确认采用，至少 5 场可比样本才建立数值基线和后续评估。没有 AI/LLM、QQ101 或云同步。

复盘与进展页面继续组合 shadcn/ui；图表按需加载 ECharts，并提供数值表。旧报告和证据笔记固定原输入，重算保留旧版本；笔记冲突保留草稿。二期备份支持一期升级、证据引用校验与工作区隔离。

完整范围和平台待验收项见 [二期计划](todo/stage2.md) 与 [二期验收记录](docs/stage2-verification.md)。
