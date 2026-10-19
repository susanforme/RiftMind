# 2026-10-19 标题栏与 AGENTS 约束复查

## 实现

- 保持 `decorations: false`，标题栏由 WebView 渲染，顶部标签和右上角窗口控制共享一行。启动、加载失败、恢复页面复用相同标题栏。
- 独立拖拽区域不包含交互控件，使用 Tauri 的 `data-tauri-drag-region` 处理拖拽及双击。窗口控制调用宿主 API，关闭仍遵守托盘/退出设置。
- 监听窗口尺寸与焦点变化，更新最大化/还原图标、名称及失焦样式；监听在卸载时清理。窗口操作失败显示可关闭的错误提示。
- 右键菜单及按钮基于 shadcn；浏览器预览保留右上角按钮但禁用宿主操作。
- 四个业务页面统一使用共享 shadcn Label；删除侧栏宣传性副标题、页面介绍、重复训练说明及开发环境标记，保留验证、恢复风险、数据可比性和必要的操作指导。
- 补齐折叠侧栏名称与当前页状态、跳转内容链接、表单关联说明、图表指标选择状态、进度条名称及对话框关闭按钮的本地化。
- 空进展页面隐藏无用的分页及样本说明，无玩家时禁用玩家选择；对话框限制到可视窗口高度，保留滚动。
- `bun run check` 新增 AST 检查，禁止业务层直接使用原生按钮、输入、选择、文本域、进度条、表格及标签，统一从共享 shadcn 组件组合。

## 依据

- [Microsoft Title bar design](https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design)：顶部标签、右侧窗口按钮、拖拽与双击、失焦状态及主题适配。
- [Tauri Window Customization](https://v2.tauri.app/learn/window-customization/)：关闭原生装饰、拖拽区域、窗口控制 API 和权限。
- 项目 `AGENTS.md`、`ui-ux-pro-max` 和 `frontend-design`：共享 shadcn 组件、精简文案、语义主题、键盘访问及窄窗口布局。

## 验证

- `bun run check`：TypeScript、ESLint、双语键与变量、主题契约、文本对比度、shadcn 业务组件约束、资源清单、生成契约。
- `bun run test:unit`：17 项通过，其中 7 项标题栏测试覆盖最大化状态、外部窗口变化、宿主操作、失焦、错误、右键菜单及迟到订阅清理。
- `bun run test:e2e`：9 项通过；新增 1280/800 宽度下右上角按钮定位、禁用预览控制、折叠导航名称及键盘跳转检查。最后的空状态调整另做定向复测。
- `cargo test -p riftmind-core --locked`：40 项通过。
- `bun run build`：生产构建与开发代码隔离检查通过。主包和图表包仍有大于 500 kB 的构建提示。
- 浏览器人工查看：浅/深色及 800×600 设置、战绩、进展；既有复盘 E2E 覆盖中英与浅深色。

## 限制

当前环境为 macOS，桌面宿主明确只允许 Windows 构建；`cargo check -p riftmind --locked` 因该平台限制终止。原生拖拽、双击、缩放、系统快捷键和托盘行为需要 Windows 实机验证。纯 WebView 按钮未接入 Windows 11 最大化按钮的原生 Snap 悬停菜单命中测试；右键菜单提供最小化、最大化/还原和关闭。

附图为浏览器预览，右上角窗口按钮禁用。
