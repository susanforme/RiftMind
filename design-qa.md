# Akari-inspired Stage 1 UI QA — 2026-10-19

final result: passed

This review covers the requested visual revision of the existing two pages. It does
not close the Windows/live-client acceptance items in `todo/stage1.md`.

## Source and comparison scope

- Official visual reference: https://github.com/LeagueAkari/LeagueAkari/blob/v1.2.5/pictures/main_page_match-history-tabs.png
- Local source visual truth: `docs/ui-review/akari-reference.png` (1344 × 954 pixels).
- Current upstream sidebar and light/dark tokens were also inspected at commit
  `56cdfde00e56148f4641d1a8cf86acb66e903124`; links and license attribution are
  recorded in `third-party/NOTICE.md`.
- Implementation: http://localhost:1420/ — the existing React application, using
  its explicitly marked development fixture transport and synthetic player data.
- This is a layout and visual-language adaptation. The reference shows an expanded
  Arena match with detailed team statistics. Stage 1 supplies summary rows and two
  business pages; team tables, search, automation and rank data were not fabricated.
- The player contract has no profile-image reference. Its existing neutral icon is
  retained; champion and item images are actual Riot Data Dragon resources.

## Evidence and normalization

- Full-view source/implementation comparison: `docs/ui-review/comparison-full.png`.
  The source is proportionally resized from 1344 × 954 to 1280 × 909 and placed
  beside the 1280 × 800 implementation. The different content height, match mode
  and available statistics are intentional and are not treated as pixel drift.
- Focused card comparison: `docs/ui-review/comparison-match-card.png`. The source
  card is cropped at (206,245)–(1256,365); the implementation card at
  (182,378)–(1239,472). Both are normalized to 1050 pixels wide. This comparison
  checks outcome accents, portrait cropping, KDA, equipment and small metadata.
- Eight-state overview: `docs/ui-review/visual-matrix.png`. Each original capture
  is 1280 × 800 pixels at a 1280 × 800 CSS viewport. The contact sheet displays
  each at half size; full-size captures remain available for readable inspection.
- Original captures: `docs/ui-review/{matches,settings}-{light,dark}-{zh,en}.png`.
- Minimum-size evidence: `docs/ui-review/matches-dark-en-800.png` and
  `docs/ui-review/settings-dark-en-800.png`, both 800 × 600 pixels at an
  800 × 600 CSS viewport. The viewport override was reset after testing.

## Required visual surfaces

| Surface | Result |
| --- | --- |
| Typography | Uses the system UI stack, restrained page headings, 13px body copy and larger numeric KDA. Chinese and English labels remain readable. Long player/tab names truncate; queue labels expose their full value on hover. |
| Layout and spacing | 152px expanded / 56px collapsed sidebar, 39px tab bar, small radii, compact player overview and consistently aligned match columns. Settings use section shortcuts and aligned label/control rows. |
| Colors and tokens | Neutral light/charcoal surfaces, green controls, blue wins and red losses follow the inspected Akari visual language. Both token sets are complete. Checked core text pairs meet 4.5:1 contrast. |
| Images and icons | Sharp champion portraits and item PNGs from Riot Data Dragon 16.20.1; regular controls use the existing Lucide library. Missing resource data still has explicit unknown/empty states. No decorative Akari assets were approximated. |
| Copy and content | Marketing headings were replaced by direct match-history/settings labels. Both locales have matching keys and interpolation parameters. Test data is visibly identified as simulated. |

## Findings and comparison history

1. **[P2, resolved] Settings save bar clipped at the viewport bottom.**
   The initial browser capture showed the negative sticky bottom inset cutting
   into the action. Changed the inset to `0` at every breakpoint. Post-fix
   evidence: all final settings captures; at 800 × 600 the save-bar bottom is
   exactly 600px, inside the viewport.
2. **[P2, resolved] English brand subtitle exceeded the sidebar width.**
   Shortened the English subtitle to “League companion” and constrained its text
   container. Post-fix evidence: English desktop captures in the visual matrix.
3. **[P2, resolved] Queue-name length shifted champion columns.**
   An 800px English capture showed different portrait positions for ARAM and
   Ranked solo/duo. Fixed the outcome column width and reserved the missing-data
   indicator slot. Post-fix evidence: `matches-dark-en-800.png`; DOM measurements
   put each of the first six portrait boxes at x=206px.
4. **[P2, resolved] Appearance icons were hidden by a broad field-label selector.**
   Scoped the selector to direct field labels. Final settings captures show the
   sun, moon and system icons in both themes.

The final full-view, focused-card and eight-state comparisons have no remaining
P0/P1/P2 findings. Shortcuts, lighter green accents and summary-only cards are
intentional adaptations to the existing RiftMind scope.

## Functional checks

- Changed and saved language and appearance preferences; confirmed translated
  labels, checked state, success message and disabled save action after completion.
- Opened both page tabs and switched between them.
- Filtered queue 450: URL includes `queue=450`, and all 42 displayed rows are ARAM.
  Reset returned the unfiltered 125-match result.
- Collapsed and expanded the sidebar using its persistent controls.
- Used General and Storage & backups shortcuts to jump to their settings sections.
- At 800 × 600, both pages have `main.clientWidth === main.scrollWidth === 733`.
  Controls remain visible and the equipment grid reflows into two rows.
- Confirmed all 299 rendered champion/item images in the unfiltered 50-row page
  loaded. Console inspection returned no warnings or errors.
- `bun run check`: passed (TypeScript, ESLint, translation/theme contracts,
  text contrast, fixture hashes and generated contracts).
- `bun run test:unit`: 6 tests passed.
- Existing E2E selectors were updated for the direct “Match history” heading and
  scoped sidebar navigation; the full Rust-harness E2E suite was not rerun.
- Final `bun run build` and `bun run check:production`: passed; development
  artwork and fixture transport are absent from the production bundle.
- Browser automation intermittently hit approval-review capacity/timeouts. The
  relevant visual and functional checks were subsequently completed successfully.

## Remaining validation

Windows native title-bar drag regions, window controls, tray behavior, OS scaling
and live-client integration still require Windows validation. This browser pass
used simulated data, not a live League client. The existing Vite bundle-size
warning remains; the production build succeeds.

## Implementation checklist

- [x] Compact sidebar, player tabs and player overview.
- [x] Aligned match cards, semantic outcomes and real preview images.
- [x] Settings sections, aligned fields and fully visible save action.
- [x] Both locales, both themes, both pages and 800 × 600 checked.
- [x] Source comparison, screenshot evidence and third-party provenance saved.


## 2026-10-19: shadcn controls, simpler copy and build isolation

The UI now uses the official CLI-generated Select, Switch, RadioGroup, Tabs,
DropdownMenu, Dialog, Input, Progress, Alert, Badge, Button and Card components.
Business screens compose these components; native selects and custom switch/menu
implementations have been removed.

The palette uses slate text (#202b3d), cool grey canvas (#f5f7fa), white surfaces,
blue actions (#315fc1) and restrained blue/red match outcomes. System UI fonts
stay familiar for a Windows desktop tool. Larger labels and KDA values improve
scanning; quiet match rows leave champion and item art as the main visual detail.
Settings keep left-aligned labels and consistent controls. Long English section
links wrap instead of overlapping the content.

Chinese and English copy now names actions directly. Repeated subtitles and
unused promotional eyebrows were removed. Filtered empty results explain how to
change the filters; a new player is directed to sign in and sync. Position names
are translated in match rows.

Development defaults live in `.env.development`; production defaults live in
`.env.production`. The preview toolbar, scenario labels, preview CSS, fixtures,
preview art and harness transport are excluded from production by compile-time
conditions. Build-time module checks and final asset scanning enforce that rule.
The production build also passed with externally supplied fixture/tools flags
and a sentinel harness token. Browser E2E runs on port 1421 with its matching
Origin, separate from the normal preview at 1420.

Validation: type/lint/translation/theme-contrast/contracts checks, 6 unit tests,
4 integration E2E cases, production build and bundle isolation passed. Browser
review covered both languages, both themes, 1280×860, 800×600 and 390×844 layouts.
Windows native and live League-client verification remain outside this pass.
The existing Vite chunk-size advisory remains.

Current screenshot evidence:
- `docs/ui-review/shadcn-refresh/matches-light-zh.png`
- `docs/ui-review/shadcn-refresh/empty-light-zh.png`
- `docs/ui-review/shadcn-refresh/settings-dark-en.png`
- `docs/ui-review/shadcn-refresh/settings-narrow-en.png`

## 2026-10-19：Stage 2 边框与信息层级复核

用户指出大量黑色边框后，按 `frontend-design` 技能重新检查了真实浏览器渲染。保留一期已确定的 Windows 工具界面、Segoe/PingFang 字体和冷灰/白/蓝色系；浅色基础为背景 `#f5f7fa`、表面 `#ffffff`、正文 `#202b3d`、次要文字 `#637086`、操作 `#315fc1`、分隔线 `#dce3ed`。暗色继续使用对应语义 token。

根因是 shadcn 基础层未给 Tailwind 4 的默认边框设置 `border-border`，而非需要逐页加黑框覆盖。补齐 `@layer base` 后，Card、Table、Badge、Select、Alert 和 DropdownMenu 同时显式声明边框 token；弹层也遵循相同约束。输入框、文本框和 SelectTrigger 移除重复阴影，保留清楚的 focus ring。

布局调整：复盘标题下使用紧凑的英雄/结算概况，状态与操作分组；指标用留白和轻分隔线组织；观察项使用简洁的分组标记，证据为文字入口；笔记与目标嵌套表面不再重复描边。进展筛选显示字段标签，长昵称和成员引用可换行。全程复用/扩展 shadcn/ui，没有手写替代控件。

已通过实际样式检查确认：浅色、暗色与弹窗没有可见边框回退为正文颜色。浏览器回归包含中英、明暗、800×600 和图表失败降级；图像审阅文件见 `docs/ui-review/stage2/`。Windows 原生缩放与真实客户端仍待验证。

## 2026-10-19：沉浸式客户端重构

按 `design.md` 与 `design/immersive-client.png` 重构外壳、战绩、比赛、英雄池、对比、复盘、进展、英雄笔记及设置。沿用默认主题与明暗偏好；本轮没有新增主题切换系统。业务 UI 组合 shadcn/ui，折叠区使用官方 CLI 安装的 Collapsible。

战绩支持按日期分组、独立详情选择和批量选择、宽屏右侧详情及窄屏 Dialog；选择通过已有路由参数随工作标签恢复。搜索、收藏、同步、筛选、分页、复盘与草稿保护保留。

新增真实玩家头像与等级：LCU/玩家搜索解析、数据库第 6 版迁移、缺失资料合并、旧备份与离线恢复。原画和皮肤目录通过 CommunityDragon 元数据解析，JPEG 完整解码及路径/大小校验沿用资源代理安全边界。皮肤选择仅代表展示外观，不宣称为实际对局皮肤。预览图片及来源记录在测试 fixture，生产包不包含预览资源。

验证：`bun run check`、51 项前端单测、16 项 Rust harness E2E、72 项 Rust core 测试、`cargo fmt --all --check`、生产构建与开发资源隔离均通过。资源集成测试及真实 CommunityDragon 原画/0 号头像读取通过。浏览器检查覆盖中英、明暗、宽窄窗口、图片、皮肤切换、标签和弹层；本轮截图及日志在 `.tmp/ui-redesign/`（不提交）。

Windows 原生拖动、窗口操作、125%/150% 系统缩放及真实客户端仍待 Windows 验证；本机 macOS 的 native 编译受项目 Windows-only 限制，未绕过。现有构建包体积提示仍在。
