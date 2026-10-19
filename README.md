# RiftMind

基于 Tauri、React 和 TypeScript 的桌面应用，计划接入 Riot LCU，仅支持 Windows，自动识别国服/外服及具体区服。
Windows 宿主需要在 Windows 上运行和打包；macOS 开发与测试方案采用独立 Rust 核心、真实 SQLite、模拟服务和浏览器，两者不等同于 macOS 产品支持。

一期工作见 [一期计划](todo/stage1.md)：完整基座、设置页、对局列表、简体中文/英语 i18n，以及 Mac 可运行的开发与自动化测试链路。文档中的新增脚本和工程拆分尚待实施。

一期 UI 参考 Akari 的左侧功能区和顶部多标签，支持浅色、暗色及跟随系统。主题配色与明暗模式分离，为未来粉色等主题保留扩展边界；一期只实现默认配色。

架构方案见 [架构设计](docs/architecture.md)：国服 SGP 优先、LCU 会话管理、SQLite 数据模型与教练复盘流程。

已确定的目标技术栈：TanStack Router 路由、Zustand UI 状态、TanStack Query 数据请求、Apache ECharts 图表、Tailwind CSS + shadcn/ui 界面。游戏客户端交互与 SQLite 访问由 Rust 负责，用户配置通过 Tauri Store Plugin 持久化。新增选型按架构文档分阶段接入。

游戏美术与静态资源主要使用 [Community Dragon](https://raw.communitydragon.org/)，按对局版本解析并缓存，报告记录实际资源版本及内容哈希。历史分析不静默使用最新版数据。

架构还包含类型化 IPC、日志诊断、统一后台任务与退出管理、资源版本管理、备份恢复、Windows CI 与签名更新、分析质量基线，以及“笔记/反馈 → 训练目标 → 后续评估”的复盘闭环。这些是设计基线，尚未全部实现。

架构已覆盖启动与迁移时序、账号/会话边界、历史分页覆盖、不可变分析输入与报告修订、页面异常状态、IPC 权限和性能预算。一期只实现列表所需结算数据；时间线复盘、视频录制和 ROFL 解析分阶段接入。

## 开发

准备 Bun 和 [Tauri Windows 开发环境](https://v2.tauri.app/start/prerequisites/#windows)，在项目根目录执行：

```sh
bun install
bun run tauri dev
```

## 构建

```sh
bun run tauri build
```

生成 Windows MSI 和 NSIS 安装包，输出位于 `src-tauri/target/release/bundle/`。

单独检查前端类型并构建静态资源：

```sh
bun run build
```

## SQLite

使用 [Tauri 官方 SQL 插件](https://v2.tauri.app/plugin/sql/)，Rust 端仅启用 SQLite 驱动。
应用启动时自动打开或创建 `riftmind.db`，位于当前用户的应用配置目录
（Windows：`%APPDATA%\com.springbreeze.riftmind\riftmind.db`）。

当前已完成插件注册、预加载和早期前端验证入口 `src/lib/database.ts`。
目标架构要求 SQLite 仅由 Rust 访问：业务接入时将移除该前端入口及通用 SQL 权限，
React 通过 TanStack Query 调用类型化 Tauri Commands。业务数据存 SQLite，用户配置存 Tauri Store。

后续表结构变更使用插件的 `Migration` 和 `Builder::add_migrations()` 注册，
连接字符串统一为 `sqlite:riftmind.db`。插件会在预加载时自动执行迁移；
正式业务阶段先完成版本检查与迁移前备份，再初始化插件，具体时序见架构文档 3.5。
