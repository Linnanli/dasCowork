# 对话流性能优化实施计划

## 目标

在不改变 Codex app-server、IPC 协议、对话恢复语义和滚动体验的前提下，降低 Renderer 在流式输出期间的主线程阻塞，重点解决“每次文本更新牵连整棵聊天/工作区重渲染”和“更新后同步布局”问题。

目标按生产构建验证：

- 流式高压区主线程 `RunTask >= 50ms` 的总阻塞时间较同机、同构建、同夹具基线下降至少 50%。
- `publish → React commit` 的 p95 低于 50ms、p99 低于 100ms；不得出现由聊天视口尺寸读取触发的 150ms 以上同步布局。
- 30 秒流式输出期间，聊天区域可持续更新，非聊天区域不因文本增量重复渲染。
- 对话恢复、取消、失败、滚动位置、工具调用和附件显示行为保持现有测试结果。

## 范围与边界

### 包含

- Renderer 的 transcript 发布、assistant-ui 消息转换、Registry 订阅粒度、聊天视口滚动恢复。
- 流式 Markdown 动画和长历史消息的性能验证。
- 相关单元测试、组件测试、生产构建性能回归和 Trace 复测。

### 不包含

- 不修改 `codex/codex-rs/app-server/`。
- 不绕过 Codex app-server 新增模型 API 或独立 LLM client。
- 不在没有基线数据的情况下引入虚拟列表、消息分页或新的状态管理依赖。
- 不把恢复写入完全改成异步；恢复数据必须继续在退出/销毁前可靠落盘。

## 当前基线与证据

基线文件：`/Users/nallylin/Downloads/Trace-20260819T102435.json.gz`，分析窗口定义为 Renderer 主线程起点 `ts=241306541740` 至 `ts=241339232207`，共 32.690467 秒。文件来自 Vite 开发环境，包含 React `StrictMode` 与 React DevTools 组件轨迹；因此绝对耗时需要用生产构建复测，当前数据只用于排序首要热点和形成假设。

- 在 `pid=36077`、Renderer 主线程 `tid=14794790` 中，以事件起点 `ts` 落在 `[241306541740, 241339232207)` 为窗口过滤规则，共有 50 个 `RunTask >= 50ms`，总阻塞时间按 `Σ(max(0, duration - 50ms))` 计算约 3.69 秒。窗口开始前 60.746ms 启动、但与窗口重叠的 327.125ms 任务不计入，避免把预热阶段耗时归入正式样本。
- 19.7–23.5 秒区间有 23 个长任务，最大约 272ms；29.4–32.7 秒区间有 19 个，最大约 219ms。
- 在 Renderer compositor `tid=14794807`、上述窗口内，1910 个 `BeginFrame` 中有 675 个 `DroppedFrame` 标记；完整 trace 含窗口外预热事件时计数不同，后续报告必须沿用同一过滤条件。
- 21.16 秒处 assistant-ui `ThreadPrimitive.Viewport` 的 `clientHeight` 读取触发约 197.7ms 的同步布局；调用来自 Vite 打包的 `@assistant-ui/react` `useSizeHandle`。
- React 组件轨迹显示流式高压区内 `ConversationWorkspaceLayout`、`ActiveConversationPane`、`ChatThread`、`ThreadPrimitive.Viewport` 和 Composer 的更新频率与 transcript 发布高度相关；这是首要嫌疑链路，生产 A/B 前不宣称单一因果。
- [ConversationTranscriptController.ts:969](../../desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts#L969) 的 33ms 合帧定时器已按预期工作，但合帧后的更新链仍常超过 33ms。
- [ConversationTranscriptRecoveryStore.ts:265](../../desktop-app/src/renderer/src/runtime/ConversationTranscriptRecoveryStore.ts#L265) 的 250ms 延迟恢复写入在 Trace 中总耗时约 8ms，不是当前主瓶颈。
- GC 在高压区有所增加，但没有看到明确泄漏：DOM 节点约从 464 增至峰值 612，JS heap 在采样点约 43.6MB–61.2MB 波动。

## 现有暂存区改动评估

以下改动作为本计划的已完成基线，不重复实现：

1. [ConversationTranscriptController.ts:616](../../desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts#L616) 将快速文本增量改为 33ms 合帧发布。方向正确，测试已覆盖快速 delta 合并；后续重点是减少每次发布的下游工作量。
2. [ConversationTranscriptRecoveryStore.ts:265](../../desktop-app/src/renderer/src/runtime/ConversationTranscriptRecoveryStore.ts#L265) 将 active text fallback 写入延迟 250ms，并在相同文本时去重。方向正确，必须保留 flush-on-destroy 语义。
3. [ConversationChatRegistry.ts:685](../../desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts#L685) 使用延迟 active text fallback；但同一订阅回调中的 terminal fallback 仍可能同步投影和持久化，后续只在测量确认有收益时处理。
4. [App.tsx:363](../../desktop-app/src/renderer/src/App.tsx#L363) 启用 Streamdown 逐词 fade 动画。当前 Trace 没有证明它是主瓶颈，先保留并增加可控 A/B 验证。

## RALPLAN-DR 摘要

### 原则

1. 先修复可证明的更新边界和缓存失效，再做视觉层面的降级。
2. 流式输出只更新必要的活动消息，稳定的工作区和历史消息保持引用稳定。
3. 滚动恢复必须和“对话切换/视口重建”绑定，不能和每个文本增量绑定。
4. 恢复数据可靠性优先于单次写入速度；任何延迟写入都必须可 flush、可恢复、可测试。
5. 每个优化阶段都必须用生产构建 Trace 和行为回归测试证明收益。

### 决策驱动因素

1. 交互响应性：减少主线程长任务和掉帧，而不是只减少某个函数的 CPU 时间。
2. 变更风险：优先使用现有 React/Registry/assistant-ui 边界，不新增状态管理依赖。
3. 可回滚性：每个阶段可以独立关闭、对比和回退，避免一次性重写聊天渲染链。

### 可行方案

#### 方案 A：最小修复链（推荐起点）

- 稳定 `convertMessage` 引用。
- 将 transcript 订阅从 Registry 全局快照中拆出，优先让活动 Controller 驱动聊天区域。
- 限制滚动恢复 effect 的触发条件。

优点：改动集中、风险可控，直接命中 Trace 热点。缺点：Registry 与 `ActiveConversationPane` 的数据边界需要重新梳理。

#### 方案 B：消息级订阅和渲染缓存

- 在方案 A 基础上，为活动 assistant message 建立消息级快照/渲染单元缓存。
- 历史消息只在身份或内容真正改变时转换，活动消息单独更新。

优点：长历史下扩展性最好。缺点：需要验证 assistant-ui converter 的缓存语义，变更面和测试成本更大。

#### 方案 C：虚拟列表/分页历史消息

- 仅渲染视口附近消息，历史消息按需装载。

优点：超长对话的上限最好。缺点：会显著增加滚动锚点、恢复、复制和可访问性风险；当前 Trace 尚未证明需要立即引入，因此暂不作为第一阶段方案。

## 实施步骤

### 阶段 0：建立可复现基线和观测入口

**目标：** 让每个后续阶段能比较同一场景的生产性能。

**工作：**

1. 新增 `desktop-app/tests/e2e/support/conversationStreamPerformanceFixture.ts`，固定主性能夹具：600 个 `response.output_text.delta`、每个 delta 间隔 50ms、总时长约 30 秒；夹具必须生成确定性的长 Markdown，记录 SHA-256、delta 数量、间隔、UTF-8 字节数和最终文本字节数。
2. 夹具复用 `desktop-app/tests/e2e/support/mockBackend.ts` 的 `ResponsesStreamStep.beforeEvent` 节流 SSE，不新增绕过 app-server 的测试通道。主性能夹具只包含稳定文本流，工具调用、disconnect、取消分别使用独立行为夹具，避免改变性能样本构成。
3. 新增 `desktop-app/tests/e2e/conversation-stream-performance.e2e.ts`，复用 `local-git-review-performance.e2e.ts` 的启动、long-task observer、JSON attachment 和 diagnostics 模式；新增 `npm --prefix desktop-app run test:e2e:conversation-performance` 脚本，固定 `--workers=1`。
4. 新增轻量 Renderer 观测帮助器 `desktop-app/src/renderer/src/runtime/conversationStreamPerformance.ts`，命名统一为 `conversation-stream:*`。记录 `publish`、对应 snapshot 的 React `commit`、commit 后下一帧、聊天组件 commit、滚动恢复 schedule/apply/cleanup；标记必须携带稳定的 `controllerId + version`，以一一匹配而不是按数组位置猜测。帮助器默认无操作，只在 `globalThis.__DASCOWORK_CONVERSATION_PERF__ === true` 时记录；性能 E2E 在应用就绪后、开始固定流之前通过 `page.evaluate` 打开该标志，并在 `finally` 中关闭、清空 marks/measures 和断开 observer。所有记录函数在调用时读取标志，不能在模块加载时缓存开关，因此不需要新增 preload/main API，也不依赖 Renderer 读取 `process.env`。
5. E2E 通过 `PerformanceObserver('longtask')` 和 `performance.getEntriesByName()` 采集脚本指标；新增 `desktop-app/tests/e2e/support/conversationStreamTrace.ts`，使用 `page.context().newCDPSession(page)`、`Tracing.start/Tracing.end`、`transferMode: 'ReturnAsStream'` 和 `IO.read` 采集、读取真实 trace。Trace categories 至少包含 `devtools.timeline`、`blink.user_timing`、`disabled-by-default-devtools.timeline` 和 `disabled-by-default-devtools.timeline.frame`，解析 `RunTask`、`Layout`、`Paint`、`DroppedFrame` 与 GC。DOM 节点数和 JS heap 使用同一 CDP session 的 `Performance.getMetrics` 在开始、每 500ms 和结束时采样，分别计算 start/end/peak。`requestAnimationFrame` 只记作“下一帧”，不得命名成真实 paint；真实布局和绘制证据只来自 CDP trace。
6. 使用生产构建或打包应用复测，不把开发模式下的 React DevTools 轨迹直接当作发布指标。每个版本在同一机器、同一窗口尺寸、无 DevTools UI 条件下预热 1 次、正式运行 3 次，比较 3 次中位数，同时保留每次原始 JSON 与 trace。
7. 将当前 Trace 作为“开发环境定位基线”，另保存生产环境基线；两者分别比较，不混用阈值。

**涉及文件：**

- `desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts`
- `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts`
- `desktop-app/src/renderer/src/runtime/conversationStreamPerformance.ts`（新增）
- `desktop-app/src/renderer/src/App.tsx`
- `desktop-app/tests/e2e/conversation-stream-performance.e2e.ts`（新增）
- `desktop-app/tests/e2e/support/conversationStreamPerformanceFixture.ts`（新增）
- `desktop-app/tests/e2e/support/conversationStreamTrace.ts`（新增）
- `desktop-app/tests/e2e/support/conversationStreamTrace.test.ts`（新增）
- `desktop-app/tests/e2e/support/mockBackend.ts`
- `desktop-app/package.json`

### 指标 JSON 契约

`conversation-stream-performance.json` 至少包含：

```ts
type ConversationStreamPerformanceMetrics = {
  schemaVersion: 1
  fixture: {
    sha256: string
    durationMs: 30_000
    deltaCount: 600
    deltaIntervalMs: 50
    deltaBytes: number
    finalTextBytes: number
    historyMessageCount: number
  }
  renderer: {
    longTasks: {
      count: number
      maxDurationMs: number
      p95DurationMs: number
      p99DurationMs: number
      totalBlockingMs: number
    }
    publishToCommitMs: { count: number; p50: number; p95: number; p99: number; max: number }
    commitToNextFrameMs: { count: number; p50: number; p95: number; p99: number; max: number }
    commits: {
      conversationWorkspaceLayout: number
      activeConversationPane: number
      chatThread: number
      assistantMessage: number
    }
    viewport: {
      forwardedRefAttachCount: number
      forwardedRefDetachCount: number
      nodeReplacementCount: number
      scrollRestoreSetupCount: number
      scrollRestoreScheduleCount: number
      scrollRestoreApplyCount: number
      scrollRestoreCleanupCount: number
    }
  }
  trace: {
    runTasksOver50ms: number
    totalBlockingMs: number
    layout: { count: number; p95Ms: number; maxMs: number }
    paint: { count: number; p95Ms: number; maxMs: number }
    droppedFrames: number
    beginFrames: number
    minorGcMs: number
    majorGcMs: number
    domNodes: { start: number; end: number; peak: number }
    heapBytes: { start: number; end: number; peak: number }
  }
}
```

`conversationStreamTrace.ts` 统一使用 Renderer 进程、主线程/Renderer compositor 和测试开始/结束 mark 限定窗口：仅纳入事件起点 `ts` 落在半开区间 `[startMark, endMark)` 的事件，起点在窗口外的事件即使 duration 与窗口重叠也排除；纳入事件使用完整 duration，并以 `Σ(max(0, duration - 50ms))` 计算长任务总阻塞时间。`conversationStreamTrace.test.ts` 使用最小 trace fixture 覆盖窗口外事件、开始前启动但跨入窗口的事件、窗口内启动但跨出窗口的事件、嵌套任务、缺失可选指标和空指标，避免解析器把预热事件或嵌套 duration 重复计入。

**验收：** `test:e2e:conversation-performance` 可重复生成上述 JSON、原始 trace 和 diagnostics；夹具 hash、600 个 delta 和 30 秒窗口均通过断言。没有生产基线或三次正式采样时不得宣称优化已达标。

### 阶段 1：稳定消息转换缓存（P0）

**目标：** 防止每次 `ChatThread` 重渲染都因新的 `convertMessage` 函数引用清空 assistant-ui converter cache。

**工作：**

1. 在 [App.tsx:890](../../desktop-app/src/renderer/src/App.tsx#L890) 将内联 `convertMessage` 改为稳定回调或等价稳定对象。
2. 提前计算 `messageCount` 和 `isRunning`，稳定回调只依赖这两个会改变“最后一条消息是否运行中”语义的值；不能直接依赖整份 snapshot，也不能为了稳定引用而冻结 running/incomplete 状态。
3. 保持失败、取消、终端状态、工具部分、steering 消息的转换结果不变。
4. 确认 `messages` 中历史项的身份和内容未改变时不会被重复转换；若 assistant-ui 现有缓存无法提供此保证，再增加本地按 `renderId` 的轻量转换缓存，不引入新依赖。

**测试：**

- 在 `desktop-app/src/renderer/src/App.test.tsx` 验证父组件因无关状态重渲染时 `convertMessage` 引用保持稳定。
- 用转换 spy 验证缓存效果，而不只验证函数身份：无关重渲染时转换次数不增加；活动文本 delta 只转换新的活动 message 对象，历史 message 对象不重复转换。
- 验证 running→ready、消息数量变化、最后一条错误/取消状态变化时 converter cache 会按 assistant-ui 的 auto-status 规则正确失效，最终转换结果更新。
- 保留并扩展现有错误/取消/中断消息转换断言（当前约在 App.test.tsx:2368、2414 附近）。

**验收：** 在相同消息列表和相同运行状态下连续渲染，转换回调引用不变且历史消息转换次数不增加；活动 delta、消息数量或状态改变时只有必要消息重新转换，语义结果正确。

### 阶段 2：拆分 Registry 与聊天区域订阅（P0）

**目标：** 流式 transcript 更新不再让 Right Workspace、Header、Composer 配置和 Sidebar 全部跟随刷新。

**工作：**

1. 保留 [ConversationChatRegistry.ts:130](../../desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts#L130) 现有 `subscribe/getSnapshot` API 作为“目录与语义状态订阅”，不在第一阶段新增另一套 Registry API。它负责 active entry/entries 结构、context、loaded、draft/config、status/error/recovery、unread 等会影响非聊天区域的状态。
2. 在 [ConversationChatRegistry.ts:657](../../desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts#L657) 继续在每个 Controller 通知中同步 `entry.messages/status/error` 和恢复数据；只有 message 内容改变而 status/error/recovery/unread/draft/context/entry 结构均未改变时，不调用全局 `this.emit()`。submitted→streaming、streaming→ready/error 等语义状态变化必须继续 emit。
3. 在 `ActiveConversationPane` 内用 `useSyncExternalStore(entry.controller.subscribe, entry.controller.getSnapshot, entry.controller.getSnapshot)` 直接取得活动 transcript snapshot。`useExternalStoreRuntime` 的 `messages/isRunning`、`ConversationDraftBridge.status` 和 live turn error 使用该 snapshot；history load 的 `loaded/loadError` 继续来自 entry，避免混淆历史加载错误和实时 turn 错误。
4. `useCodexIpcAssistantRuntime.ts:97` 继续消费 Registry 目录快照，因此纯文本 delta 不会重渲染 App/Workspace；切换 active entry 后 React 自动取消旧 Controller 订阅并订阅新 Controller。Registry destroy 仍负责取消其内部每个 Controller 订阅。
5. [useConversationFollowUpCoordinator.ts:86](../../desktop-app/src/renderer/src/hooks/useConversationFollowUpCoordinator.ts#L86) 依赖 entry.status 派发队列，因此 Registry 必须在每次 status 语义转换时 emit；测试需证明 ready/error 后队列仍会继续派发，而 message-only delta 不唤醒 coordinator。
6. 复用 [ConversationRuntimeIndicatorStore.ts:24](../../desktop-app/src/renderer/src/runtime/ConversationRuntimeIndicatorStore.ts#L24) 的稳定签名缓存。Sidebar 所需 active/running/unread/attention 都属于 Registry 语义状态通知；纯文本内容不得触发行重渲染，后台会话 status/unread 改变仍必须通知。
7. 旧会话后台继续由 Registry 内部 Controller 订阅更新 `entry.messages` 和 recovery；切换回来时 `ActiveConversationPane` 从 Controller 的当前 snapshot 首次读取完整内容，不依赖漏掉的历史全局 emit。

**测试：**

- 在 `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.test.ts` 验证 message-only delta 不触发 Registry 目录订阅；submitted→streaming→ready/error、unread、导航和元数据变化仍触发。
- 在 `desktop-app/src/renderer/src/App.test.tsx` 验证流式消息更新仍显示最新文本、发送/取消/失败/恢复行为不变。
- 增加旧会话延迟事件不会更新当前聊天的测试。
- 在 `desktop-app/src/renderer/src/hooks/useConversationFollowUpCoordinator.test.ts` 验证 message-only delta 不重跑派发判断，ready/error 状态转换仍唤醒并派发队首。
- 在 `desktop-app/src/renderer/src/sidebar/ConversationRuntimeIndicatorContext.test.tsx` 验证纯文本 delta 保持行快照引用，后台会话 running/unread 变化仍更新。

**验收：** Trace 中流式更新时 `ConversationWorkspaceLayout`、`ActiveConversationPane` 和稳定 Composer provider 的渲染次数不再与每个 delta 线性增长；活动聊天仍能按 30fps 上限更新。

### 阶段 3：验证并减少 Viewport 尺寸读取和滚动恢复（P1）

**目标：** 先区分 DOM 节点替换、callback-ref 重新绑定、assistant-ui size measurement 和自定义滚动恢复，再消除流式内容更新引起的多余尺寸读取及同步布局。当前 Trace 证明 `clientHeight` 读取触发过约 197.7ms Layout，但没有证明 Viewport DOM 被重新挂载。

**工作：**

1. 在阶段 0 的 probe 中记录：传给 `ThreadPrimitive.Viewport` 的 forwarded ref attach/detach 次数、元素 identity 变化次数，以及 [App.tsx:1986](../../desktop-app/src/renderer/src/App.tsx#L1986) 滚动恢复 effect 的 setup/cleanup/schedule/apply 次数。不得只根据 React render 次数推断 ref 或 DOM 重挂载。
2. 完成阶段 2 后先复测。若 197.7ms 类布局消失且 `nodeReplacementCount=0`、恢复计数只在会话切换发生，则阶段 3 停止，不做无证据的结构重排。
3. 若同一 DOM 元素发生重复 forwarded-ref detach/attach，稳定传给 `ThreadPrimitive.Viewport` 的 ref 和相关回调身份；若 DOM 元素确实被替换，再定位产生新 key/条件分支的上游后最小修复。
4. 若 [App.tsx:1986](../../desktop-app/src/renderer/src/App.tsx#L1986) 的 effect 在 message-only delta 上 cleanup/re-run，才将“保存旧位置”和“恢复新视口”拆成按 conversation identity/viewport identity 驱动的两个 effect；普通 transcript snapshot 不得成为依赖。
5. 若 ref/effect 均稳定但 assistant-ui `useSizeHandle` 仍在内容更新后产生昂贵 Layout，则保持 Viewport DOM 和外层 Provider props 稳定，减少 `ThreadPrimitive.Viewport` 本身的 React commit；禁止直接修改 `@assistant-ui` 或 Codex app-server 源码。
6. 保留 `requestAnimationFrame` 的等待布局语义和 `captureConversationScroll`/`restoreConversationScroll` 的 follow-bottom、非底部位置、`scrollBehavior` 恢复行为。

**测试：**

- 在 App 组件测试中模拟多次 message-only delta，断言 Viewport DOM identity 不变；分别记录 callback-ref attach 和滚动恢复 schedule/apply 次数。
- 测试切换会话、返回会话、窗口重建、用户手动上滚和 follow-bottom 四种场景。
- 对每个触发分支写回归测试：如果修复 callback-ref，则断言无重复 attach；如果修复恢复 effect，则断言 message-only delta 不触发 cleanup/apply。
- 在生产 Trace 中确认 `Layout` 最大耗时低于 50ms，且不再出现调用栈归因到 assistant-ui `useSizeHandle/clientHeight` 的 150ms 以上布局；不要把易变的 Vite chunk 行号作为长期断言。

**验收：** 证据能明确说明昂贵 Layout 来自哪一类触发；流式高压区不出现 150ms 以上同步布局，Viewport DOM 在 message-only delta 中不被替换，滚动位置与当前行为一致且无自动滚动抢夺用户手动滚动。

### 阶段 4：减少快照投影和恢复数据重复工作（P1/P2）

**目标：** 在前面两阶段完成后，降低 GC 和长历史下的 CPU/序列化放大。

**工作：**

1. 检查 [ConversationTranscriptController.ts:977](../../desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts#L977) 的 `buildSnapshot/currentMessages`，确保历史消息数组和不变消息对象尽量复用，只替换活动消息或发生语义变化的部分。
2. 检查 [ConversationChatRegistry.ts:679](../../desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts#L679) 中 terminal fallback 与 active text fallback 的重复消息扫描；允许在一次 Registry 更新中共享投影结果。
3. 在 [ConversationTranscriptRecoveryStore.ts:455](../../desktop-app/src/renderer/src/runtime/ConversationTranscriptRecoveryStore.ts#L455) 保持完整 JSON 写入和 prune 语义，但增加 terminal/attachment 数据的相同内容去重；只有数据实际变化或状态转换时才序列化。
4. 不改变 `flushPendingActiveTextFallbacks()`、migrate、clear 和 destroy 时的可靠性。
5. 以 100、500、1000 条历史消息做内存/CPU 对比；若低于 100 条消息无明显收益，则不为短对话增加额外缓存复杂度。

**验收：** 长历史场景下每次流式更新的转换/投影工作不随全部历史消息线性重复；GC 总耗时不高于优化前；恢复数据内容和版本兼容测试全部通过。

### 阶段 5：Streamdown 动画与长文本策略（P2）

**目标：** 用数据决定是否保留逐词动画，而不是把动画当作当前主因或提前删除。

**工作：**

1. 保留 [App.tsx:363](../../desktop-app/src/renderer/src/App.tsx#L363) 当前配置作为 A 组，增加 B 组：流式期间关闭逐词动画、完成后保留静态淡入。
2. 用相同 Markdown（纯文本、代码块、表格、CJK、Mermaid）比较 parse、CDP trace 中的 Paint、DOM 节点数、DroppedFrame 和用户感知首字/完成延迟。
3. 若长文本下动画导致节点数或掉帧明显增加，再改为只对新增文本片段动画，避免重复包裹已存在内容。
4. 保留 `prefers-reduced-motion` 与可访问性行为。

**验收：** 选择的默认策略在生产构建中不会使流式高压区阻塞时间增加超过 10%；动画关闭时视觉功能和可访问性测试通过。

## 验收标准

### 行为

- 发送、流式 delta、工具调用、steering、取消、失败、重试、恢复、附件和目标编辑行为与现有测试一致。
- 切换会话和返回会话时滚动位置正确；用户手动上滚期间不会被自动滚到底部。
- 活动消息最后一条的 streaming/incomplete/error 状态正确映射，历史消息不会因缓存而显示旧状态。

### 性能

- 生产构建同一 30 秒场景的 `RunTask >= 50ms` 总阻塞时间较生产基线下降至少 50%。
- `publish → React commit` 的 p95 < 50ms、p99 < 100ms；`commit → next frame` 单独报告 p50/p95/p99/max，不把下一帧等同于真实 paint。
- Layout/Paint、掉帧和主线程阻塞只以同一测试窗口内的 CDP trace 为准，不从 `requestAnimationFrame` 时延反推浏览器已经完成绘制。
- 不出现由 Viewport/ref 更新引起的 150ms 以上同步布局；Layout p95 < 10ms。
- DroppedFrame 比基线下降至少 30%；若硬件或窗口状态导致该指标不稳定，必须同时报告长任务和 Layout 指标，不能只用掉帧作结论。
- 100/500/1000 条历史消息下，内存无持续单调增长；GC 总耗时不得比基线增加超过 10%。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 稳定 `convertMessage` 后活动状态不刷新 | 最后一条消息状态错误 | 用消息长度/运行状态等语义依赖；增加 streaming→ready、失败、取消测试 |
| 拆分订阅后旧会话事件污染当前会话 | 内容串台、恢复错误 | 每个订阅绑定 entry/controller identity；切换和 destroy 做 unsubscribe 测试 |
| 滚动 effect 减少触发后恢复位置丢失 | 用户体验回归 | 将会话切换、视口重建、手动滚动分别测试，并保留显式恢复版本 |
| 减少 Registry emit 导致 Sidebar 状态延迟 | 未读/运行指示不及时 | 保留 `ConversationRuntimeIndicatorStore` 独立通知和状态签名 |
| 过早引入消息级缓存导致 stale data | 历史/工具内容不一致 | 先完成方案 A；只有性能基线仍不达标才进入方案 B |
| 开发 Trace 误导优化方向 | 生产收益不成立 | 阶段 0 固定生产基线；开发 Trace 仅用于调用栈定位 |
| 延迟恢复写入丢失最新文本 | 重启后恢复不完整 | 保留 timer flush、destroy flush、migrate flush，并用 fake timers 覆盖 |

## 验证步骤

### 定向测试

```bash
npm --prefix desktop-app run test:unit -- \
  src/renderer/src/App.test.tsx \
  src/renderer/src/hooks/useConversationFollowUpCoordinator.test.ts \
  src/renderer/src/runtime/ConversationChatRegistry.test.ts \
  src/renderer/src/runtime/ConversationTranscriptController.test.ts \
  src/renderer/src/runtime/ConversationTranscriptRecoveryStore.test.ts \
  src/renderer/src/sidebar/ConversationRuntimeIndicatorContext.test.tsx \
  tests/e2e/support/conversationStreamTrace.test.ts
```

### 类型、Lint、构建

```bash
npm --prefix desktop-app run typecheck
npm --prefix desktop-app run lint
npm --prefix desktop-app run build
```

### 回归测试

```bash
npm --prefix desktop-app test
npm --prefix desktop-app run test:e2e -- --reporter=line
```

### 性能复测

```bash
npm --prefix desktop-app run test:e2e:conversation-performance
```

1. 用生产构建启动同一固定对话流场景。
2. 分别采集无优化基线、每个阶段完成后的 Trace；每阶段只改变一个主要变量。
3. 对比长任务、`publish → React commit`、`commit → next frame`、CDP Layout/Paint、DroppedFrame、GC、DOM/heap 和 React 组件渲染次数。
4. 若性能指标达标但行为测试失败，以行为正确为阻断条件；若行为正确但指标未达标，进入下一阶段而不是扩大单阶段改动。

## 回滚与停止规则

- 每个阶段独立提交/可逆；不得将阶段 1–4 捆绑成不可拆分重构。
- 任一阶段出现对话串台、恢复丢失、滚动抢夺或状态 stale，立即回退该阶段并保留 Trace/测试证据。
- 阶段 1–3 达到性能门槛后停止扩大范围；不为了追求更低 CPU 而引入虚拟列表。
- 只有长历史基线明确显示消息数量成为主要瓶颈时，才启动方案 B；只有方案 B 仍不足且有真实超长对话需求时，才评估方案 C。

## ADR

### Decision

采用“稳定消息转换缓存 → 拆分 Registry/Controller 订阅 → 隔离 Viewport/滚动恢复 → 视数据处理快照与恢复投影 → 最后评估动画”的渐进式方案。

### Drivers

- 当前开发 Trace 将流式更新后的 React/assistant-ui 更新链和同步布局列为首要热点与嫌疑链路，最终因果需要由生产构建的分阶段 A/B 和相同夹具复测确认。
- 现有 33ms 合帧和 250ms 恢复写入已经合理，不应通过继续加大延迟掩盖下游成本。
- 需要保留恢复、滚动、工具调用和多会话行为，优先选择可独立验证和回滚的边界修复。

### Alternatives considered

- 继续把流式刷新间隔调大：可降低刷新次数，但会增加首字延迟，且不能解决每次刷新过重的问题。
- 立即引入虚拟列表：对超长历史有潜在收益，但当前证据不足，且会增加滚动锚点和可访问性风险。
- 立即关闭 Streamdown 动画：可能减少视觉开销，但 Trace 尚未证明它是主因，不能替代订阅隔离。

### Why chosen

方案优先处理当前 Trace 热点与 assistant-ui 缓存语义共同指向的高概率问题，改动顺序小步可验证，且不越过现有架构边界；每个问题是否构成生产环境主因，以对应阶段的 A/B 证据为准。

### Consequences

- 需要新增订阅生命周期和渲染边界测试。
- Registry 的“全局快照”和“活动 transcript 快照”职责会更清晰，但 API 结构会增加少量复杂度。
- 性能指标必须从开发 Trace 迁移到生产构建，验证成本增加但结论更可靠。

### Follow-ups

- 若方案 A/B 后 1000 条消息仍无法满足 p99 目标，再单独立项评估消息虚拟化。
- 若动画 A/B 显示长文本掉帧显著增加，再决定默认关闭或只动画新增片段。
- 将生产性能 Trace 指标沉淀为可重复的性能回归记录，而不是只保留手工分析。

## 评审修订记录

- 明确 conversation-stream E2E、确定性夹具、指标 JSON、仅测试启用的 Renderer probe，以及 CDP trace 采集/解析文件和清理责任。
- 定义 Registry/Controller 的订阅边界，并补齐 Follow-up Coordinator、Sidebar、后台会话和语义状态通知规则。
- 将 Viewport 重挂载假设改为先测量 ref、DOM identity、effect 生命周期和 Layout 触发来源，再按证据选择最小修复。
- 将 converter 验证从“回调引用稳定”加强为实际缓存命中、历史消息不重复转换和状态变化正确失效。
- 统一 Trace 时间窗、总阻塞算法、下一帧/真实绘制边界和因果措辞，避免用开发 Trace 提前宣称生产主因。

## 执行建议

这是一个可并行但需要统一性能基线的优化项目。推荐由一个负责人维护阶段顺序和指标账本，实施时拆为：

- `executor`：阶段 1，稳定转换回调和 App 测试。
- `architect`/`executor`：阶段 2，设计并实现 Registry/Controller 订阅边界。
- `executor`：阶段 3，隔离 Viewport 和滚动恢复。
- `test-engineer`：负责行为回归、长历史矩阵和性能采样脚本。
- `verifier`：独立复核生产 Trace、验收指标和剩余风险。
