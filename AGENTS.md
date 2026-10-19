# 项目约束

## 临时文件

- 开发、调试和验证过程中创建的临时文件统一存放在项目根目录的 `.tmp/` 下，按用途建立子目录；目录不存在时先创建，禁止散落在项目根目录、业务源码目录或系统临时目录中。
- 临时脚本、截图、日志和中间产物均遵守此约束；需要长期保留的正式脚本、测试 fixture 和文档应放入对应业务目录。
- `.tmp/` 必须保持在根目录 `.gitignore` 中，不得提交其中的文件。

## 目录、组件与代码命名

- 目录、文件、组件、函数、变量、类型和国际化命名空间必须表达业务领域、实际职责或数据含义；读者应能结合所在作用域理解用途，无须依赖任务背景、开发历史或额外注释猜测。禁止任何无业务或职责语义的命名，以下示例不是穷举。
- 禁止使用 `src/features/stage3`、`Stage3Page`、`stage3-fixture.ts`、`s3` 等阶段编号命名；同样禁止用 `phase1`、`step2`、`task3` 等名称代替业务语义。
- 禁止用 `foo`、`bar`、`test`、`temp`、`tmp`、`misc`、`stuff` 等占位词命名正式业务代码，或用 `a`、`b`、`x`、`obj`、`data`、`info`、`item` 等无法在当前作用域明确含义的名称。短循环索引、坐标、公式变量及含义清晰的局部回调参数可遵循惯例；不应扩散到模块接口或跨作用域使用。
- 禁止用裸露的 `common`、`shared`、`utils`、`helpers`、`manager`、`handler` 等泛化名称掩盖职责或堆放不相关代码；必须按具体职责命名或拆分，例如 `match-formatters.ts`、`AnalysisFilters.tsx`、`useLiveSession`。确有通用职责的模块也必须能从名称和边界判断其用途。
- 禁止使用随意缩写、拼音、内部暗号及无意义的数字或状态后缀，例如 `cmp`、`fn1`、`Page2`、`ReviewNew`、`review-final`、`utils-v2`；使用完整且一致的领域术语。行业通用缩写、准确的业务概念及外部协议要求的版本号可以保留。
- 名称必须准确反映行为与范围：函数说明执行的动作和对象，布尔值表达可判断的状态或条件，集合体现其内容，带单位的数值明确单位；不得使用与实际职责不符、过时或夸大范围的名称，也不得靠添加无意义前后缀解决重名。
- `src/features` 按业务功能组织，例如 `live`、`champions`、`comparison`、`review`；不得因为功能属于同一开发阶段，就放进同一个阶段目录。
- React 组件及其文件使用 PascalCase，Hook 使用 `useXxx`；普通函数和变量使用 camelCase，类型使用 PascalCase。其他语言遵循其惯用命名规范，已有 shadcn/ui 文件保持官方命名。
- 测试、fixture、脚本、后端模块和国际化资源也必须按对应业务职责命名，不得继续扩散阶段编号名称。阶段编号仅可用于计划、进度或验收文档；数据库迁移可保留排序编号，但描述部分必须使用业务名称。
- 修改已有不合规模块时，应按业务职责重命名或拆分，并同步更新导入、导出、调用方、测试和资源引用，禁止仅更名目录后留下旧命名或失效引用。

## UI Skills

- 涉及 UI 设计、开发、调整或审查时，优先读取并结合使用项目中的 `ui-ux-pro-max` 和 `frontend-design` skills，遵守其中适用于当前任务的指导。
- `ui-ux-pro-max`（`.agents/skills/ui-ux-pro-max/SKILL.md`）用于指导交互、可访问性、响应式布局和体验质量。
- `frontend-design`（`.agents/skills/frontend-design/SKILL.md`）用于指导视觉风格、排版、配色和布局，保持产品一致性，避免模板化设计。
- 使用这些 skills 时，仍须遵守下方 shadcn/ui 组件约束和 UI Content Minimalism 规则；发生冲突时，以本文件中的项目约束为准。

## UI 组件

- 所有 UI 组件必须基于 shadcn/ui，禁止从零手写组件或自行实现替代组件。
- 优先复用项目已有的 shadcn/ui 组件；缺少组件时，通过 shadcn 官方 CLI 添加，禁止手动仿写。
- 业务界面和业务组件必须通过组合 shadcn/ui 组件实现；样式调整和功能扩展也必须以这些组件为基础。

## 图表与数据可视化

- 涉及趋势、对比、分布、占比等数据展示时，优先使用 ECharts 图表，主动增加有助于理解数据和做出决策的可视化。
- 图表绘制统一使用 ECharts；图表容器、筛选器、操作按钮等周边 UI 仍须基于 shadcn/ui 组件组合实现。
- 图表须适配响应式布局和项目主题，保持必要的标签、单位、提示及空数据状态，避免无意义的装饰性图表和重复展示。

## UI 图像优先

- UI 设计和布局必须优先考虑带图展示，以图表、图像、头像和图标配合必要的标签、数值与操作呈现信息，避免大段文字区域和纯文字卡片堆叠。
- 英雄展示必须带对应英雄头像，适用于列表、卡片、表格、对比和详情等场景；不得仅以英雄名称替代头像。
- 装备、召唤师技能、英雄技能、符文等游戏实体展示必须带对应图片或图标，不得仅展示名称或文字说明。
- 设计时须为图片预留明确的位置、尺寸和比例，优先复用项目已有的对应资源；禁止使用无关图片、通用图标或 emoji 替代具体游戏实体图片。
- 图片须适配项目主题和响应式布局，提供必要的可访问名称与加载失败回退；回退不应代替正常场景下必须展示的图片。
- 说明文字仅保留完成操作和理解结果所必需的内容，详细说明按需放入 Tooltip、Popover 或可展开区域，避免默认铺开长篇文字。

## UI Content Minimalism

When generating frontend interfaces:

1. Every visible text element must serve a functional purpose.
2. Do not invent subtitles, descriptions, helper text, or marketing copy.
3. Prefer labels, values, and actions over explanatory sentences.
4. Never display implementation details such as:
   - Mock Data
   - Development Only
   - Demo Mode
   - Placeholder Content
5. Do not add introductory paragraphs to dashboards, forms, or tools.
6. Do not add descriptions beneath self-explanatory headings.
7. Avoid repetitive information across cards and sections.
8. Do not fill empty space with text.
9. Preserve necessary validation, error, accessibility, and safety messages.
10. Before completion, remove every text element that does not help the user make a decision or complete an action.

Default UI content density: Minimal.
