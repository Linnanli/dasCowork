# 前端多会话安全切换重构计划

## 文档状态

- 状态：待执行
- 重点范围：`desktop-app` 前端聊天运行时、Electron IPC 与必要的 Main 端并发保护
- 参考实现：`reference-projects/codex-electron-26.623.101652-beautified`
- 不在本计划内：引入 turn steer、同一对话消息排队、修改 Codex App Server Protocol、重写现有消息渲染体系

## 背景与结论

当前实现通过一个全局 `useChat()`、一个全局 transport 和一个 active conversation 指针承载所有对话。流式生成期间，`useCodexIpcAssistantRuntime` 会把 `conversationNavigationBlocked` 置为真，并在 `openConversation()` 与 `startNewConversation()` 中直接拒绝导航（`desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts:141-192`）。`App` 再把这个状态下传给侧栏，形成“对话生成时锁死左侧切换”的现状（`desktop-app/src/renderer/src/App.tsx:229-329`）。

这个锁适合作为当前单运行时结构下的临时防护，但不适合作为最终交互。参考项目的核心不是允许 UI 任意切换，而是让每个 conversation/thread/turn/item 都有独立身份和状态：离开正在生成的对话不会卸载或取消它，回到该对话时仍能继续观察和操作；不同对话可以同时运行，停止、错误、审批和未读状态不会串到其他对话。

本仓库底层已经具备一部分条件：Preload 每次流请求都会创建独立 `MessageChannel`（`desktop-app/src/preload/index.ts:63`）；Main 维护按 conversation/thread 查找的 active run map（`desktop-app/src/main/codexChatRuntimeService.ts:215-228`）；侧栏数据类型已有 `running` 与 `unread`（`desktop-app/src/shared/codexIpcApi.ts:44-55`）；审批上下文已有 `threadId`、`turnId`、cwd 和项目标签（`desktop-app/src/shared/codexIpcApi.ts:127-135`）。缺口主要在 Renderer 的会话级运行时隔离、Main 的重复运行保护、早期 thread 绑定，以及 provider 当前仅有一个持久连接槽位（`desktop-app/src/main/codexAspProvider.ts:61-64`）。

## 需求摘要

1. 生成中的对话 A 不再锁死侧栏；用户可以打开对话 B、创建新对话，并继续正常发送。
2. 不同对话允许并行生成，第一版最多同时执行 4 个；第 5 个及后续请求进入 provider 队列，并且排队期间仍可取消。
3. 同一对话同一时刻最多一个 active turn。该对话生成时 composer 仍只显示停止操作，不实现 steer 或消息队列。
4. 切换对话不得混合消息、流式 chunk、错误、停止状态、审批、草稿、未读标记和滚动位置。
5. 草稿按对话持久化，应用完全退出再启动后仍恢复；滚动位置仅在当前应用会话内保存。
6. 审批面板维持全局可见，但每条审批必须标明来源对话；后台对话的审批不能阻塞当前对话 composer。
7. 新建对话从本地临时 conversation id 过渡到 app-server thread id 时，只能绑定到同一个运行时实例，不能创建第二份 Chat 或重复发送。
8. 保持 renderer -> preload -> main -> provider -> app-server 的现有架构边界，不绕过 app-server。

## 产品行为约定

| 场景 | 预期行为 |
| --- | --- |
| A 正在生成，点击 B | 立即显示 B；A 在后台继续运行 |
| A、B 分别发送消息 | 两者并发，状态和输出互不覆盖 |
| 返回 A | 显示 A 当前累计消息和实时进度；不会重新拉起 turn |
| A 正在生成时再次尝试在 A 发送 | composer 保持停止态，不发起第二个 turn |
| 在 B 停止生成 | 只终止 B；A 不受影响 |
| A 在后台完成 | A 的侧栏 running 消失并出现 unread；打开 A 后清除 unread |
| A 在后台请求审批 | 全局审批区域展示 A 的标题/项目/thread 信息，A 的侧栏显示 attention；B 的输入不被禁用 |
| 新对话第一次发送后立刻从侧栏打开 | 复用临时 id 对应的 Chat，并原子绑定真实 thread id |
| 快速连续点击 A、B、C | 最后一次导航结果生效，较早的异步加载不能覆盖当前视图 |
| 应用重启 | 各对话草稿恢复；滚动位置从默认位置开始 |

## 关键设计

### 1. ConversationChatRegistry

在 Renderer 增加会话运行时注册表。注册表中的每个 entry 拥有稳定的 `Chat` 对象和稳定的 `ElectronIpcChatTransport`，而 React 只把当前 entry 接到 `useAISDKRuntime`/assistant-ui 展示层。

建议数据形状：

```ts
type ConversationChatEntry = {
  localId: string
  threadId?: string
  chat: Chat<UIMessage>
  transport: ElectronIpcChatTransport
  status: "ready" | "submitted" | "streaming" | "error"
  error?: Error
  unread: boolean
  draft: string
  scroll?: ConversationScrollSnapshot
}
```

注册表至少提供：按 local/conversation/thread id 获取、创建新 entry、绑定 thread alias、打开已存在对话、停止指定对话、标记已读、订阅状态快照和销毁所有资源。一个 entry 创建后，transport 不能因为 active conversation 改变而重建。

### 2. 身份与早期 thread 绑定

首次发送前只有本地 conversation id；app-server 创建 thread 后才有真实 thread id。当前 Main 的 `onThreadStarted` 先持久化并通过回调发布 thread 元数据（`desktop-app/src/main/codexChatRuntimeService.ts:295-315`），流事件协议却只有 chunk/finish/aborted/error（`desktop-app/src/shared/codexIpcApi.ts:114-125`）。如果侧栏先收到新 thread，而当前 MessagePort 尚未通知 Renderer 绑定，点击侧栏项可能创建第二个 entry。

为此扩展流事件：

```ts
type CodexChatStreamEvent =
  | { type: "thread-bound"; threadId: string }
  | { type: "chunk"; chunk: UIMessageChunk }
  | { type: "finish"; threadId?: string }
  | { type: "aborted" }
  | { type: "error"; error: string }
```

Main 在向侧栏/会话列表广播新 thread 之前，必须先在当前流的 MessagePort 发出 `thread-bound`。Renderer 收到后同步把 `threadId -> existing entry` 写入 alias map；后续 finish 或消息 metadata 只能校验/补全绑定，不得创建新 entry。

### 3. Main 端并发与重复运行保护

`startChatStream()` 当前直接覆盖 `activeConversationRuns` 中的键（`desktop-app/src/main/codexChatRuntimeService.ts:220-228`）。改为在创建 AbortController 和启动流之前原子检查 conversation id、thread id 及已知 alias：

- 任一身份已有 active run 时，拒绝第二次启动并向该请求端口返回明确的 `error`；不得覆盖旧 run。
- 新 thread 绑定后，把 conversation id 与 thread id 都指向同一个 run。
- finally 只清理由当前 run 占用的映射，避免旧 run 的清理删除后来合法注册的 run。
- stop/interrupt 始终按指定 conversation/thread 找到唯一 run，且只 abort 对应 controller。
- runtime 服务健康状态与单个 turn 的失败状态分开；一个对话失败不得把全局 runtime 标记成不可用，也不得覆盖另一个仍在运行的状态。

### 4. 并发容量

将 provider 的 `persistent.poolSize` 从 1 调整为 4（`desktop-app/src/main/codexAspProvider.ts:61-64`）。这是“不同对话真正并发”的必要条件，而不仅是 UI 同时显示多个 streaming 状态。

容量约定：最多 4 个 app-server client/turn 同时执行；第 5 个请求由 provider 的既有池机制排队。验证排队请求的 abort signal 能在获得槽位前生效；如果现有 provider 不支持，则在 provider fork 内补上可取消队列，但不改 app-server 协议。

### 5. 审批、未读、草稿与滚动

- 审批仍由顶层统一订阅，但按 `request.context.threadId` 关联 entry。当前审批上下文已经包含所需身份，不新增敏感字段。
- 面板显示对话标题、项目标签和必要的 thread 标识。未知 thread 的审批归入“未知来源”而不是错误关联到当前对话。
- composer 的 blocking request 只计算当前 entry 的审批；后台审批仅产生侧栏 attention。
- entry 在非当前状态收到 chunk、finish、error 或审批时置 `unread=true`；用户打开该 entry 后清除。
- 草稿使用版本化 localStorage schema，例如 `das-cowork.conversation-drafts.v1`，key 使用稳定 thread id；未绑定前使用 local id，绑定时迁移且删除旧 key。
- 草稿在发送成功后清空；发送失败保留。损坏或未知版本的存储内容忽略并回退为空，不阻塞启动。
- 滚动快照只保存在 registry 内存中。切出前记录位置；返回时恢复。若用户原本接近底部则继续跟随新消息，否则保持阅读位置并显示现有的滚到底部控件。
- 第一版不做 entry 自动淘汰，避免后台流、MessagePort 或草稿因 LRU 清理丢失；统一在窗口卸载时销毁。

## 实施步骤

### 阶段 0：锁定基线和保护现有改动

涉及文件：

- `desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.navigation.test.ts`
- `desktop-app/src/renderer/src/App.test.tsx`
- `desktop-app/src/renderer/src/sidebar/SidebarRoot.test.tsx`

工作项：

1. 先记录 `git status --short`，不得 reset、checkout 或覆盖执行任务开始前已有的工作树改动。
2. 保留现有“生成时阻止切换”测试作为临时基线，并补充注释说明它会在阶段 5 被新行为测试替换。
3. 为当前单 Chat 行为补最小回归：导航 last-write-wins、生成时不会把已打开对话消息覆盖为另一个对话、侧栏 running 图标正常显示。
4. 在阶段 1 至阶段 4 未全部通过前，不移除 `conversationNavigationBlocked`。

完成标准：当前 desktop 单元测试通过；测试能明确捕获直接删锁但未隔离状态造成的消息串线。

### 阶段 1：扩展 IPC 绑定事件并加固 Main

涉及文件：

- `desktop-app/src/shared/codexIpcApi.ts`
- `desktop-app/src/shared/codexIpcApi.test.ts`
- `desktop-app/src/preload/index.ts`
- `desktop-app/src/preload/index.d.ts`
- `desktop-app/src/main/codexChatRuntimeService.ts`
- `desktop-app/src/main/codexChatRuntimeService.test.ts`

工作项：

1. 新增 `thread-bound` stream event 与 `onThreadBound(threadId)` callback，保持现有 finish threadId 兼容。
2. Preload 对每个 MessageChannel 独立分发绑定事件，并确保 finish、abort、error 和 renderer 取消订阅时关闭对应端口。
3. Main 在新 thread 可用时先向当前流端口发送 `thread-bound`，再执行会让新 thread 出现在侧栏的数据发布回调。
4. 为 active run 建立原子注册方法与 alias 绑定方法，拒绝同一对话的重复 active turn。
5. 清理映射时检查 map value 仍为当前 run；防止并发 finally 删除错误记录。
6. 将服务健康状态和 per-turn error 分离。单次请求错误只通过对应流返回。

完成标准：

- 同一 conversation id 连续启动两次，第二次明确失败，第一次仍可继续和停止。
- 同一 run 绑定 thread id 后，两种 id 都能停止它。
- `thread-bound` 总是早于新 thread 的侧栏发布回调。
- A 的错误不会改变 B 的流事件，也不会将健康 provider 标记为全局 failed。

### 阶段 2：启用受控并发容量

涉及文件：

- `desktop-app/src/main/codexAspProvider.ts`
- `desktop-app/src/main/codexAspProvider.test.ts`
- 必要时：`desktop-app/vendors/ai-sdk-provider-codex-asp/` 中已有 persistent pool 实现及其测试

工作项：

1. 把 `poolSize` 调整为 4，禁止为每个对话新建无上限 app-server 进程。
2. 用可控的 provider 测试屏障证明 A 与 B 能在 A 释放前都进入执行态。
3. 启动 5 个不同对话，断言前 4 个执行、第 5 个排队；排队时取消第 5 个，断言它之后不会获得槽位或启动 turn。
4. 确认 provider shutdown 会中止运行请求、取消排队请求并释放所有 client。

完成标准：并发测试不是只断言 UI 状态，而是证明至少两个底层请求同时越过启动屏障。

### 阶段 3：实现 Renderer 会话注册表

建议新增/调整文件：

- 新增 `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts`
- 新增 `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.test.ts`
- `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts`
- `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts`
- `desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts`
- `desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.test.ts`

工作项：

1. 把 transport 依赖的上下文从全局 active getter 改为 entry 自己的稳定上下文；一次 send 捕获的 conversation/thread/project/model revision 在流存续期间不可被导航改变。
2. 每个 entry 构造一个稳定 `Chat` 和 transport。组件切换只变更 active entry，不调用后台 entry 的 `setMessages()`、`clearError()` 或 stop。
3. 对已有对话，首次打开时加载历史消息并填充对应 entry；重复打开复用 entry。并发加载采用 navigation token，只有最后一次导航能成为 active，但较早加载的数据仍只写入自己的 entry。
4. 对新对话，先用 local id 创建 entry；收到 `thread-bound` 后原子写 alias，并迁移草稿、审批归属和侧栏状态。
5. 将 `useAISDKRuntime`/assistant-ui provider 放在以 active entry id 为 key 的边界内，避免 adapter 的消息/工具缓存跨对话泄漏；切换组件不能销毁 entry 中的 Chat 或停止后台 stream。
6. registry 暴露 per-entry status/error/unread，而顶层只把当前 entry 的 runtime 交给主聊天视图。
7. 明确定义窗口卸载清理：停止订阅、关闭未完成的 MessagePort；正常 React 视图切换不能关闭端口。

完成标准：

- A/B chunk 交错到达时各自只更新对应消息。
- A streaming 时打开 B，A Chat 保持 streaming；返回 A 仍能收到后续 chunk。
- 新 thread 出现在侧栏后立即点击，registry 仍只有一个 entry 和一个 transport。
- 快速打开 A/B/C 后 active=C，A/B 的异步结果不能覆盖 C。

### 阶段 4：接入审批、草稿、滚动和侧栏状态

涉及文件：

- `desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts`
- `desktop-app/src/renderer/src/sidebar/useConversationState.ts`
- `desktop-app/src/renderer/src/sidebar/sidebarTypes.ts`
- `desktop-app/src/renderer/src/sidebar/sidebarModel.ts`
- `desktop-app/src/renderer/src/sidebar/ConversationRow.tsx`
- `desktop-app/src/renderer/src/components/assistant-ui/server-request-panel.tsx`
- `desktop-app/src/renderer/src/App.tsx`
- 对应的 `*.test.ts` / `*.test.tsx`

工作项：

1. 由 registry 与会话列表合并生成 running/unread/approval attention 状态，不依赖“当前 Chat 是否运行”。
2. 当前对话只被属于自己的 blocking approval 禁用；全局审批列表仍允许处理后台请求，并显示来源。
3. stop 按当前 entry id 调用；侧栏 running 行保持状态指示，不把点击图标误解释为停止。若后续要支持侧栏直接停止，另立交互任务。
4. 增加版本化草稿仓储，覆盖 local id 到 thread id 的原子迁移、发送清理、失败保留、损坏数据回退。
5. 在对话切出/切入时保存和恢复 session-only 滚动快照，区分“贴底跟随”与“阅读历史位置”。
6. 后台对话收到新内容或 attention 后标记未读；打开对话后清除。当前会话实时更新不产生未读。

完成标准：

- A/B 同时请求审批时能分别展示并响应，响应 A 不会移除或解除 B。
- A 的后台审批不会禁用 B composer。
- 完全退出并以相同 userData 启动应用后，A/B 草稿均恢复到正确对话。
- 同一应用会话切换后恢复滚动位置；重启后不恢复旧滚动位置。
- running、unread、attention 在侧栏可独立组合且具有可访问名称。

### 阶段 5：移除全局导航锁并收口 UI

涉及文件：

- `desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts`
- `desktop-app/src/renderer/src/App.tsx`
- `desktop-app/src/renderer/src/App.test.tsx`
- `desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.navigation.test.ts`
- `desktop-app/src/renderer/src/sidebar/SidebarRoot.test.tsx`

工作项：

1. 删除 `conversationNavigationBlocked` 对侧栏、打开对话和新建对话的全局拦截。
2. 保留同一 active entry 的 send guard：submitted/streaming 时只展示停止按钮。
3. 将原“生成期间 aria-disabled=true”测试改为“侧栏可操作且后台运行不受影响”。
4. 检查焦点：切换后焦点进入目标 composer；后台审批出现时不抢当前输入焦点。
5. 检查可见状态：当前对话标题、项目上下文、模型选择、消息错误都来自 active entry，不残留上一个对话的数据。

完成标准：用户在 A 生成期间可以完成“打开 B -> 在 B 发送 -> 返回 A -> 停止 A”，全过程无串线、无丢失、无重复 turn。

### 阶段 6：清理与独立复核

工作项：

1. 删除已失效的单 Chat holder、全局 revision/getter 和临时导航锁代码，只保留实际承担一致性职责的抽象。
2. 对新 registry、transport 和 Main run map 做一次可读性清理：明确命名、减少重复分支，不改变已验证行为。
3. 由未参与实现的 reviewer 独立检查：资源泄漏、alias 竞态、stop 误伤、审批误归属、测试是否只覆盖 mock 表象。
4. 修复 reviewer 的 P0/P1/P2 问题；P3 可记录后续，不阻塞本计划验收。

完成标准：无失效代码路径；所有 MessagePort、订阅和 provider client 都有明确拥有者及关闭时机；独立 review 无未解决的高优先级问题。

## 验收标准

1. A 正在流式输出时，侧栏没有 `aria-disabled=true`，可以打开 B。
2. A 与 B 的底层请求真实并发；在 A 的测试屏障释放前，B 已进入执行态。
3. A/B 的消息、status、error 和 stop 互相隔离；停止 B 后 A 继续产生 chunk 并正常 finish。
4. 同一 conversation/thread 的第二个 active turn 被 Main 原子拒绝，原 turn 不被覆盖。
5. 新对话的 `thread-bound` 在侧栏发布前到达；立即点击新侧栏项不会增加 Chat/transport 数量。
6. A/B 同时审批时，来源标签正确；处理 A 只移除 A 的请求，B 的 composer 行为只受 B 的请求影响。
7. 应用真实关闭并重启后，A/B 草稿恢复；滚动位置不跨重启保存。
8. 快速 A -> B -> C 导航最后显示 C，任何较早 load result 都不能覆盖当前消息。
9. 同时启动 5 个不同对话时前 4 个运行、第 5 个排队；取消第 5 个后不会晚启动。
10. 所有流在 finish/abort/error/窗口关闭后释放 MessagePort；重复切换不会增长活动端口计数。
11. 所有现有消息渲染、工具活动、项目上下文、模型选择与审批响应回归测试保持通过。

## 测试计划

### 单元测试

- `ConversationChatRegistry.test.ts`：entry 复用、alias 原子绑定、last-navigation-wins、unread、销毁。
- `ElectronIpcChatTransport.test.ts`：send 上下文快照、thread-bound、交错事件、abort 与端口关闭。
- `codexChatRuntimeService.test.ts`：重复 run、alias stop、条件清理、单 turn error 隔离、事件顺序。
- sidebar/approval tests：running/unread/attention 组合、来源标签、当前 composer blocking 过滤。
- draft store tests：版本、迁移、损坏回退、发送清理/失败保留。

### 集成测试

- Renderer hook 使用两个独立 Chat 和可控 MessagePort，交错发送 A/B chunk、finish、error。
- Main/provider 使用 gate/barrier 证明真实并发和第 5 个请求排队取消。
- 会话列表发布与流端口绑定事件使用顺序断言，覆盖首次新建对话。

### E2E

1. 启动 A 长任务，在 A 未结束时打开 B 并发送短任务，确认 B 先完成。
2. 返回 A，确认此前输出与新输出连续存在；停止 A，B 历史不变。
3. A/B 各触发审批，切换并分别处理。
4. A/B 输入未发送草稿，完全关闭 Electron，再使用同一 userData 目录启动，验证分别恢复。
5. 快速切换多个会话并检查最终标题、项目、消息、composer 和滚动位置。

### 验证命令

```bash
npm --prefix desktop-app run typecheck
npm --prefix desktop-app run lint
npm --prefix desktop-app test
npm --prefix desktop-app run test:e2e -- --reporter=line
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
git diff --check
```

若 provider fork 未被修改，最后两条 provider 命令仍建议运行，但不要求新增 provider 测试。E2E 若依赖本机模型凭据，应明确记录跳过原因，并用 Main/provider 集成测试保留真实并发证据。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| thread id 发布早于 Renderer 绑定 | 同一对话出现两个 Chat、重复 turn | `thread-bound` 先走当前 MessagePort，再发布侧栏；alias 绑定单元测试和 E2E 双重覆盖 |
| React 切换导致后台 Chat 被销毁 | 后台生成中断或丢 chunk | Chat/transport 由 registry 拥有；视图只订阅 active entry |
| Main map 被重复 run 覆盖 | stop 误伤、清理错删 | 启动前原子 guard；finally 按 value 身份条件删除 |
| poolSize 仍为 1 | 看似并发，实际串行 | barrier 测试证明两个底层请求同时进入执行态 |
| 全局审批阻塞当前输入 | B 被 A 的请求锁住 | 全局展示、按 thread 过滤 composer blocking |
| local id 草稿绑定后丢失 | 首次对话草稿消失或重复 | thread-bound 时原子迁移，迁移测试覆盖冲突规则 |
| 多 entry 长期占用内存 | 长会话使用量增长 | 第一版不做不安全淘汰；窗口卸载统一销毁，后续基于测量单独设计 LRU |
| 全局 runtime status 被单 turn 失败污染 | 其他对话被误判不可用 | 服务健康与 turn 状态分离，错误只写对应 entry |
| 用户现有未提交改动被覆盖 | 丢失工作 | 执行前记录 dirty baseline，逐文件合并，禁止 reset/checkout |

## 明确不做

- 不实现参考项目的同一 thread steer。
- 不允许同一对话并行两个 active turn。
- 不增加侧栏直接停止后台任务的交互；本计划只保证打开后可停止。
- 不把 provider 凭据、headers 或完整模型配置暴露给 Renderer。
- 不修改 app-server 的 thread/turn 协议。
- 不在第一版引入 entry LRU、跨设备草稿同步或滚动位置持久化。

## 执行交接

建议在新任务中执行本计划。实现顺序必须遵循阶段门槛：先补 IPC/Main 保护与 registry，再接状态恢复，最后删除侧栏锁。不要把“删除 `conversationNavigationBlocked`”作为第一步。

推荐分工：

- Lane A：shared/preload/Main stream contract、duplicate run guard、pool 并发测试。
- Lane B：Renderer registry、transport identity、navigation race tests。
- Lane C：审批、侧栏、草稿、滚动与 E2E。
- Reviewer：独立复核 alias 时序、资源释放和跨对话隔离，不参与主要实现。

并行执行时，Lane A 先落定 `thread-bound` contract；Lane B 与 C 以该 contract 为边界继续。最终由单一负责人合并并运行完整验证，避免各 lane 分别通过但端到端身份链路仍断裂。

## 默认假设

- 最大并发数为 4，超过后排队。
- 不同对话可并发；同一对话保持 stop-only。
- 草稿跨应用重启持久化；滚动、未读和单 turn 错误只保留当前应用会话。
- 审批面板全局展示并明确来源。
- 执行任务开始时重新读取工作树状态并保护已有改动。
- 新任务直接以本文档为决策依据，不再重新讨论上述架构选择；只有发现与代码事实冲突时才暂停并修订计划。
