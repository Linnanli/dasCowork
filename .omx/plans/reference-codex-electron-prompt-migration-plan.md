# 参考 Codex Electron 内置提示词盘点与搬迁计划

> 状态：已按评审意见补全，待实施
> 参考范围：`reference-projects/codex-electron-26.707.72221-beautified` 中可见的 Electron 资源。
> 实施边界：仅修改 `desktop-app/` 及其 provider fork；禁止修改 `codex/codex-rs/app-server`。

## 需求摘要

本计划同时覆盖两种用途不同的提示词，实施时不得混用：

1. **用户可见的起手式**：通过 `/开发模板` 把可编辑草稿写入 Composer，用户确认后再发送。
2. **运行时 app-context**：Electron 根据工作区、功能开关和工具能力组合固定指令，经 `developerInstructions` 发送给 Codex app-server；不得伪装成普通用户消息。

计划必须做到：

- 完整记录参考包中可见的固定运行时指令，并为每个模块给出“迁移、条件迁移或暂缓”的明确结论。
- 复用 DasCowork 已有的 `system -> developerInstructions` 协议路径，不新增模型 HTTP client，不绕过 app-server。
- 只有工具、UI 解析器或后台能力真实存在时，才注入引用该能力的指令。
- 保留已有 Plan collaboration mode、Code Review 面板和 app-server/core 基础指令，不在桌面端复制 core 内置提示词。

## 修正后的结论与边界

参考目录是 Electron `app.asar` 的解包，不包含外置 `codex` 二进制、`plugins/` 和 `skills/`，因此仍然不能据此还原 Codex core 的全部基础指令。[`_analysis/README.md`](../../reference-projects/codex-electron-26.707.72221-beautified/_analysis/README.md:3)

但参考包并非只有 GUI 起手式。它还包含一组固定的 Electron 运行时提示词：主进程依据 Git、工作区依赖、线程工具、显示模式和 heartbeat 状态组合 `<app-context>`，再把结果作为开发者指令交给 renderer/provider 链路。[`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:43243) [`main-CpD8a18d.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/main-CpD8a18d.js:32428)

| 类别 | 实际归属 | 搬迁结论 |
| --- | --- | --- |
| Codex core 基础指令、协作模式指令 | app-server/core | 不搬迁；继续使用现有 app-server 行为。 |
| Desktop、Projectless、Inline comments 等 app-context | Electron 运行时开发者指令 | 纳入本计划，按能力分阶段注入。 |
| 新任务建议、制品创建、首页示例卡片 | Electron GUI 用户起手式 | 迁入本地 `/开发模板` 的最小集合。 |
| 侧边对话、引导、Review Guidelines | 特殊流程提示词 | 单独盘点和按流程迁移，不全局注入。 |
| 外部连接器、专用 skill、生命科学提示 | Electron GUI + 外部能力 | 暂缓，不能静态复制插件名或假设已授权。 |
| 环境建议安全分类器 | GUI 后台辅助调用 | 不纳入正常聊天；只有实现动态首页建议时再迁移。 |

当前项目已有正确的传递基础：main 将请求中的 `system` 交给 AI SDK，[`codexChatRuntimeService.ts`](../../desktop-app/src/main/codexChatRuntimeService.ts:2432) provider 再把它映射到 `thread/start` 的 `developerInstructions`，[`thread-client.ts`](../../desktop-app/vendors/ai-sdk-provider-codex-asp/src/thread-client.ts:112) 并在恢复线程时传给 `thread/resume`。[`model.ts`](../../desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:1472) 因此运行时提示词搬迁不需要修改 app-server 或新增协议。

## 完整盘点与迁移决策

### A. Electron 运行时 app-context

参考客户端的默认组合顺序为 Desktop context、Workspace Dependencies、Automations、Thread Coordination、Non-technical UI、Inline Code Comments、Heartbeat、Git；Writing blocks 与 Projectless Chat 作为附加开发者指令按场景追加。组合时统一保留现有基础指令，并用 `<app-context>` 包裹桌面上下文。[`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:43140)

| 模块 | 参考项目行为与证据 | DasCowork 前置能力 | 决策 |
| --- | --- | --- | --- |
| Desktop context | 固定说明本地媒体使用绝对路径、工作区文件使用绝对路径、URL 使用 Markdown，并提示 Mermaid 和图片展示。[`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:43143) | 无额外工具依赖。 | **第一阶段迁移，默认注入。** 根据 DasCowork 实际可展示的媒体类型调整措辞，不声称不存在的能力。 |
| Projectless output | 指明生成工作区、临时文件与用户交付物目录，最终只链接输出目录文件。[`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:14898) | 当前 `projectless` assignment 已保存 `cwd`、`workspaceRoot`、`outputDirectory`，[`ProjectService.ts`](../../desktop-app/src/main/projects/ProjectService.ts:155) 且运行时会创建 `out`。[`projectRuntimeServices.ts`](../../desktop-app/src/main/projects/projectRuntimeServices.ts:103) | **第一阶段迁移，仅 Projectless 注入。** 使用实际绝对路径，不硬编码 `work/`/`out/` 名称。 |
| Inline Code Comments | 固定要求输出 `::code-comment{...}`，并定义文件、行号和优先级字段。[`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:43165) | Renderer 已有全局解析器。[`codeCommentDirectives.ts`](../../desktop-app/src/renderer/src/lib/codeCommentDirectives.ts:18) | **第一阶段迁移，默认注入。** 同步用契约测试锁定字段格式。 |
| Workspace Dependencies | Office 文档任务优先调用 `load_workspace_dependencies`。[`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:43154) | main 必须能确认当前线程工具目录存在该工具。 | **第二阶段条件迁移。** 工具不可用时不得注入。 |
| Automations | 要求优先使用 `automation_update`，归档任务使用 `set_thread_archived`。[`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:43156) | Renderer 已能展示成功的 `automation_update` 结果，[`assistantRenderUnits.ts`](../../desktop-app/src/renderer/src/lib/assistantRenderUnits.ts:2286) 但仍需确认两个工具在当前线程真实可用。 | **第二阶段条件迁移。** 按具体工具分别裁剪指令，不能仅凭 UI 支持开启。 |
| Thread Coordination | 定义 task/thread 用语、线程管理工具、`create_thread` 使用边界和 `::created-thread` 回执。[`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:43158) | 需要线程工具能力清单和 `::created-thread` UI 处理。 | **第二阶段条件迁移。** 工具与回执解析器同时可用后开启。 |
| Non-technical UI | 要求以非技术语言表达并隐藏不必要的底层命令细节。[`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:43159) | 需要明确的“非技术展示模式”状态，而不是根据用户身份猜测。 | **第三阶段条件迁移。** 未建立显式模式前保持关闭。 |
| Writing blocks | 定义 `:::writing{variant=... id=...}`、支持的 variant、邮件字段和 tone 格式。[`app-initial…Cy_DxrPd.js`](../../reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~artifact-tab-content.electron~app-main~new-thread-panel-page~onboarding-page~pr~hoz4f1hh-Cy_DxrPd.js:44985) | 需要 Renderer 解析、编辑和复制 writing block 的完整契约。 | **第三阶段迁移。** 必须先实现并测试 UI 解析器，再开启提示词；不得先输出不可消费的协议。 |
| Git directives | 成功 stage/commit/建分支/push/建 PR 后输出对应 `::git-*` 回执。[`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:43196) | 需要五类回执的 Renderer 解析器、Git 工作区判断和设置来源。 | **第三阶段迁移。** 非 Git 工作区始终关闭；解析器完成前不注入。 |
| Heartbeat | 定义 `<heartbeat>` 输入和 `NOTIFY`/`DONT_NOTIFY` XML 输出，以及任务完成后删除自动化。[`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:43189) | 需要真实的定时唤醒、automation id 生命周期和响应消费方。 | **第三阶段迁移。** 后台 heartbeat 产品能力完成后才启用。 |

### B. 特殊流程提示词

这些提示词不能放进全局 app-context，应由各自流程拥有：

| 提示词 | 类型 | 决策 |
| --- | --- | --- |
| Side conversation boundary | 侧边对话专用 developer instructions，限制其只回答局部问题，不接管主任务。[`thread-overflow-menu-Co-VIJCM.js`](../../reference-projects/codex-electron-26.707.72221-beautified/webview/assets/thread-overflow-menu-Co-VIJCM.js:209) | DasCowork 有等价侧边对话产品后再迁移；不得全局注入。 |
| Conversational onboarding | 引导流程专用 developer instructions，要求立即执行、避免追问、使用简单语言并调用完成工具。[`app-initial~app-main~onboarding-page-DWQ2hD55.js`](../../reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:80373) | 仅在存在相同引导状态和完成工具时迁移。 |
| Review Guidelines | Code Review 发出的用户提示，包含发现标准和 `::code-comment` 输出约定。[`review-mode-content-CRO4r5jd.js`](../../reference-projects/codex-electron-26.707.72221-beautified/webview/assets/review-mode-content-CRO4r5jd.js:96) | 作为 Code Review 流程的提示正文单独对照；不是隐藏开发者指令。 |

### C. 用户可见起手式

| 发现 | 搬迁结论 | 证据 |
| --- | --- | --- |
| 新聊天建议共 113 个带 `.prompt` 标识的定义 | 仅迁入不依赖连接器的 14 个本地开发意图。 | [`new-chat-page-suggestions-DtIY7agA.js`](../../reference-projects/codex-electron-26.707.72221-beautified/webview/assets/new-chat-page-suggestions-DtIY7agA.js:1455) |
| 4 个制品创建提示 | 第二阶段由当前可用 plugin/app catalog 动态生成，不硬编码参考插件。 | [`artifact-creation-prompts-DJlyNjBB.js`](../../reference-projects/codex-electron-26.707.72221-beautified/webview/assets/artifact-creation-prompts-DJlyNjBB.js:12) |
| 3 张默认首页卡片 | 需要时复用 `/开发模板` 目录，但另行定义首页生命周期和埋点。 | [`home-ambient-suggestions-content-DVdJVCmZ.js`](../../reference-projects/codex-electron-26.707.72221-beautified/webview/assets/home-ambient-suggestions-content-DVdJVCmZ.js:681) |
| 生命科学、写作风格学习 | 不迁入当前产品；依赖专用 skill、数据源与授权。 | [`home-ambient-suggestions-content-DVdJVCmZ.js`](../../reference-projects/codex-electron-26.707.72221-beautified/webview/assets/home-ambient-suggestions-content-DVdJVCmZ.js:276) |
| 环境建议安全分类器 | 只属于动态首页建议生成链路，不用于正常聊天。 | [`src-HagpvBpE.js`](../../reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:17953) |

## 搬迁不变量

- 不修改 `codex/codex-rs/app-server`，不新增独立模型 client，不绕过 provider。
- 运行时提示词只能由 main 根据已验证的执行目标和能力生成；Renderer 不负责拼接隐藏指令。
- 现有 `request.body.system` 必须原样保留，桌面 app-context 只能在其后追加；空值不得产生多余分隔符。
- `<app-context>` 最多出现一次；同一次请求重试、恢复 active turn 或 `thread/resume` 时不得重复累加。
- 提到工具的模块必须以当前线程的真实工具能力为门槛；无法证明可用时默认关闭。
- 提到 `::directive` 或 `:::writing` 的模块必须先有 Renderer 解析器和失败降级测试；无法解析的指令应保持可见文本，不能静默丢失。
- Projectless 指令只能使用 main 已验证的 `cwd`、`workspaceRoot`、`outputDirectory`，不得接受 Renderer 直接提供的路径。
- Plan 继续调用现有 `enterPlanMode`；Code Review 继续使用现有 `contentId: 'code-review'` 面板，不用普通提示词模拟。
- `/开发模板` 仅在空草稿、无附件、非编辑态且未运行时开放；选择后只填充，不自动发送。

## 实施步骤

### 工作流 A：运行时 developer instructions

1. 新建纯数据提示词目录和纯函数组合器：
   - 新建 `desktop-app/src/main/developerInstructions/codexDesktopInstructionCatalog.ts`：保存模块 ID、参考文本、默认开关和能力依赖，不包含业务判断。
   - 新建 `desktop-app/src/main/developerInstructions/composeCodexDesktopInstructions.ts`：输入既有 system、执行目标、项目 assignment 和已确认的能力标志，输出合并后的字符串及 `includedSectionIds`，便于测试和诊断。
   - 顺序固定为：既有 system、`<app-context>` 内的 Desktop/Workspace/Automations/Thread/Non-technical/Inline/Heartbeat/Git、Projectless、Writing blocks。缺失模块不留下空标题。
   - 组合器必须幂等：传入已含同一 `<app-context>` 的字符串时先识别，不再次追加。

2. 第一阶段只接入可以被当前产品正确消费的三项：
   - Desktop context：所有正常桌面聊天启用。
   - Inline Code Comments：所有正常桌面聊天启用，格式与现有解析器保持一致。
   - Projectless output：仅 `conversation.projectAssignment.projectKind === 'projectless'` 时启用，并注入 assignment 中的实际目录。
   - Workspace、Automations、Thread、Non-technical、Writing、Git、Heartbeat 的目录常量和关闭测试同时建立，但运行时默认关闭，直到对应前置条件完成。

3. 在 main 完成执行目标解析后、调用 provider 前组合指令：
   - 修改 [`codexChatRuntimeService.ts`](../../desktop-app/src/main/codexChatRuntimeService.ts:658)，在 `startConversation()` 得到可信的 `executionTarget` 和 `projectAssignment` 后调用组合器。
   - 构造 `modelInputRequest` 时更新 `body.system`，不改用户消息数组，不新增 renderer/preload IPC 字段。[`codexChatRuntimeService.ts`](../../desktop-app/src/main/codexChatRuntimeService.ts:752)
   - 继续走现有 `aiStreamText({ system })` 和 provider 的 `developerInstructions` 映射。[`codexChatRuntimeService.ts`](../../desktop-app/src/main/codexChatRuntimeService.ts:2463) [`thread-client.ts`](../../desktop-app/vendors/ai-sdk-provider-codex-asp/src/thread-client.ts:136)

4. 为第二、三阶段建立“前置能力先完成，提示词后开启”的顺序：
   - Workspace/Automations/Thread：main 获得稳定的当前线程工具能力清单后，分别按工具名启用，缺少任一被引用工具时裁剪相关句子。
   - Non-technical UI：先增加明确的展示模式状态，再把该状态作为组合器输入。
   - Writing blocks：先实现 parser、渲染、复制/编辑和错误降级，再启用 `writing_blocks` 模块。
   - Git directives：先实现五类回执 parser 与 UI 行为，再接入 Git 工作区判断和设置；非 Git 工作区不注入。
   - Heartbeat：先完成定时唤醒、automation id 持久化、响应消费和停止条件，再按 thread 状态启用。

5. 增加运行时测试：
   - `composeCodexDesktopInstructions.test.ts`：逐个锁定模块文本、顺序、门控、既有 system 保留、空值处理和幂等性。
   - 扩展 [`codexChatRuntimeService.test.ts`](../../desktop-app/src/main/codexChatRuntimeService.test.ts)：普通本地工作区包含 Desktop/Inline、不含 Projectless；Projectless 包含正确绝对输出目录；用户消息不含隐藏指令。
   - 扩展 provider 的 thread start/resume 用例：捕获实际 JSON-RPC 参数，证明 `developerInstructions` 在 `thread/start` 和 `thread/resume` 各出现一次，并且 active-turn 恢复不会叠加 app-context。
   - 为每个条件模块添加反向测试：工具或解析器不可用时，对应工具名和 directive 不得出现在出站指令中。

### 工作流 B：`/开发模板` 用户起手式

1. 新建 `desktop-app/src/renderer/src/composer/codexStarterPromptCatalog.ts` 和同名单元测试。
   - 用纯数据定义下表 14 条预设：稳定 `id`、中文标题/说明、搜索词、所属子菜单、参考任务 ID 和准确预填草稿。
   - 导出纯函数，把目录、Plan action 和现有 Code Review `content` selection 转换成 `ComposerSuggestionSubmenu[]`；只接收 `setText` 与 `enterPlanMode`，不新增 `openCodeReview` 回调。
   - 文本预设使用现有 `action` selection：调度器先删除 `/开发模板` 范围，再调用 `aui.composer().setText()`。[`composerSuggestionSelection.ts`](../../desktop-app/src/renderer/src/composer/composerSuggestionSelection.ts:59) [`App.tsx`](../../desktop-app/src/renderer/src/App.tsx:1694)

2. 固定 14 条文本，避免实施时临时编写：

| 子菜单 | ID / 参考任务 | 预填草稿 |
| --- | --- | --- |
| 探索 | `explore-feature` / `new-chat-page-codex-explore-feature` | `分析当前仓库中【功能】是如何工作的。先定位入口、数据流和相关测试，只做分析，不修改代码；如果范围不清楚，先问我一个关键问题。` |
| 探索 | `explore-options` / `new-chat-page-codex-explore-options` | `为【功能】比较可行的实现方案。先检查仓库已有模式，说明各方案的影响范围、优缺点和验证方式，只分析不修改代码。` |
| 探索 | `explore-tradeoffs` / `new-chat-page-codex-explore-tradeoffs` | `比较【主题】的架构方案。基于当前仓库说明关键取舍、风险和推荐结论，只分析不修改代码。` |
| 探索 | `explore-api` / `new-chat-page-codex-explore-api` | `梳理并记录【API/模块】。以代码和现有文档为证据，说明入口、输入输出、错误处理和调用示例，只分析不修改代码。` |
| 构建 | `build-feature` / `new-chat-page-codex-create-feature` | `实现【功能】。先检查相关代码和现有模式，在范围不清时先确认；保持改动最小，并补充能够证明功能有效的测试。` |
| 构建 | `build-ui` / `new-chat-page-codex-create-ui-update` | `完成【界面改动】。先检查现有组件和交互规范，复用已有样式与状态管理，并验证主要交互和异常状态。` |
| 构建 | `build-prototype` / `new-chat-page-codex-build-prototype` | `为【想法】制作可运行原型。先明确最小成功标准，复用仓库现有能力，完成后说明如何运行和验证。` |
| 构建 | `build-internal-tool` / `new-chat-page-codex-build-internal-tool` | `构建一个用于【用途】的内部工具。先确认使用者、输入输出和权限边界，复用现有架构，并补充关键验证。` |
| 审查 | `review-test-coverage` / `new-chat-page-codex-review-test-coverage` | `评估【范围】的测试覆盖。找出最可能漏检真实回归的路径，按风险排序，并为确认的缺口补充最小必要测试。` |
| 审查 | `review-refactor` / `new-chat-page-codex-review-refactor` | `在【范围】内重构代码。先用现有测试锁定行为，再逐项减少重复和复杂度；不改变对外行为，最后运行相关质量检查。` |
| 修复 | `fix-bug` / `new-chat-page-codex-fix-bug` | `定位并修复【问题】。先复现并确认根因，再做最小修复，补充回归测试并运行相关检查。` |
| 修复 | `fix-tests` / `new-chat-page-codex-fix-tests` | `修复失败的测试。先判断是产品回归、测试预期过期还是环境问题，只修改真正错误的一侧，并验证相关测试集。` |
| 修复 | `fix-ci` / `new-chat-page-codex-fix-ci` | `修复 CI 失败。先从日志定位首个真实错误，复现对应检查，做最小修改，并重新运行受影响的 lint、类型检查或测试。` |
| 修复 | `fix-merge-conflicts` / `new-chat-page-codex-fix-merge-conflicts` | `处理当前合并冲突。先理解双方意图和相关测试，逐个文件合并，保留双方有效改动，并验证没有冲突标记和行为回归。` |

3. 在 [`App.tsx`](../../desktop-app/src/renderer/src/App.tsx:3548) 注册唯一的 `starter-prompts` 父命令。
   - 放入 `Development` 分组，支持 `templates`、`starter`、`开发模板` 等搜索词，selection 为 `submenu`。
   - 使用现有 `ComposerSuggestionSubmenu`，不新造浮层或 slash 解析器。[`composerSuggestionTypes.ts`](../../desktop-app/src/renderer/src/composer/composerSuggestionTypes.ts:31)
   - 设置与 Code Review 相同的空草稿/无附件保护，并在任务运行或编辑 follow-up 时禁用；所有文本预设只写输入框、不调用发送函数。
   - Plan 使用现有 `enterPlanMode` action。[`App.tsx`](../../desktop-app/src/renderer/src/App.tsx:3272)
   - Code Review 直接复用 `{ type: 'content', contentId: 'code-review', placement: 'panel' }`，保留 Git 目标选择和现有能力检查。[`App.tsx`](../../desktop-app/src/renderer/src/App.tsx:3548)

4. 增加目录和交互测试：
   - `codexStarterPromptCatalog.test.ts` 锁定四个菜单、14 条准确文本、参考任务 ID、稳定排序，以及不得出现参考插件 ID、`$skill` 或外部连接器名。
   - 扩展 [`composerSuggestionSelection.test.ts`](../../desktop-app/src/renderer/src/composer/composerSuggestionSelection.test.ts:87)：选择 action 时先删除完整 slash 范围、随后填入草稿、不自动提交；失配范围时不写入。
   - 扩展 [`useComposerCommandSections.test.ts`](../../desktop-app/src/renderer/src/composer/commands/useComposerCommandSections.test.ts:26) 与 [`composerCommandRegistry.test.ts`](../../desktop-app/src/renderer/src/composer/commands/composerCommandRegistry.test.ts)：父项可搜索、能打开 submenu、受禁用条件保护。
   - 在 [`App.test.tsx`](../../desktop-app/src/renderer/src/App.test.tsx) 验证预设填充链路，以及 Plan/Code Review 仍走原路径。

## 后续能力阶段

### 来源模板和制品创建

只有 [`ComposerContextCatalogService`](../../desktop-app/src/main/composerContext/ComposerContextCatalogService.ts:54) 能返回“已连接且当前可用”的 app/plugin 身份时，才动态生成研究、简报、自动化和制品模板。未连接时使用不含来源的中性版本；不得自动安装插件、打开授权页或假设用户拥有某项服务。

开始前必须另行确认连接器安装/授权体验、来源选择 UI、自动化外部写入边界，以及 PDF、文档、演示文稿、表格和网站 skill 的可用性契约。

### 首页卡片和动态建议

若产品需要贪吃蛇、PDF 总结等首页卡片，先定义卡片生命周期、可见性、埋点和“仅填输入框”的交互，再复用 `/开发模板` 目录。若由模型生成候选卡片，必须单列受限 app-server 调用、安全分类、超时、降级和隐私评审；参考包的分类器不能直接接入正常聊天。

## 验收标准

### Runtime app-context

- 普通本地工作区的出站 `developerInstructions` 恰好包含一个 `<app-context>`，其中有 Desktop context 和 Inline Code Comments，不含 Projectless、Writing、Git、Heartbeat 或不可用工具名。
- Projectless 工作区额外包含真实 `cwd`/`outputDirectory` 约定，最终交付物只指向已验证的输出目录；本地或远程项目不包含该段。
- 既有 `request.body.system` 内容完整保留，app-context 只追加一次；普通用户消息内容与搬迁前一致。
- 新建线程与恢复线程的 JSON-RPC 测试分别证明 `thread/start`、`thread/resume` 收到正确的 `developerInstructions`；重试和 active-turn 恢复不重复注入。
- 每个条件模块都有正反测试：前置工具/解析器/模式存在时才包含，缺失时对应标题、工具名和 directive 全部不存在。
- 无需修改 `codex/codex-rs/app-server`，也没有新增模型 HTTP 请求路径。

### `/开发模板`

- 空 Composer 输入 `/开发模板` 后能看到“探索、构建、审查、修复”四组；14 条文本与本计划一致，可编辑进入输入框且不会自动发送。
- `/计划` 仍使用 app-server 的 `plan` collaboration mode；“审查当前 Git 改动”仍打开现有 Review 面板。
- 非空草稿、有附件、任务运行或编辑 follow-up 时不会覆盖用户内容；既有命令的可用性不回归。
- 测试证明选择预设不会产生聊天请求，直到用户自行发送。

## 验证步骤

1. 先运行新增组合器、runtime、provider 和 Composer 的定向 Vitest 用例。
2. Provider 层运行：
   - `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint`
   - `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck`
   - `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test`
3. Desktop 层运行：
   - `npm --prefix desktop-app run lint`
   - `npm --prefix desktop-app run typecheck`
   - `npm --prefix desktop-app run test`
4. 增加或扩展一条真实 renderer -> IPC -> main -> provider -> app-server E2E，分别覆盖普通项目和 Projectless；运行 `npm --prefix desktop-app run test:e2e -- --reporter=line`。
5. 在 E2E 中捕获脱敏后的 `thread/start`/`thread/resume` 参数，只断言模块标题、路径归属和出现次数，不把完整隐藏提示词写入生产日志。

## 风险与缓解

- **工具幻觉**：模型看到工具名但当前线程没有该工具。缓解：能力默认关闭，按真实工具目录逐句启用，并有反向测试。
- **重复注入**：follow-up、retry 或 resume 不断累加 app-context。缓解：组合器幂等，provider 协议测试锁定每次只有一份。
- **协议先于 UI**：模型输出 `:::writing` 或 `::git-*`，Renderer 无法消费。缓解：严格执行“解析器和降级测试先完成，提示词后开启”。
- **Projectless 路径错误**：静态 `work/`/`out/` 与真实目录不一致。缓解：只使用 main 生成并验证的 assignment 绝对路径。
- **参考版本漂移**：以后更新参考包时固定文本或门控变化。缓解：目录记录参考版本、模块 ID 和源行；升级时运行快照差异并逐项确认，不自动覆盖本地适配。
- **把特殊流程全局化**：Side conversation、Onboarding 或 Review Guidelines 污染普通聊天。缓解：特殊提示词由流程拥有，并为“普通聊天不包含该段”增加测试。
- **把 GUI 起手式当成隐藏指令**：会改变用户未发送前的模型行为。缓解：起手式始终留在 Renderer Composer，runtime app-context 始终留在 main。

## 完成定义

本计划只有在以下条件全部满足后才算完成：第一阶段 Runtime 三个模块和 `/开发模板` 均实施并通过上述验证；所有其余参考模块已有可追踪的前置条件、默认关闭测试和后续任务；实施 PR 明确记录 E2E 结果，任何无法运行的验证必须说明具体环境缺口，不能用手工截图替代自动化断言。

## 评审意见落实记录

- 已纠正“Electron 端没有固定通用提示词”的判断：明确区分 app-server/core 指令和 Electron 固定 app-context，并把 main 组合、AI SDK `system` 传递、provider `developerInstructions` 映射列为正式实施路径；仍然禁止修改 app-server 或用普通用户消息模拟隐藏指令。
- 已保留可复用的 `/开发模板` 方案：继续使用现有 action、submenu、content、Plan mode 和 Code Review 能力；Code Review 明确复用 `contentId: 'code-review'`，不再设计 `openCodeReview` 回调。
- 已把 14 条模板的稳定 ID、参考任务 ID 和准确中文草稿写入计划，实施时不再临时猜测文案。
- 已把 runtime app-context 设为独立工作流，并要求 `thread/start`、`thread/resume`、重试和 active-turn 恢复都验证最终 `developerInstructions` 及去重行为。
- 已补充 Side conversation、Conversational onboarding 和 Review Guidelines；前两项归入专用 developer instructions，Review Guidelines 保持为 Code Review 用户提示，不与隐藏指令混用。
