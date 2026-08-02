# 参考项目用户请求信封与 Code review 一致性开发计划

## Requirements Summary

- 在不修改 `codex/codex-rs/app-server/` 的前提下，复刻参考项目“完整消息发送给模型、聊天记录只显示用户请求”的行为。
- 使用参考项目的 `## My request for Codex:` 分隔标记；显示时按参考项目规则取最后一个分隔标记之后的文本。
- `/Code review` 的完整审查规则、未提交更改说明、分支比较说明和用户可见文案与参考项目 1:1 一致。
- 完整提示词继续沿用当前 Renderer -> Main -> AI SDK Provider -> Codex app-server 链路，不新增独立 LLM 调用。
- 用户可见请求必须一致应用于聊天气泡、消息编辑入口和新任务标题；原始完整消息继续用于发送、恢复和消息匹配。

## Acceptance Criteria

1. 对任意不含 `## My request for Codex:` 的普通文本，显示提取函数原样返回输入。
2. 对含一个或多个该标记的文本，显示提取函数返回最后一个标记之后的去首尾空白文本，与参考项目 `qD()` 行为一致。
3. 未提交更改审查实际发送内容逐字包含参考项目的完整 `# Review Guidelines`、未提交更改说明、`## My request for Codex:` 和 `请检查我未提交的更改`。
4. 分支审查实际发送内容逐字包含参考项目的分支说明，正确替换目标分支和 merge-base，并显示 `请审查 {from} 相较于 {to} 的更改`。
5. 模型输入和 transport transcript 保留完整审查提示词；聊天气泡只显示本地化用户请求。
6. 新建独立审查任务的侧边栏标题只使用本地化用户请求，不包含 `# Review Guidelines` 或内部英文说明。
7. 从 app-server 重新加载审查历史后，仍只显示本地化用户请求；普通消息和现有文件/任务引用显示不回归。
8. 当前 `::code-comment` 解析和审查结果卡片继续支持参考项目允许的可选 `start`、`end`、`priority` 字段。
9. 更新后相关单元测试、Desktop 测试、Provider 测试和针对性 E2E 均通过；lint/typecheck 无新增错误。

## Implementation Steps

1. 在 `desktop-app/src/shared/` 增加纯文本用户请求信封模块，集中定义 `## My request for Codex:`、完整消息拼接和可见请求提取；为普通文本、单分隔符、多分隔符、空请求和换行边界添加单元测试。参考行为来自 `reference-projects/.../app-initial~...Cy_DxrPd.js:26896-26902,27443,27455-27458`。
2. 重写 `desktop-app/src/renderer/src/lib/codeReviewPrompt.ts:1-24`：复制参考项目 `review-mode-content-CRO4r5jd.js:96-124,126-166,274-276` 的完整规则和两类 review instruction；返回由共享信封构建的完整消息。扩展分支目标以携带 `sourceBranch`，并更新对应单元测试为逐字断言。
3. 在 `desktop-app/src/renderer/src/components/local-git-review/ComposerReviewMode.tsx:10-12` 和 `ReviewBaseBranchPicker.tsx:7-12,137-150` 传递当前分支名；detached HEAD 使用 `HEAD` 作为稳定显示值。保持 merge-base 仍由 Main 的现有 Git 能力解析，不改变安全边界。
4. 在 `desktop-app/src/renderer/src/App.tsx:1641-1650` 的 transcript -> assistant-ui 投影阶段，仅对用户文本调用共享显示提取函数。不要修改 `ConversationTranscriptController.transportMessages()`，确保发送端仍获得完整原文；由此编辑入口自然只得到用户可见请求。
5. 在 `desktop-app/src/main/codexChatRuntimeService.ts:2281-2295` 的标题生成中使用同一显示提取函数；保持 `convertToModelMessages(request.messages)`（约 2186 行）和 steer 输入继续读取原始消息。
6. 更新 `desktop-app/src/renderer/src/App.test.tsx`、`codeReviewPrompt.test.ts`、相关 transcript 测试和 `desktop-app/tests/e2e/local-git-review.e2e.ts`：分别证明“发送完整、显示简短、标题简短、历史恢复简短”和分支占位符替换正确。保留 `codeCommentDirectives` 的可选字段测试作为结果兼容性回归。
7. 运行针对性测试后，再运行 Desktop lint/test/typecheck 与 Provider lint/typecheck/tests；如完整 E2E 环境可用，运行 local-git-review 用例并记录结果。

## Risks and Mitigations

- **分隔标记出现在用户正文中**：参考项目本身取最后一个标记；为满足 1:1 保持同样语义，并用测试锁定。
- **显示层误改原始消息导致模型丢失规则**：只在 transcript 投影和标题派生时提取，transport 与恢复数据保持原样；测试同时断言 UI 与 provider 输入。
- **分支名在 detached HEAD 为空**：明确回退为 `HEAD`，避免出现空的 `{from}`。
- **现有附件上下文已经使用相同标记**：共享提取函数只影响可见投影，不改 Provider 的文件解析和附件结构；增加普通附件消息回归测试。
- **工作树已有相关未提交修改**：基于当前文件内容做小范围补丁，不覆盖或回退现有命令面板、会话控制器和测试改动。

## Verification Steps

1. 运行共享信封和 Code review prompt 单元测试。
2. 运行 `App.test.tsx` 中 `/Code review`、消息显示、编辑和标题相关用例。
3. 运行 `npm --prefix desktop-app test` 与 `npm --prefix desktop-app run lint`。
4. 运行 Provider 的 lint、typecheck 和相关测试，确认现有上下文拼接无回归。
5. 运行 `npm --prefix desktop-app run test:e2e -- local-git-review.e2e.ts --reporter=line`，确认真实 Renderer -> IPC -> Main -> Provider -> app-server 流程收到完整提示词，界面只显示本地化请求。

## Stop Condition

- 所有验收标准均有自动化证据，相关检查通过；若完整 E2E 因本机依赖无法执行，必须明确记录未验证项和已完成的下一层验证证据。
