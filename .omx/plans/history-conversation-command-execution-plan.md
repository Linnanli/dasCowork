# 历史对话 commandExecution 回显客户端对齐计划

日期：2026-07-03

## 可行性结论

本计划按 `reference-projects/codex-electron-26.623.101652-beautified` 的客户端历史对话方案调整，不修改 `codex/codex-rs/app-server`、`app-server-protocol`、rollout policy 或 Rust 历史 materializer。

reference 的关键做法不是在 renderer 把 `LocalShellCall` 转成 `commandExecution`，而是让客户端始终通过 full history 协议读取服务端已经物化好的 turn items：

1. 恢复会话时使用 `thread/resume` 的 `initialTurnsPage: { limit, itemsView: "full", sortDirection: "desc" }`。
2. 读取更早历史时使用 `thread/turns/list`，并显式传 `itemsView: "full"`。
3. 前端 turn mapper 基本原样消费 app-server 返回的 item；渲染层只渲染已经存在的 `commandExecution`。
4. 运行中会话通过 ThreadStore 式内存状态合并 live `item/started`、`item/completed`、`item/commandExecution/outputDelta`，历史分页仍以 app-server full items 为准。

因此本仓库本轮只做客户端对齐：把 desktop 历史打开、resume hydration、older-turn pagination、状态缓存和测试都调整到 reference 风格。若 full history 响应本身没有 `commandExecution`，客户端不得自行合成，只能把它作为 app-server runtime 兼容性/能力缺失暴露出来。

## 证据摘要

reference 侧：

- reference 客户端声明版本为 `26.623.101652`，app-server 作为协议/types 依赖和运行时能力存在，不在该 beautified 客户端包内提供可读源码：`reference-projects/codex-electron-26.623.101652-beautified/package.json:5`、`reference-projects/codex-electron-26.623.101652-beautified/package.json:76`。
- reference bundle 内置 app-server 最低版本门槛 `0.141.0`，并对不兼容 app-server 返回 `update-required`：`reference-projects/codex-electron-26.623.101652-beautified/.vite/build/src-CoIhwwHr.js:12352`。
- reference ThreadStore 的冷读路径仍会调用 `thread/read`，不是从 renderer 本地持久化数据库重建工具调用：`reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~new-~djgpfzje-D9gL_dwm.js:35325`。
- reference 的历史分页 helper 会向 `thread/turns/list` 传 `itemsView: "full"`：`reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~new-~djgpfzje-D9gL_dwm.js:31654`。
- reference 的恢复链路会向 `thread/resume` 请求 `initialTurnsPage: { limit: 5, itemsView: "full", sortDirection: "desc" }`：`reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~new-~djgpfzje-D9gL_dwm.js:38093`。
- reference 的 turn 映射只是 `s.items.map(xce)`，大多数 item 原样返回，不做 `LocalShellCall` 转换：`reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~new-~djgpfzje-D9gL_dwm.js:31465`、`reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~new-~djgpfzje-D9gL_dwm.js:31510`。
- reference 的渲染层只把已经存在的 `commandExecution` item 转成 UI `exec`：`reference-projects/codex-electron-26.623.101652-beautified/webview/assets/app-initial~app-main~worktree-init-v2-page~remote-conversation-page~pull-requests-page~new-~djgpfzje-D9gL_dwm.js:44761`。

当前仓库客户端侧：

- provider 历史客户端已经具备 `thread/turns/list`，并默认传 `itemsView: "full"`：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-client.ts:131`。
- desktop 打开历史会话仍走 `readThread(threadId, { includeTurns: true })`，随后把 `thread.turns` 映射成 UI messages：`desktop-app/src/main/conversations/ConversationApiService.ts:83`、`desktop-app/src/main/conversations/AppServerThreadClient.ts:55`。

## 目标

- desktop 历史打开路径对齐 reference：使用 full turn page，而不是只依赖 `thread/read(includeTurns: true)`。
- resume/继续会话路径对齐 reference：请求 `initialTurnsPage.itemsView = "full"`，首屏直接消费 full items。
- older turns 加载对齐 reference：通过 `thread/turns/list(itemsView: "full")` 分页拉取，按 UI 需要稳定排序。
- live 和 historical item 使用同一套 `commandExecution` 渲染 contract：客户端只渲染服务端返回的 `commandExecution`，不解析 `LocalShellCall`。
- 当 app-server runtime 不返回 full `commandExecution` 时，客户端以诊断/兼容性错误暴露，不通过本地合成掩盖。

## 非目标

- 不修改 `codex/codex-rs/app-server`、`app-server-protocol`、rollout policy、ThreadHistoryBuilder 或 Rust tests。
- 不持久化或恢复 `ExecCommandBegin`、`ExecCommandEnd`、`ExecCommandOutputDelta`。
- 不在 `history-mapper.ts`、assistant-ui adapter 或 renderer 中把 `LocalShellCall`、raw response、function output 私自转换为 UI tool。
- 不让测试接受“服务端没有 `commandExecution`，但 UI 自己补出来了”作为通过条件。
- 不承诺客户端能修复旧 app-server runtime 的历史物化缺口；客户端只复刻 reference 的协议使用方式。

## 方案选择

### 方案 A：前端将 LocalShellCall 转为 CommandExecution

结论：拒绝。

原因：reference 没这么做。该方案会把协议 materialization 逻辑复制到客户端，是补丁式修复，也会掩盖 app-server runtime 是否真的满足 full history contract。

### 方案 B：修改 app-server 或 rollout 持久化策略

结论：本轮移出范围。

原因：用户要求直接仿照 reference 客户端来做。本计划只调整 desktop/provider/main/renderer 的历史接入与状态管理，不触碰 app-server。

### 方案 C：客户端完整复刻 reference 历史接入

结论：采用。

原因：这与 reference 的客户端职责一致：请求 full items、维护 ThreadStore 式状态、分页加载历史、渲染 app-server 已返回的 `commandExecution`。

## 实施步骤

### 1. 建立客户端协议兼容性门槛

在正式接入前增加只读探针或调试日志，固定客户端期望：

- `thread/resume` 若用于打开/继续已有会话，必须支持 `initialTurnsPage`，并请求 `itemsView: "full"`。
- `thread/turns/list` 必须支持 `itemsView: "full"`，响应的每个 turn 应标记 `itemsView = "full"`。
- 对包含命令执行的历史 thread，若 full page 中没有 `type: "commandExecution"`，客户端不得转换 `LocalShellCall`；应记录为 app-server runtime 不满足 reference 客户端 contract。

### 2. 扩展 provider/main 的 full turns API

当前 provider 已有 `listTurns(... itemsView: "full")`，main conversation API 需要显式使用它：

- 扩展 `desktop-app/src/main/conversations/AppServerThreadClient.ts` 的 `AppServerHistoryClientLike`，暴露 `listTurns(threadId, { cursor, limit, sortDirection, itemsView })`。
- 新增高层 helper，例如 `readThreadWithFullTurns(threadId, options)`，封装 `readThread(includeTurns: false)` 加 `listTurns(itemsView: "full")` 的组合。
- 保持 provider fork 拥有 app-server 协议调用细节，main 层只消费 provider/history-client 暴露的 typed API。

### 3. 调整 openConversation 历史打开路径

把 `desktop-app/src/main/conversations/ConversationApiService.ts` 的历史打开从 `readThread(includeTurns: true)` 调整为 reference 风格：

- 先 `readThread(threadId, { includeTurns: false })` 拉 thread metadata。
- 再 `listTurns(threadId, { itemsView: "full", sortDirection: "desc", limit })` 拉首屏 full turn page。
- 将 desc page reverse 成 UI 期望的时间顺序后再调用现有 mapper。
- 如果当前 UI 仍需要一次性完整历史，第一阶段可以循环分页到完整；后续再做 incremental older-turn loading。

### 4. 增加 resume initialTurnsPage 路径

如果 desktop 的“打开历史并继续对话”实际需要 resume loaded thread，应仿照 reference：

- `thread/resume` 请求带上 `initialTurnsPage: { limit: 5, itemsView: "full", sortDirection: "desc" }`。
- 首屏从 `initialTurnsPage.data.slice().reverse()` hydrate，而不是等待单独 `thread/read(includeTurns: true)`。
- 如果 app-server 没返回 `initialTurnsPage`，仅作为兼容 fallback 调用 `readThreadWithFullTurns`；fallback 仍必须请求 full turns。

### 5. 建立 ThreadStore 式客户端状态层

参考 reference 的 ThreadStore 职责，在 desktop renderer/main 之间明确一层历史状态模型：

- 维护 `threadsById`、`conversations`、turn page cursor、loading state 和当前 active thread。
- live stream 的 `item/started`、`item/completed`、`item/commandExecution/outputDelta` 更新同一份 thread item 状态。
- 历史 full pages 进入同一份状态结构，避免 live item 与 historical item 走两套渲染逻辑。
- 对 `commandExecution` 只做合并、排序、输出 delta 聚合，不从 `LocalShellCall` 或 raw response 创建新 item。

### 6. 实现 older turns 分页加载

对齐 reference 的 older history 行为：

- 首屏默认从最新 turns 开始，`sortDirection: "desc"`。
- 保存 `nextCursor` 用于继续加载更旧 turns。
- 每个 page 进入 UI 前按时间顺序归并，避免重复 turn 或 item。
- 如果服务端返回 `itemsView !== "full"`，视为协议不满足，停止把该 page 当作 tool 回显来源。

### 7. 增加客户端测试

测试目标是证明客户端完全按 reference 协议使用历史：

- provider/history-client 测试：`thread/turns/list` 请求包含 `itemsView: "full"`、cursor、limit、sortDirection。
- AppServerThreadClient 测试：`readThreadWithFullTurns` 先读 metadata，再请求 full turn page，并正确 reverse desc page。
- ConversationApiService 测试：打开历史会话时不再调用 `readThread(includeTurns: true)` 作为主路径，而是使用 full turns page。
- resume 测试：继续已有 thread 时传 `initialTurnsPage.itemsView = "full"`，并从 initial page hydrate。
- UI mapping 测试：服务端返回 `commandExecution` 时渲染为 assistant-ui dynamic tool part；服务端只返回 `LocalShellCall` 时不合成 tool。

### 8. 端到端验证

用一个包含命令执行的历史线程做 smoke：

1. 新建会话并触发一次 shell command。
2. 关闭/重启 desktop app，保留同一 app-server runtime。
3. 从历史列表打开该会话。
4. 验证客户端请求 `thread/turns/list(itemsView: "full")` 或 `thread/resume.initialTurnsPage.itemsView = "full"`。
5. 如果响应含 `commandExecution`，UI 必须显示对应 tool group。
6. 如果响应不含 `commandExecution`，UI 不得自行补；记录为 runtime 不满足 reference 客户端 contract。

## 验收标准

- desktop 打开历史会话主路径不再依赖 `thread/read(includeTurns: true)` 返回完整 turns。
- full history 首屏和 older turns 都显式请求 `itemsView: "full"`。
- resume/继续会话路径使用 `initialTurnsPage.itemsView = "full"` 或等价 full-turn fallback。
- `commandExecution` 从 app-server full item 原样进入 UI mapper，renderer 不解析 `LocalShellCall`。
- 缺少 `commandExecution` 时，测试和 UI 都不把本地合成作为成功。
- 未修改任何 `codex/codex-rs/app-server`、`app-server-protocol`、rollout policy 或 Rust 历史重建代码。

## 验证命令

Provider 层：

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
```

Desktop 层：

```bash
npm --prefix desktop-app test
npm --prefix desktop-app run lint
```

说明：若当前仓库实际没有 `desktop-app/package.json` 或对应脚本，应按 workspace 真实脚本替换；不要新增测试侧适配来掩盖客户端没有请求 full items 的问题。

## 风险与缓解

- 风险：当前 app-server runtime 的 full history 仍不返回 `commandExecution`。缓解：客户端不合成数据，记录 runtime contract 不满足；该风险不在本轮客户端仿照 reference 范围内修复。
- 风险：一次性分页完整历史较慢。缓解：先实现 reference 的首屏 tail hydration 和 older-turn incremental loading。
- 风险：live stream 与 historical page 使用两套状态导致重复 tool group。缓解：建立 ThreadStore 式统一 item store，用 item id 去重和 upsert。
- 风险：summary/notLoaded 历史视图被误用于 tool 回显。缓解：所有可渲染 tool 的历史路径必须要求 `itemsView: "full"`。
- 风险：fallback 又退回 `thread/read(includeTurns: true)`。缓解：fallback 只能退到 `readThreadWithFullTurns`，不能退回 summary 或 includeTurns 主路径。

## 后续执行建议

按客户端分层单 owner 执行即可：

- Lane A：provider/main history client API，补齐 `listTurns`、`readThreadWithFullTurns`、resume initial page。
- Lane B：renderer/ThreadStore 式状态、older turns pagination、commandExecution 渲染去重。
- Lane C：客户端测试与 e2e smoke，确认请求 full items 且不合成 `LocalShellCall`。

集成门槛只有一个：客户端行为与 reference 一致，请求 full history 并渲染 app-server 已返回的 `commandExecution`，不修改 app-server，不在前端补协议数据。
