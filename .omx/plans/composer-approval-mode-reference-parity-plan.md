# Composer 审批类型参考复刻实施计划

## 1. 结论

本次应把“审批类型”实现为独立于“默认/计划模式”的每对话设置，并在每次发送时由 Main 进程翻译成完整的 app-server 审批与沙箱参数：

- 请求批准：受限工作区、遇到越界文件或网络等操作时询问用户。
- 帮我批准：仍保持受限工作区，由 Codex 的风险审查子代理处理审批；它不是“全部自动允许”。
- 完全访问权限：不再询问，允许访问网络和电脑上的任意文件；首次启用必须经过风险确认。
- 选择器放在 Composer 底部操作栏的 + 按钮右侧、现有计划/目标提示左侧。当前准确插入点是 desktop-app/src/renderer/src/App.tsx:3723-3726。
- Renderer 只发送三个安全枚举值，不能直接发送 approvalPolicy、approvalsReviewer、sandbox 或 sandboxPolicy。Main 是唯一的策略映射所有者。
- Provider fork 已经支持 thread/start、thread/resume 和 turn/start 所需字段，见 desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider-settings.ts:207-253 与 src/model.ts:1472-1503,1559-1593,1658-1691；生产 Provider 协议层原则上无需改造。
- 不修改 codex/codex-rs/app-server。当前 app-server 把 auto_review 作为正式 reviewer 值，并继续兼容参考项目使用的 guardian_subagent 别名，见 codex/codex-rs/app-server/README.md:724-727 与 codex/codex-rs/app-server-protocol/src/protocol/v2/shared.rs:222-247。本项目应发送正式值 auto_review。

### 1.1 参考一致性与有意适配

按参考实现复刻：

- 三个可见选项、标题、说明、图标、当前项勾选和浮窗左对齐。
- 完全访问模式使用警告色。
- 首次选择完全访问时显示风险确认；确认成功后持久记住，后续选择不再重复弹窗。
- 权限变化只影响下一次发送，不热切换正在运行的 turn。

按当前项目架构适配：

- 参考项目把新会话默认值按 host 保存，并给既有 thread 设置 override；当前项目已有成熟的 ConversationDraftStore 与 localId 到 threadId 迁移链路，因此本期把审批模式按 conversation 保存，避免两个同时打开的任务互相串权限。
- 新建 conversation 默认仍为“请求批准”，不沿用另一个 conversation 的“完全访问权限”。
- 参考项目使用 guardian_subagent；本项目对当前 app-server 发送同义的正式值 auto_review。
- 不复刻参考项目的 read-only、granular、custom、权限配置档案和 Composer 可见性设置。
- 本期不新增 requirements.toml 能力目录 UI。app-server 仍是最终约束者；若组织要求禁止某一组合，发送失败必须作为明确错误返回，不能静默降级成另一模式。

## 2. 用户体验与文案

### 2.1 触发器

- 位置：紧跟 ComposerAddContextPopover，位于 desktop-app/src/renderer/src/App.tsx:3725 与现有 ComposerModeIndicatorBar 之间。
- 普通宽度显示图标和当前模式短标签；窄宽度只显示图标，但保留完整 aria-label 和 tooltip。
- 请求批准与帮我批准使用普通前景色；完全访问权限使用橙色/警告色，并在关闭浮窗后仍保持警告外观。
- disabled 状态跟随 Composer 的 disabled/loading 状态；审批面板替代 Composer 时不额外渲染选择器。

### 2.2 浮窗

浮窗使用现有 Radix DropdownMenu 封装，见 desktop-app/src/renderer/src/components/ui/dropdown-menu.tsx:9-145，避免再写一套焦点、键盘和关闭逻辑。

标题区：

- 标题：应如何批准 ChatGPT 操作？
- 右侧链接：了解更多
- 链接通过现有 openExternalHttpUrl 白名单桥打开参考项目使用的 Codex 沙箱说明页；现有桥位于 desktop-app/src/preload/index.ts:134-135 与 desktop-app/src/main/index.ts:302-305,603-606。

菜单项：

| 模式 | 主文案 | 说明 | 视觉 |
| --- | --- | --- | --- |
| 请求批准 | 请求批准 | 编辑外部文件和使用互联网时始终询问 | 手掌/询问类图标 |
| 帮我批准 | 帮我批准 | 仅对检测到的风险操作请求批准 | 审查/盾牌类图标 |
| 完全访问权限 | 完全访问权限 | 可不受限制地访问互联网和您电脑上的任何文件 | 警告图标与橙色文字 |

当前选项右侧显示勾选。用户需求和附图使用“帮我批准”，应覆盖参考中文资源中的“替我审批”。参考浮窗结构与选项位于：

- reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~page-DRgkI91I.js:40347-40562
- reference-projects/codex-electron-26.707.72221-beautified/webview/assets/zh-CN-t8Aas5q1.js:3110-3125

### 2.3 完全访问首次确认

首次选择“完全访问权限”时：

1. 关闭审批类型浮窗并打开现有 Dialog 组件实现的确认框，基础组件见 desktop-app/src/renderer/src/components/ui/dialog.tsx:9-143。
2. 标题为“确定要开启完全访问权限吗？”。
3. 风险说明必须明确：ChatGPT 将无需批准即可访问互联网和编辑电脑上的任意文件，可能造成数据丢失和提示注入。
4. 提供“取消”和红色“开启完全访问权限”按钮。
5. 取消、Escape 或点击遮罩都不改变当前模式。
6. 只有点击确认按钮才切换模式，并写入独立的版本化 localStorage 布尔标记。
7. 后续再次选择完全访问可直接切换，不再弹窗。

参考行为位于 page-DRgkI91I.js:40197-40208,40584-40737；参考持久键 skip-full-access-confirm 位于 quick-chat-window-page~chatgpt-conversation-page-CrA1-JEm.js:47609-47617。

## 3. 精确策略映射

Renderer-safe 枚举建议定义为：

- request-approval
- approve-for-me
- full-access

Main 中只保留一个纯映射函数。它同时生成 thread 级和 turn 级设置，确保已有 thread 从完全访问切回安全模式时不会继承上一 turn 的危险设置。

| Renderer 模式 | approvalPolicy | approvalsReviewer | thread sandbox | turn sandboxPolicy |
| --- | --- | --- | --- | --- |
| request-approval | on-request | user | workspace-write | workspaceWrite |
| approve-for-me | on-request | auto_review | workspace-write | workspaceWrite |
| full-access | never | user | danger-full-access | dangerFullAccess |

workspaceWrite 必须显式包含：

- writableRoots：来自当前 ConversationExecutionTarget.runtimeWorkspaceRoots
- networkAccess：false
- excludeTmpdirEnvVar：false
- excludeSlashTmp：false

参考项目的等价映射位于：

- reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js:12039-12069
- workspaceWrite 展开：同文件 12120-12138
- dangerFullAccess 展开：同文件 12148-12154
- 模式转换：同文件 12170-12189

帮我批准的关键约束：它只把 reviewer 从 user 换成 auto_review，仍保留 on-request 与 workspaceWrite；不能映射为 approveForSession、网络白名单或 approvalPolicy: never。现有 ServerRequestPanel 中的“允许一次/当前任务允许”等操作是单次审批响应，和 Composer 的执行权限预设是两个不同层次，不应复用或改写 codexApprovalApi 的 intent。

## 4. 数据流与状态归属

~~~mermaid
flowchart LR
  Selector["Composer 审批类型选择器"] --> Entry["ConversationChatEntry.approvalModeKind"]
  Entry --> Store["ConversationDraftStore v4\nlocalId / threadId"]
  Entry --> Transport["ElectronIpcChatTransport\n注入安全枚举"]
  Transport --> Schema["Shared Zod 严格校验"]
  Schema --> Main["Main 唯一策略映射"]
  Main --> Options["codexCallOptions"]
  Options --> Provider["Codex ASP Provider fork"]
  Provider --> Start["thread/start 或 thread/resume"]
  Provider --> Turn["turn/start"]
  Start --> AppServer["Codex app-server"]
  Turn --> AppServer
~~~

状态规则：

- approvalModeKind 与 composerModeKind 分开；计划模式和审批类型可以同时生效。
- 每个 ConversationChatEntry 独立保存审批类型。
- ConversationDraftStore 从 v3 升到 v4，旧记录迁移时一律补 request-approval。
- 空文本、无附件、默认 Composer 模式但审批类型非 request-approval 时，记录仍需保留。
- 新 conversation 从 request-approval 开始。
- local conversation 绑定真实 thread 后，审批类型随完整 draft record 一起迁移。
- placeholder 与 live entry 合并后必须重新读取迁移后的 approvalModeKind；当前合并代码位于 desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:798-833。
- 选择变化只更新下一次发送使用的值，不中断、不重启、不修改正在运行的 turn。
- transport 在创建一次请求时读取并写入当前值，因此同一次请求有稳定快照；后续切换只影响后续请求。

## 5. 验收标准

### 5.1 UI

- [ ] Composer 的 + 右侧紧邻显示审批类型触发器，后面才是计划/目标提示。
- [ ] 浮窗标题、了解更多、三个选项、说明、图标和选中勾与附图一致。
- [ ] 附图指定的“帮我批准”文案被采用。
- [ ] 浮窗相对触发器左对齐，不遮住发送按钮；桌面宽度与窄窗口都不超出视口。
- [ ] ArrowUp/ArrowDown 可移动选项，Enter/Space 可选择，Escape/点击外部可关闭，焦点返回触发器。
- [ ] 完全访问被选中时，触发器和菜单项持续使用警告色。
- [ ] 完全访问首次选择出现风险确认；取消不切换，确认后才切换；确认标记在重启后仍有效。
- [ ] 了解更多使用现有受限外链桥打开 Codex sandboxing 文档。

### 5.2 状态

- [ ] 新 conversation 默认请求批准。
- [ ] 两个 conversation 可以分别保持不同审批类型，来回切换不串值。
- [ ] localId 绑定 threadId、页面刷新和应用重启后恢复原 conversation 的审批类型。
- [ ] v1、v2、v3 草稿数据都能迁移到 v4，且审批类型默认安全。
- [ ] 计划模式、目标状态、草稿和附件不因切换审批类型而改变。
- [ ] 正在运行的 turn 不因用户切换选项而改变；下一次请求使用新值。

### 5.3 安全与协议

- [ ] shared schema 只接受三个 approvalModeKind 值，拒绝未知值。
- [ ] transport 覆盖 Renderer body 中伪造的 approvalModeKind，并剥离 approvalPolicy、approvalsReviewer、sandbox、sandboxPolicy、cwd 与 runtimeWorkspaceRoots 等执行提示。
- [ ] Main 只使用自己的映射函数生成底层策略。
- [ ] 请求批准在 thread/start/resume 和 turn/start 分别发送 workspace-write/workspaceWrite、on-request、user。
- [ ] 帮我批准发送 workspace-write/workspaceWrite、on-request、auto_review。
- [ ] 完全访问发送 danger-full-access/dangerFullAccess、never、user。
- [ ] 已有 thread 从完全访问切回请求批准后，下一 turn 显式恢复 workspaceWrite、on-request、user。
- [ ] app-server 或组织要求拒绝某种设置时，UI 收到明确错误，不静默回落、不谎报已生效。
- [ ] codex/codex-rs/app-server 下没有任何修改。

### 5.4 回归

- [ ] 原有请求批准卡片、允许/拒绝/会话批准流程保持不变。
- [ ] + 菜单、@ 提及、/ 命令建议、模型选择、计划/目标模式、发送/停止按钮保持原行为。
- [ ] custom provider、cwd、runtime workspace roots 和 thread resume 路径继续通过原有验证。

## 6. 实施步骤

### 步骤 1：先锁定安全枚举与策略映射

涉及文件：

- desktop-app/src/shared/codexIpcApi.ts:148-165,235-259,481-512
- desktop-app/src/shared/codexIpcApi.test.ts:67-130
- desktop-app/src/main/codexChatRuntimeService.ts:627-645,799-850,2395-2531
- desktop-app/src/main/codexChatRuntimeService.test.ts:372-412

工作：

1. 在 shared 层新增 ApprovalModeKind 与严格 Zod enum，作为 CodexChatRequestBody.approvalModeKind 的唯一合法类型。
2. 先写 Main 的表驱动单测，覆盖三种模式、默认缺省、已有 thread 的切换和从 full-access 降回安全模式。
3. 在 Main 新增 approvalSettingsForMode 纯函数；输入只包含枚举与 executionTarget，输出 CodexCallOptions 所需的 approvalPolicy、approvalsReviewer、sandbox、sandboxPolicy。
4. startChatStream 在解析 collaborationMode 后同样解析 approval mode，并把结果传给 defaultStreamText/codexCallOptionsInput。
5. 缺少 approvalModeKind 时使用 request-approval，保持现有行为。

完成标准：在不连接真实 app-server 的 Main 单测中，三组完整参数和降级切换都精确匹配第 3 节表格。

### 步骤 2：扩展 per-conversation 状态和安全迁移

涉及文件：

- desktop-app/src/renderer/src/runtime/ConversationDraftStore.ts:1-24,49-124,137-219,268-273
- desktop-app/src/renderer/src/runtime/ConversationDraftStore.test.ts:22-118
- desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:40-64,288-300,347-375,555-590,615-638,798-833
- desktop-app/src/renderer/src/runtime/ConversationChatRegistry.test.ts:109-135,1252-1281
- desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts:32-67,218-231,329-358
- desktop-app/src/renderer/src/App.tsx:255-285,492-520,730-757,950-1001

工作：

1. ConversationDraftRecord 增加 approvalModeKind，存储 key/version 升到 v4。
2. 保留 v3 reader，再把 v1/v2/v3 统一迁移为 request-approval；无效值也安全回落，不接受 full access 的模糊字符串。
3. 增加 get/setApprovalModeKind，并确保其他 setter 保留该字段、空记录判断包含该字段、sameRecord 比较该字段。
4. ConversationChatEntry 增加 approvalModeKind；新增 registry setter，按 threadId 或 localId 保存。
5. createEntry、bindThread 与 mergePlaceholderIntoLiveEntry 都从稳定 draft identity 恢复该值。
6. useCodexIpcAssistantRuntime 与 App/ActiveConversationPane/ChatThread/Composer props 只透传当前 entry 的值和 setter。
7. 写测试覆盖两个 conversation 隔离、local 到 thread 迁移、刷新恢复、模式与草稿/附件/计划状态互不干扰。

完成标准：状态层测试可以证明 full access 不会跨 conversation 泄漏，旧草稿升级后全部保持请求批准。

### 步骤 3：实现选择器和完全访问确认

建议新增文件：

- desktop-app/src/renderer/src/components/assistant-ui/composer-approval-mode-selector.tsx
- desktop-app/src/renderer/src/components/assistant-ui/composer-approval-mode-selector.test.tsx
- desktop-app/src/renderer/src/runtime/FullAccessConfirmationStore.ts
- desktop-app/src/renderer/src/runtime/FullAccessConfirmationStore.test.ts

复用文件：

- desktop-app/src/renderer/src/components/ui/dropdown-menu.tsx:9-145
- desktop-app/src/renderer/src/components/ui/dialog.tsx:9-143
- desktop-app/src/renderer/src/components/assistant-ui/composer-add-context-popover.tsx:24-47
- desktop-app/src/renderer/src/App.tsx:3677-3889

工作：

1. 建立静态 option 定义，只包含 UI id、中文文案、图标和 warning 标记；协议映射不进入 Renderer。
2. 用 DropdownMenu 组装 header、了解更多、三行选项和右侧勾选，align 设为 start，宽度使用桌面目标宽度与视口上限的组合。
3. 触发器尺寸、圆角、hover/focus 与 + 按钮保持同一视觉层级；窄宽度隐藏标签。
4. 在 + 与 ComposerModeIndicatorBar 之间插入组件。
5. FullAccessConfirmationStore 使用单独的版本化 key，默认 false；只有确认按钮将其写为 true。
6. 完全访问的第一次点击打开 Dialog；确认后调用 onApprovalModeKindChange，取消路径不调用。
7. 了解更多调用 window.desktopApp.codex.openExternalHttpUrl，并在失败时保持 UI 可用。
8. 组件测试覆盖文案、勾选、warning 状态、确认/取消、第二次免确认、外链、键盘和焦点恢复。

完成标准：组件级行为完整，App 测试确认 DOM 顺序为 +、审批类型、模式提示。

### 步骤 4：把审批模式送过可信 IPC 边界

涉及文件：

- desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts:22-95,318-347,382-405
- desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts:262-333
- desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:555-590
- desktop-app/src/preload/index.ts:160-172
- desktop-app/src/main/index.ts:890-924

工作：

1. ElectronIpcChatTransportOptions 增加 getApprovalModeKind，默认 request-approval。
2. createTrustedContext 每次构造请求时覆盖 body.approvalModeKind。
3. stripRendererExecutionHints 明确移除 approvalModeKind 与全部底层审批/沙箱字段，再由可信 getter 写回安全枚举。
4. Registry 创建 transport 时提供当前 entry getter。
5. 不新增独立 IPC handler；现有 startChatStream request 透传和 Main 的严格 schema 已足够。
6. 测试 forged body，证明 Renderer 提交 full-access 字符串之外的 raw never/dangerFullAccess 无法越过边界。

完成标准：preload 仍只是协议桥，Renderer 没有拿到底层 app-server 配置权。

### 步骤 5：接通 Main 到现有 Provider 能力

涉及文件：

- desktop-app/src/main/codexChatRuntimeService.ts:799-850,2395-2531
- desktop-app/src/main/codexChatRuntimeService.test.ts
- desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider-settings.ts:33-67,207-253
- desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts:1472-1503,1559-1593,1658-1691
- desktop-app/vendors/ai-sdk-provider-codex-asp/tests/model.stream.test.ts:2658-2815

工作：

1. RuntimeStreamTextInput/defaultStreamText 增加已解析的审批 settings，而不是原始 Renderer mode。
2. codexCallOptionsInput 把 approvalPolicy、approvalsReviewer、sandbox、sandboxPolicy 与 cwd/runtimeWorkspaceRoots 一起交给 codexCallOptions。
3. 新 thread、resume thread 和 turn/start 都使用同一请求快照；retry/recovery 路径也不能退回 provider 全局默认。
4. Provider 生产代码先保持不变；补 packet 测试锁定 auto_review 正式值、full access 和 full 到 request 的显式覆盖。如果测试暴露 Provider 未透传字段，只做最小修复。
5. 不修改 codexAspProvider.ts 中现有安全默认；它继续作为缺省和其他非 Composer 调用的后备。

完成标准：抓到的 JSON-RPC params 在 thread/start、thread/resume、turn/start 三处都与第 3 节完全一致。

### 步骤 6：端到端验证、视觉核对与文档

建议新增/修改：

- desktop-app/tests/e2e/approval-modes.e2e.ts
- desktop-app/tests/e2e/support/approval-modes-app-server.mjs
- desktop-app/tests/e2e/approvals.e2e.ts
- desktop-app/src/renderer/src/App.test.tsx:1198-1223,1718-1759
- docs/dasCowork-architecture.md:215-229

工作：

1. 新建 test-only app-server peer，把收到的 thread/start、thread/resume、turn/start params 写到临时文件，并返回最小合法生命周期；不把测试逻辑放进生产 Provider。
2. 从真实 Renderer 点击三种模式并发送消息，断言完整 Renderer -> IPC -> Main -> Provider -> app-server 参数。
3. 在同一 thread 上执行 full-access -> request-approval 切换，证明危险设置被显式撤销。
4. 打开两个 conversation，分别选择请求批准与完全访问，交替发送并验证隔离。
5. 页面 reload/应用重启后验证 conversation 模式与首次确认标记。
6. 保留原 approvals.e2e.ts，证明“请求批准”仍会弹出并能完成允许/拒绝。
7. 记录桌面与窄窗口截图，按附图核对位置、宽度、换行、勾选与 warning 色。
8. 更新架构文档：provider 全局默认仍为 on-request/user/workspace-write，但 Composer 每次调用可以由 Main 安全覆盖；明确 auto_review 与 full access 的含义。

完成标准：真实链路参数、现有审批交互、会话隔离和视觉结果全部有自动化证据。

## 7. 验证命令

按从小到大的顺序执行：

1. npm --prefix desktop-app run test:unit -- src/shared/codexIpcApi.test.ts
2. npm --prefix desktop-app run test:unit -- src/renderer/src/runtime/ConversationDraftStore.test.ts src/renderer/src/runtime/ConversationChatRegistry.test.ts
3. npm --prefix desktop-app run test:unit -- src/renderer/src/components/assistant-ui/composer-approval-mode-selector.test.tsx src/renderer/src/lib/ElectronIpcChatTransport.test.ts src/main/codexChatRuntimeService.test.ts
4. npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test -- --run tests/model.stream.test.ts
5. npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
6. npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
7. npm --prefix desktop-app run lint
8. npm --prefix desktop-app run typecheck
9. npm --prefix desktop-app test
10. npm --prefix desktop-app run test:e2e -- approval-modes.e2e.ts approvals.e2e.ts --reporter=line

前三条必须通过 `test:unit` 脚本执行：它会在 `desktop-app` 目录中运行 Vitest，使 Renderer 的 `@/` 别名可直接解析。只用 `npm --prefix desktop-app exec -- vitest` 会把仓库根目录当作 Vitest root。

若仓库脚本对 Playwright 参数透传方式有变化，以 desktop-app/package.json:10-29 的实际脚本为准，但必须保留 targeted E2E 与完整桌面测试两层证据。

## 8. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 把帮我批准误做成自动允许 | Main 映射锁死为 on-request + auto_review + workspaceWrite，并用 packet 测试验证 |
| 从 full access 切回安全模式仍继承旧设置 | thread resume 与 turn/start 都显式发送 workspace 设置，不依赖省略字段 |
| Renderer 伪造 never/dangerFullAccess | shared 严格枚举、transport 剥离、Main 唯一映射三层防护 |
| 完全访问跨 conversation 泄漏 | per-entry 状态、v4 draft identity、localId 到 threadId 迁移与双会话 E2E |
| 旧 localStorage 数据被误解释成高权限 | 所有旧版本和无效值只迁移为 request-approval |
| 首次确认写入过早 | 只有红色确认按钮写标记；取消/Escape/遮罩不写 |
| 与 +、@、/ 浮窗争夺焦点 | 使用 Radix DropdownMenu；专测打开、Escape、外部点击、焦点返回 |
| 组织要求拒绝某模式 | 保留 app-server 最终校验，明确显示失败，不做静默降级 |
| 误改执行基座 | 实施范围限制在 desktop-app、vendor Provider 的最小测试/修复和文档；git diff 检查 app-server 零改动 |

## 9. 明确不做

- 不修改 codex/codex-rs/app-server。
- 不把帮我批准映射到现有 ServerRequestPanel 的 approveForSession 或规则 amendment。
- 不新增独立 LLM client，不绕过 Codex app-server。
- 不在 Renderer 暴露任意 approvalPolicy、reviewer、sandbox 或 provider 配置。
- 不实现 read-only、granular、custom 权限模式。
- 不把某个 conversation 的 full access 设为所有新 conversation 的默认值。
- 不改变现有审批卡片的允许/拒绝/会话批准语义。
