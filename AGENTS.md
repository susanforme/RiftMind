# 项目约束

## UI Skills

- 涉及 UI 设计、开发、调整或审查时，优先读取并结合使用项目中的 `ui-ux-pro-max` 和 `frontend-design` skills，遵守其中适用于当前任务的指导。
- `ui-ux-pro-max`（`.agents/skills/ui-ux-pro-max/SKILL.md`）用于指导交互、可访问性、响应式布局和体验质量。
- `frontend-design`（`.agents/skills/frontend-design/SKILL.md`）用于指导视觉风格、排版、配色和布局，保持产品一致性，避免模板化设计。
- 使用这些 skills 时，仍须遵守下方 shadcn/ui 组件约束和 UI Content Minimalism 规则；发生冲突时，以本文件中的项目约束为准。

## UI 组件

- 所有 UI 组件必须基于 shadcn/ui，禁止从零手写组件或自行实现替代组件。
- 优先复用项目已有的 shadcn/ui 组件；缺少组件时，通过 shadcn 官方 CLI 添加，禁止手动仿写。
- 业务界面和业务组件必须通过组合 shadcn/ui 组件实现；样式调整和功能扩展也必须以这些组件为基础。

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
