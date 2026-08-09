# 参考项目“终端”工作区完整复刻计划

> 规划方式：完整设计、分阶段交付。本文只定义目标架构、实施顺序和验收标准，不修改产品代码。
>
> 独立审查：已由 `code-reviewer` 子 Agent 对参考 bundle、当前实现和本计划逐项复核。40 项能力、证据、计划映射和置信度见 [能力追踪表](./reference-terminal-workspace-capability-traceability.md)。

## 1. 结论先行

当前项目已经具备真实终端的底座：主进程使用 `node-pty`，界面使用 `xterm`，输入、尺寸变化和输出事件都经过严格校验的 preload/IPC 通道。复刻工作的重点不是重写终端，而是把现有“标签里的临时进程”升级为“任务拥有、可重新附着、可被后台动作和 AI 安全读取的终端会话”。

推荐按四个里程碑交付：

| 里程碑 | 阶段 | 可独立交付的结果 |
| --- | --- | --- |
| M1 会话连续性 | Phase 0–2 | 本地终端自动启动；切换任务、切换标签、移动面板和 renderer 重建后可附着原进程，不重复启动 |
| M2 可见体验对齐 | Phase 3–4 | 链接、复制粘贴、快捷键、动态标题、主题、字体、Shell 选择和三平台行为对齐参考项目 |
| M3 动作与 AI | Phase 5–6 | 支持未附着前排队、可随后附着的动作终端；`read_thread_terminal` 能只读取当前线程的最新终端输出 |
| M4 远程与发布 | Phase 7–8 | 远程项目通过远端 Codex app-server `process/*` 启动真实 TTY，并完成安全、性能、打包和回归门禁 |

实施边界固定如下：

- 不修改 `codex/codex-rs/app-server/`。
- 不绕过 Codex app server 新建远程执行协议；远程 TTY 使用现有实验性 `process/spawn`、`process/writeStdin`、`process/resizePty`、`process/kill`。
- 本地终端继续使用主进程 `node-pty`；renderer 不直接接触 Node、Electron、Shell、环境变量或远程凭据。
- 显式关闭终端标签仍表示“确认后终止进程”；任务切换、标签失活、面板移动和组件卸载只 detach，不终止。
- 应用退出时终止全部终端；首版不承诺跨应用重启保活。应用重启后，持久化的终端标签自动启动新 Shell，而不是伪装成旧进程仍存在。
- `read_thread_terminal` 只读，不获得执行命令的能力。
- 复刻范围以追踪表中 40 项已确认能力为准；有界 tombstone、main-only AI snapshot 和独立 headless session 等增强必须单独标注，不能冒充参考项目原有行为。

## 2. 参考实现与当前差距

### 2.1 参考项目的权威行为

参考项目不是单个终端组件，而是三层配合：

1. 主进程的全局 Terminal Manager 持有进程、会话到 conversation 的映射、输出缓冲、窗口所有权和本地/远程 backend：
   - 创建、附着、写入、动作、尺寸和关闭分发：`reference-projects/codex-electron-26.707.72221-beautified/.vite/build/main-CpD8a18d.js:58014-58031`
   - 会话创建、conversation 映射和初始输出：同文件 `:64243-64297`
   - 重新附着、窗口所有权、cwd 同步和 session rekey：同文件 `:64298-64360`
   - 退出后删除 session 和 conversation 映射：同文件 `:64362-64381`
   - 动作重启 backend 后在指定 cwd 执行命令：同文件 `:64383-64419`
   - 附着时发送 replay、attached 和 error：同文件 `:64444-64471`
   - 本地 `node-pty` 与远程 `startProcessSession({ tty: true })` 分流：同文件 `:64566-64660`
2. renderer 的 Terminal Session Manager 维护 conversation 下的多会话、活动会话、标题、cwd、16K tail 和未附着前的动作队列：
   - `read_thread_terminal` 工具定义：`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~artifact-tab-content.electron~app-main~new-thread-panel-page~onboarding-page~pr~hoz4f1hh-Cy_DxrPd.js:39761-39770`
   - create/attach/write/runAction/resize/close：同文件 `:39802-39945`
   - conversation 多会话、活动会话和订阅：同文件 `:39959-40035`
   - 16K snapshot、标题和 cwd 元数据：同文件 `:40110-40168`
3. xterm 体验层自动创建或附着，并加载剪贴板、Fit、WebLinks、键盘处理、动态标题和主题/字体更新：
   - xterm 创建与 addon：`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-CrA1-JEm.js:108537-108599`
   - replay、增量输出、标题、输入和自动创建：同文件 `:108609-108669`
   - conversation 多终端标签同步：同文件 `:108779-109043`

### 2.2 当前项目已经具备的能力

以下基础应保留，不重写：

- shared 层已有版本号、Zod 请求/结果/事件 schema：`desktop-app/src/shared/terminalWorkspaceApi.ts:3-123`。
- main 已有 `TerminalWorkspaceService`、会话 Map、`node-pty` 适配和增量 data 事件：`desktop-app/src/main/rightWorkspace/TerminalWorkspaceService.ts:24-120`。
- main IPC 按 `webContents.id` 隔离窗口服务，并只允许准备过的工作区 root 创建终端：`desktop-app/src/main/rightWorkspace/registerRightWorkspaceIpc.ts:81-104,175-194`。
- `node-pty` 只在 main 加载，Shell、cwd 和环境也由 main 生成：`desktop-app/src/main/rightWorkspace/registerRightWorkspaceIpc.ts:364-449`。
- preload 已暴露白名单终端方法，renderer 没有 Node 权限：`desktop-app/src/preload/index.ts:489-520`。
- workspace container 已支持多个 terminal tab、右侧/底部移动和运行中关闭确认：`desktop-app/src/renderer/src/components/workspace-container/workspaceOpenTargets.ts:48-56`、`WorkspacePanelController.ts:192-223`。
- xterm 已有 FitAddon、10,000 行本地滚动和 ResizeObserver：`desktop-app/src/renderer/src/components/right-workspace/terminal/TerminalWorkspace.tsx:69-114`。

### 2.3 需要补齐的差距

| 领域 | 当前行为 | 与参考项目的差距 | 优先级 |
| --- | --- | --- | --- |
| 会话归属 | session 只记录 `workspaceId` | 缺 conversation/thread/host/backend/活动会话映射 | P0 |
| 生命周期 | conversation 切换时 `workspace.dispose()` 会杀死该 workspace 的终端 | 参考项目允许导航后重新附着；只有显式 close 才终止 | P0 |
| 恢复 | `terminalSessionId` 只在 renderer runtime；runtime 不持久化 | tab 恢复后无法 attach 原进程；必须由稳定 session ID 和 main 映射恢复 | P0 |
| 启动 | 用户必须点击“启动终端” | 打开 terminal tab 后应自动 create/attach | P0 |
| 传输 | `write()`、`resize()` 返回含最多 2MB scrollback 的完整 snapshot | 高频按键不应序列化完整历史；应为 ack + 增量事件 + 单独 snapshot | P0 |
| 输出缓冲 | 每个 session 最多保留 2MB 字符串，退出 session 不删除 | 需要固定 tail、截断标记、退出保留策略和容量回收 | P0 |
| 多终端 | workspace tab 可多开，但 main 不知道 conversation 的活动 session | 缺稳定排序、活动会话、标题、cwd 和 AI 读取优先级 | P1 |
| xterm | 只有 FitAddon；固定字体和挂载时主题 | 缺 WebLinks、剪贴板、终端内快捷键、动态标题、实时主题/字体、清空活动终端、焦点恢复和尊重用户上翻 | P1 |
| Shell | 只读 `SHELL`/`ComSpec`，无用户选择 | 缺可枚举、可验证的 integrated terminal Shell 偏好和 Windows/WSL 处理 | P1 |
| 动作 | 只有交互式输入 | 缺 `runAction`、未附着前排队、稍后 attach 和按 session 串行重启；独立 headless session 仅是待选增强 | P1 |
| AI 工具 | renderer 只认识 `read_thread_terminal` 的展示名：`assistantRenderUnits.ts:340-344` | provider 已支持动态工具，但未注册终端读取 handler | P1 |
| 远程 | `hostId !== 'local'` 直接拒绝：`registerRightWorkspaceIpc.ts:106-117` | 缺 remote backend；已有远程项目元数据和远端 app-server 启动基础可复用 | P2 |
| 错误体验 | 启动失败时 start 页面不渲染 `error` | `node-pty` 缺失、远程失败和 attach 失败应直接可见并可重试 | P0 |
| 验证 | E2E 会输入 `printf`，但未断言 xterm 输出 | 缺真实输出、恢复、大流量、多会话、工具和远程测试 | P0 |

## 3. 目标架构

### 3.1 分层与数据流

```text
Workspace tab / xterm
        │  intent + stable sessionId
        ▼
preload 白名单 + shared Zod API v2
        │
        ▼
main TerminalSessionManager（唯一事实来源）
        ├── session/conversation/thread/owner 映射
        ├── 16K replay tail + metadata + cleanup policy
        ├── LocalPtyBackend ── node-pty
        └── RemoteProcessBackend ── provider CodexProcessSessionClient
                                      └── remote codex app-server process/*

Codex dynamic tool request
        └── read_thread_terminal(threadId)
              └── 同一个 TerminalSessionManager 的只读 snapshot
```

### 3.2 Main：进程级 `TerminalSessionManager`

将 `desktop-app/src/main/rightWorkspace/TerminalWorkspaceService.ts` 的职责迁移到新的 `desktop-app/src/main/terminal/` 域。Manager 在 main bootstrap 中只创建一次，由 right-workspace IPC 和 Codex dynamic tool 共同注入使用；不能继续按 React workspace 生命周期创建或销毁。

每个 session 至少包含：

```ts
type TerminalSessionRecord = {
  sessionId: string
  workspaceId: string
  conversationId: string
  threadId?: string
  ownerWebContentsId: number
  hostId: string
  backendKind: 'local-pty' | 'remote-process'
  purpose: 'interactive' | 'action'
  cwd: string
  shell: string
  shellKind: 'posix' | 'powershell' | 'command-prompt' | 'wsl'
  rawShellTitle?: string
  fixedTitle?: string
  title: string
  cols: number
  rows: number
  status: 'starting' | 'running' | 'exited' | 'error' | 'connection-lost'
  attachedViewId?: string
  preserveOnOwnerDestroy: boolean
  replayTail: string
  truncated: boolean
  createdAt: string
  updatedAt: string
  exitedAt?: string
}
```

固定规则：

- `sessionId` 由 renderer 打开 terminal tab 时预分配，tab ID 使用 `terminal:<sessionId>`；main 校验格式和归属后接收该 ID。这样现有 workspace tab 持久化就能保存稳定身份，无需持久化 native handle。
- main 同时维护 `sessionId -> record`、`conversationId -> ordered sessionIds + activeSessionId`、`threadId -> conversationId`。
- 一个 session 同时最多有一个可视 attachment；移动面板或标签切换先 detach 后 attach，避免两个视图争抢尺寸。
- attach 可按 sessionId 精确命中，也可在明确允许时按 conversation fallback；若请求包含 `nextSessionId`，main 必须在同一临界区原子迁移 session、conversation、active-session 和 attachment 映射，不能重启 backend 或留下旧 key。
- attach 的 `forceCwdSync` 只是“重新同步 cwd”的意图；renderer 不得携带任意 cwd，main 必须从当前 project/thread target 重新解析并校验 cwd，再决定是否向 backend 同步。
- 显式关闭 tab 走 `closeSession` 并终止 backend；组件卸载、任务切换和标签失活只走 `detachSession`。
- conversation 删除或归档调用 `closeForConversation` 终止其全部 session；普通导航不得复用这条路径。
- `preserveOnOwnerDestroy` 由 main 内部根据受信调用入口和 session purpose 决定，renderer 不能传参提权。前台交互 session 默认随所属窗口销毁；若启用独立 action session，只有受信内部动作可选择保留到完成。应用退出仍终止全部 session。
- 进程退出后立即释放 backend 和 live 映射。为 UI/AI 保留轻量 tombstone 与 16K tail 是本项目增强，不是参考项目行为；每个 conversation 最多 20 条、最长 24 小时，超限即回收。
- 每个 conversation 同时最多 20 个 session，每个窗口最多 50 个；超限创建返回结构化错误。

### 3.3 Shared/preload：Terminal API v2

在 `desktop-app/src/shared/terminalWorkspaceApi.ts` 将协议升级为 v2。建议通道：

- `create`：携带稳定 `sessionId`、`workspaceId`、conversation target、尺寸、可选 `shellId` 和 purpose；renderer 不传任意 cwd、host、env 或 shell path。
- `attach`：按 `sessionId + target + viewId` 附着；可带 `allowConversationFallback`、`nextSessionId` 和 `forceCwdSync`。main 必须核对 conversation/window owner，fallback 不得重复 spawn，rekey 必须原子完成；请求不能携带任意 cwd。
- `detach`：解除 view，不结束进程。
- `write`：只返回 `{ accepted: true }` 或 `void`；不返回 snapshot。
- `resize`：只返回轻量 metadata/ack；重复尺寸在 main 和 renderer 两端去重。
- `setTitle`：保存经过长度与控制字符校验的 `rawShellTitle`，同时维护动作 `fixedTitle` 与最终 `title`。
- `runAction`：在指定 session 重启 backend 并执行动作；未 attach 时可排队。创建独立 purpose=`action` 的 headless session 是可选增强，不作为参考能力验收前提。
- `close`：终止并删除 live backend；保留受限 exited tombstone。
- `list`：只返回 metadata，不包含 replayTail。
- `snapshot`：单独读取一次 replay tail，返回 `truncated`。
- `listShells`：返回 main 探测并验证过的 Shell ID、标签和默认项。
- `event`：至少区分 `attached`、`init`、`data`、`title`、`status`、`exit`、`error`。

`clear-active-terminal` 是 renderer 级全局 intent：只路由到当前聚焦的 xterm 视图并调用可视 buffer clear，不清空 main replay tail 或 AI snapshot；焦点不在 terminal 时无动作。

`preserveOnOwnerDestroy` 不属于任何 renderer create/attach 请求字段，只能由 main 的受信调用路径写入 session record。

数据上限：

- main replay 和 AI tail 固定为最后 16,000 个字符，与参考项目一致；返回 `truncated: true` 时 UI 和工具结果都必须显示该事实。
- 单个 data event 不超过 64 KiB；backend 产生更大块时拆分。shared schema 的硬上限保留 1 MiB，作为异常保护而不是正常批大小。
- 输入单次最多 1 MiB，但普通键盘路径不得聚合为大包。
- `list` 永远不携带输出；attach 只发送一次 `init`，之后只发 `data`。

`desktop-app/src/preload/index.ts` 继续对所有入站/出站数据使用同一套 schema；不得把原始 `ipcRenderer`、host connection 或环境变量暴露给 renderer。

### 3.4 Backend：本地与远程统一接口

在 `desktop-app/src/main/terminal/TerminalBackend.ts` 定义最小接口：

```ts
interface TerminalBackend {
  write(data: string): Promise<void> | void
  resize(cols: number, rows: number): Promise<void> | void
  dispose(): Promise<void>
  onData(listener: (data: string) => void): () => void
  onExit(listener: (event: TerminalExit) => void): () => void
  onError(listener: (error: Error) => void): () => void
}
```

- `LocalPtyTerminalBackend` 从现有 `spawnNodePty()` 迁移，仍只在 main `require('node-pty')`。
- `RemoteProcessTerminalBackend` 使用 provider fork 新增的 `CodexProcessSessionClient`，通过远端 app-server 的 `process/*` 管理连接级 `processHandle`。
- provider fork 负责 JSON-RPC 请求、base64 编解码、通知路由、超时和 connection termination；main 只消费 backend 接口，不能复制 app-server 协议细节。
- UTF-8 输出解码使用流式 `TextDecoder`/`StringDecoder`，覆盖一个多字节字符被拆成多个 notification 的情况。
- 远程输入进入有上限的 pending queue：相邻小输入可合并，但 `process/writeStdin` 必须按 session 串行发送并等待前一个 RPC 完成，形成 backpressure；断线后的待发送输入必须拒绝或清理，不能在新 session 中误重放。
- 远程连接断开时 app-server 会终止连接所属 process。UI 状态必须变为 `connection-lost` 并保留 tail；“重新连接”实际是启动新 session，不能声称恢复了旧进程。

### 3.5 Renderer：Terminal Session Store 与 xterm 视图

新增 `desktop-app/src/renderer/src/components/right-workspace/terminal/terminalSessionStore.ts`，作为参考项目 Terminal Session Manager 的本项目版本：

- 模块级单例订阅 preload terminal events，不依赖某个活跃 terminal component 才接收元数据。
- 缓存 conversation session 列表、活动 session、每个 session 的 16K tail、title/cwd/status 和 pending actions。
- 以 `useSyncExternalStore` 或等价 hook 给 `TerminalWorkspace.tsx` 和 workspace tab strip 提供稳定 snapshot。
- `TerminalWorkspace` 挂载时先注册 listener，再 attach；session 不存在时自动 create；收到 `init` 后 reset/write 一次，之后只写增量，避免重复回放。
- session 尚未 attached 时，store 对 write/runAction 使用有界、保序的 pending queue；attached 后按原顺序冲刷，attach/create 失败则明确拒绝并清理，不能静默丢动作。
- xterm 销毁只 detach view，不隐式 kill。`WorkspaceContentRegistry.onClose` 才在关闭确认后调用 `closeSession`。
- terminal tab 标题由 shell title、动作固定标题、cwd basename 和序号按稳定优先级生成；需要给 workspace reducer/context 增加受控的 `update-tab-title`，不能把标题塞进不可持久化 runtime。
- conversation 切换时，`ConversationWorkspaceLayout` 的 cleanup 不再调用“终止该 workspace 全部终端”；它只清理文件 watcher、browser view 和 terminal attachment。
- conversation 删除或归档显式调用 `closeForConversation`；这与页面导航/任务切换的 detach 是两条独立、分别测试的生命周期路径。

活动终端优先级固定为：

1. 当前 conversation 中用户最后激活的交互 terminal；
2. 最近仍在运行的 action terminal；若未启用独立 headless 增强，只考虑可附着的现有 session；
3. 最近退出的 action terminal；
4. 都不存在时返回无终端。

### 3.6 xterm 完整体验

在现有 `TerminalWorkspace.tsx` 基础上补齐：

- `@xterm/addon-fit`：保留。
- `@xterm/addon-web-links`：URL 点击统一走现有安全外链 API，不能直接 `window.open`。
- `@xterm/addon-clipboard` 或等价、可测试的 Clipboard API 适配：macOS Cmd+C/V、Windows/Linux Ctrl+Shift+C/V；没有选择内容时 Ctrl+C 仍发送中断字符。
- `attachCustomKeyEventHandler`：终端聚焦时 Cmd/Ctrl+T 新建 terminal tab；不再被 `isWorkspaceEditableTarget()` 提前吞掉。全局 workspace shortcut 与终端内部 handler 必须有单一归属，不能一次按键创建两个 tab。
- 参考键位矩阵还需覆盖 Ctrl+Arrow、Ctrl+Backspace、Ctrl+Delete 等 shell 控制序列，并逐平台确认不会与系统/工作区快捷键重复触发。
- `onTitleChange`：过滤 NUL/控制字符、去除重复 cwd 前缀、截断后更新 session/tab title。
- `clear-active-terminal` 只在 xterm 拥有焦点时清空该视图的可见 buffer；不清 main 16K tail，切换/重新附着后允许 replay 重新出现。
- 写入前记录用户是否接近底部：接近底部时输出后自动滚到底；用户已上翻时保持原滚动位置。init/replay 完成后恢复 terminal focus，但不得从其他输入控件抢焦点。
- 主题变化时更新现有 terminal 的 `options.theme` 并 refresh，不只影响新建 terminal。
- 字体 family/size 变化时更新现有 terminal 后重新 fit。
- 保持右侧/底部移动后的 requestAnimationFrame refit；Electron zoom 下也验证 cols/rows。
- 链接、复制粘贴和 keyboard handler 都必须在 dispose 时释放。

终端外观偏好可保存在 renderer localStorage；Shell 偏好只保存 main 返回的 `shellId`，创建时由 main 映射到已探测的命令。renderer 不能持久化或提交任意 executable path。

### 3.7 动作终端与 `read_thread_terminal`

参考能力必做：

- `runAction` 可重启已存在 terminal 并在 main 解析出的目标 cwd 运行；即使 session 尚未完成可视 attach，renderer manager 也能先排队，之后执行并查看同一 session 输出。
- 同一 session 的 restart/action 串行执行，后一个动作等待前一个 backend 完成清理；不同 session 可并发。
- Shell 包装按 `posix`、PowerShell、cmd、WSL 分别实现和测试 cwd quoting，禁止使用一个 POSIX 字符串拼接覆盖所有平台。
- 本计划不新增一套通用“任务脚本市场”；只交付 terminal action primitive 和现有调用入口需要的集成。

可选产品增强：

- 独立 purpose=`action` 的 headless session 可在没有 terminal tab 时创建、运行并随后打开查看，但参考 bundle 只证实 `runHeadlessAction` 前端入口，没有证实该 `headless` 标志被 main 保留为独立生命周期。
- 若实施此增强，输出和交互 terminal 复用同一 store/tail/退出状态/回收策略，并使用单独验收；它不作为“参考能力已复刻”的判定条件。

AI 读取：

- 在 `desktop-app/src/main/codexAspProvider.ts` 的 provider settings 注入名为 `read_thread_terminal` 的动态工具定义；provider fork 的 `DynamicToolsDispatcher` 已提供 `threadId/turnId/callId` 上下文，无需修改 app-server。
- handler 只按 `context.threadId` 查询 `TerminalSessionManager`；无 threadId、跨 owner 或无 mapping 时不允许回退到“当前窗口随便一个 terminal”。
- 返回内容是结构化 JSON 文本，至少包含 `terminalAttached`、`sessionId`、`cwd`、`status`、`exitCode`、`output`、`truncated`。
- 没有终端时返回 `success: true`、`terminalAttached: false`，不是工具异常。
- 输出先做终端控制序列清理，保留可读文本和换行；不返回环境变量、Shell 启动配置、host credential 或其他任务输出。
- 任意程序主动打印的 secret 无法被可靠自动识别；安全保证依赖“当前 thread 严格归属 + 16K tail + 不返回 env”，计划和 UI 文案不能承诺通用秘密检测。

### 3.8 远程主机连接

当前远程项目已经有 `hostId/cwd` 解析和 SSH 启动远端 Codex app-server 的能力：

- `ResolvedExecutionTarget` 支持 remote host：`desktop-app/src/shared/projects/projectTypes.ts:37-96`。
- `ProjectService.resolveExistingThreadTarget()` 能返回远端 `hostId/cwd`：`desktop-app/src/main/projects/ProjectService.ts:77-92,206-220`。
- `GitHostRegistry` 已用受校验 SSH alias 启动 `codex app-server --listen stdio://`：`desktop-app/src/main/localGit/GitHostRegistry.ts:341-359,474-476`。
- provider 生成协议已包含 `process/*` 类型：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/app-server-protocol/v2/ProcessSpawnParams.ts` 等。

因此不在 renderer 新增 SSH 客户端。建议抽取 `desktop-app/src/main/hosts/CodexHostConnectionRegistry.ts`：

- 统一持有每个 remote host 的 app-server connection、初始化和 shutdown。
- `GitHostRegistry` 通过依赖注入继续获取 `CodexCommandClient`，保持 Git 行为不变。
- terminal 通过同一 host registry 获取 `CodexProcessSessionClient`，避免为 Git 和 terminal 各自复制 SSH 命令、alias 校验和生命周期。
- 远程凭据继续由系统 SSH agent/config 处理，只存在 main/子进程边界；renderer 只知道非敏感 `hostId`。
- 第一版 remote terminal 明确支持当前 SSH/POSIX 远程项目；Windows 远端主机在 host capability 未能确认前返回“不支持的远程平台”，不能错误使用 POSIX `sh -l`。

## 4. 可测试验收标准

### 4.1 会话与恢复

1. 打开 terminal tab 后无需点击按钮，5 秒内出现 Shell prompt 或明确启动错误。
2. 任务 A 中运行 `sleep 60`，切到任务 B 再切回 A，仍附着同一个 sessionId，spawn 计数保持 1。
3. renderer reload 后 attach 同一个 main session，并只回放一次 tail；不会重复显示历史输出。
4. terminal 在右侧和底部之间移动，sessionId 与进程不变，fit 后 cols/rows 与可视区域一致。
5. 同一任务创建 3 个 terminal，输入和输出互不串线；活动 session、标题和 tab 顺序可恢复。
6. 显式关闭 running terminal 时显示确认；取消不 kill，确认后只 kill 对应 session。普通 tab 失活或任务切换不弹确认、不 kill。
7. 应用退出后无孤儿本地 PTY 或远程 process handle。

### 4.2 协议与性能

8. `write()` 和 `resize()` 响应不包含 scrollback；10,000 次小输入不会产生完整 snapshot IPC。
9. attach 只收到一次 `init`；之后输出只走 `data`，顺序与 backend 一致。
10. fake backend 连续输出 10 MiB 后，main 每 session 保留不超过 16,000 字符，`truncated` 为 true，renderer 不因单个 2MB snapshot 卡顿。
11. 连续创建并退出 100 个 session 后，live backend 为 0，conversation tombstone 不超过 20，过期记录可回收。
12. session 在 attach 与首个 snapshot 之间退出时，UI 最终显示 exited 和正确 exitCode，不停留在 running 空白页。

### 4.3 xterm 体验

13. `https://example.com` 可点击，并只调用受控外链 API。
14. macOS、Windows/Linux 的复制、粘贴、新建 terminal 和 Ctrl+C 行为都有平台分支测试；一次按键最多触发一个动作。
15. Shell title escape 更新 tab title；空标题、控制字符和超长标题被忽略或截断。
16. 系统主题、terminal font family/size 改变后，已打开 terminal 与新 terminal 一致。
17. `node-pty` 加载失败时，错误直接显示在尚未启动的 terminal 页面，并提供重试；不能只写入不可见的 `error` state。

### 4.4 动作与 AI

18. session 尚未可视 attached 时，runAction 可以保序排队；之后打开 tab 能看到同一 session 的 tail、状态和 exitCode。若实现独立 headless session，另按增强项验收。
19. 同一 session 连续两个 runAction 串行重启，不交叉输出；不同 session 可并行。
20. `read_thread_terminal` 读取当前 thread 的活动 terminal；任务 A 的工具调用无法读取任务 B 或其他窗口输出。
21. 无 terminal 时工具返回 `terminalAttached: false`；大输出返回 `truncated: true`；工具结果不含 env、shell command 配置或 credential。
22. 工具调用只经过 provider dynamic tools/app-server server request 路径；renderer 的工具展示继续正确归类。

### 4.5 远程与架构边界

23. remote project 不再被 local root 检查永久拒绝；配置可用的 SSH/POSIX host 能启动 TTY、输入、resize、退出。
24. 远程断线显示 `connection-lost` 并保留 tail；重试创建新 session，不声称恢复旧 process。
25. 恶意 renderer payload 不能指定任意 cwd、host、shell path、env，不能 attach/close 其他 conversation 或 window 的 session。
26. 本地 terminal 仍使用 `node-pty`；远程 terminal 使用 provider `CodexProcessSessionClient`；main 不出现手写 `process/spawn` JSON-RPC mapping。
27. `git diff --name-only -- codex/codex-rs/app-server` 为空。

### 4.6 独立审查补充的精确语义

28. 传入不存在的 sessionId 但允许 conversation fallback 时，attach 命中已有 session 且 spawn 计数不增加；携带 `nextSessionId` 时所有映射原子 rekey，旧 ID 立即失效。
29. `forceCwdSync` 请求不携带任意 cwd；main 从最新 project/thread target 重新解析并校验 cwd，失败时返回明确错误或安全 fallback。
30. owner 窗口销毁时，默认交互 terminal 被终止；只有受信 main 动作创建的、明确允许保留的 action session 可继续。renderer payload 不能改变该策略。
31. `clear-active-terminal` 只清当前聚焦 xterm 的可视 buffer；焦点不在 terminal 时无动作，main replay tail 和 `read_thread_terminal` 结果不被清除。
32. terminal 接近底部时新输出自动滚到底；用户已上翻时位置不被抢走。init/replay 后只在原本应聚焦 terminal 时恢复焦点。
33. 远程输入小包可有界合并，`writeStdin` 同 session 串行且有 backpressure；断线时 pending input 被拒绝/清理，多字节 UTF-8 跨 notification 分片仍正确解码。
34. conversation 删除/归档会关闭其全部 session；普通任务切换、页面导航、tab 失活和面板移动只 detach，不终止 backend。

## 5. 分阶段实施

### Phase 0 — 冻结现有行为和失败基线

目标：先用测试证明现有能力和已知缺口，避免会话重构时把真实 PTY、关闭确认或移动能力改坏。

涉及文件：

- `desktop-app/src/main/rightWorkspace/TerminalWorkspaceService.test.ts`
- `desktop-app/src/shared/terminalWorkspaceApi.test.ts`
- `desktop-app/src/renderer/src/components/right-workspace/terminal/TerminalWorkspace.test.ts`
- `desktop-app/src/renderer/src/components/workspace-container/WorkspacePanelController.test.ts`
- `desktop-app/tests/e2e/right-workspace.e2e.ts`
- `desktop-app/tests/e2e/support/terminalScenario.ts`

行动：

1. 补真实输出断言：输入 `printf terminal-ready` 后，xterm 必须出现 `terminal-ready`。
2. 补启动失败页面测试，锁定当前 `error` 在无 session 分支不可见的问题。
3. 补“切换 conversation 会调用 workspace.dispose 并终止 session”的基线测试，作为 Phase 2 要反转的红灯。
4. 补 write/resize 返回完整 snapshot 的性能契约红灯。
5. 保留运行终端关闭确认、取消关闭、确认关闭和面板移动测试。
6. 为 fallback attach/rekey、forceCwdSync、owner 销毁策略、clear-active、滚动/焦点和 remote input queue 建立先失败的契约测试或测试桩。

退出条件：新增测试能稳定暴露启动错误不可见、导航终止进程、snapshot 巨包三个问题；原有 terminal 单元和 workspace E2E 不退化。

### Phase 1 — Terminal API v2 与会话内核

目标：完成最关键的结构替换；本阶段 UI 可仍保持简化，但 main 已具备 stable session、attach/detach 和轻量传输。

涉及文件：

- `desktop-app/src/shared/terminalWorkspaceApi.ts`
- `desktop-app/src/shared/terminalWorkspaceApi.test.ts`
- `desktop-app/src/shared/rightWorkspaceApi.ts`
- `desktop-app/src/preload/index.ts`
- `[new] desktop-app/src/main/terminal/TerminalBackend.ts`
- `[new] desktop-app/src/main/terminal/TerminalSessionManager.ts`
- `[new] desktop-app/src/main/terminal/LocalPtyTerminalBackend.ts`
- `[new] desktop-app/src/main/terminal/terminalOutputBuffer.ts`
- `[new] desktop-app/src/main/terminal/TerminalSessionManager.test.ts`
- `desktop-app/src/main/rightWorkspace/registerRightWorkspaceIpc.ts`
- `desktop-app/src/main/rightWorkspace/TerminalWorkspaceService.ts`（迁移完成后删除）

行动：

1. 升级 shared API，加入 create/attach/detach/snapshot/setTitle/close 和新事件；attach 明确定义 `allowConversationFallback`、`nextSessionId`、`forceCwdSync`；write/resize 改为 ack。
2. 建立进程级 `TerminalSessionManager`、conversation/thread 映射、owner 校验、状态机和容量限制；实现 fallback attach 与原子 session rekey。
3. 把 node-pty 包装迁入 `LocalPtyTerminalBackend`，保持现有 Shell/cwd/env 行为。
4. 将 replay 改成 16K 有界 buffer；list 只返回 metadata，snapshot 单独读取。
5. right-workspace IPC 改为使用注入的 manager；窗口关闭按内部 `preserveOnOwnerDestroy` 策略处理，应用退出无条件 cleanup；renderer 不得控制 preserve 标志。
6. 所有请求/事件继续经 Zod 校验；为未知 session、跨 owner、重复 attach、fallback/rekey、快速 exit 和 backend error 增加测试。

退出条件：验收 8–12、25、28、30 的 main/shared 部分通过；现有 UI 经最小适配后仍能启动、输入、resize 和关闭本地终端。

### Phase 2 — 自动 create/attach 与任务切换恢复

目标：交付 M1，让 terminal 成为 conversation 会话资源，而不是易丢失的 tab runtime。

涉及文件：

- `[new] desktop-app/src/renderer/src/components/right-workspace/terminal/terminalSessionStore.ts`
- `[new] desktop-app/src/renderer/src/components/right-workspace/terminal/terminalSessionStore.test.ts`
- `desktop-app/src/renderer/src/components/right-workspace/terminal/TerminalWorkspace.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/terminal/TerminalWorkspace.test.ts`
- `desktop-app/src/renderer/src/components/workspace-container/WorkspaceContentRegistry.tsx`
- `desktop-app/src/renderer/src/components/workspace-container/WorkspacePanelController.ts`
- `desktop-app/src/renderer/src/components/workspace-container/workspaceReducer.ts`
- `desktop-app/src/renderer/src/components/workspace-container/workspaceTypes.ts`
- `desktop-app/src/renderer/src/components/workspace-container/workspacePersistence.ts`
- `desktop-app/src/renderer/src/App.tsx:609-625,813-840`
- `desktop-app/tests/e2e/right-workspace.e2e.ts`

行动：

1. 从 terminal tab ID 推导 stable sessionId；移除 `runtime.terminalSessionId` 作为事实来源。
2. 建立模块级 Terminal Session Store，先订阅事件再 attach/create，维护活动 session、raw/fixed/effective title，以及 write/runAction 的有界保序 pending queue。
3. 打开 terminal tab 自动 attach；main 无该 session 时自动 create，不再显示手动启动按钮。
4. attach 支持 conversation fallback、原子 rekey 和 `forceCwdSync` intent；cwd 由 main 从最新 target 解析，renderer 不传路径。
5. conversation workspace unmount 只 detach terminal view；`disposeWorkspace` 不再 kill conversation session。删除/归档则单独调用 `closeForConversation`。
6. 显式关闭仍走 close guard 和 `closeSession`；tab 失活、移动、任务切换只 detach。
7. reducer 增加受控 title update；从 main list/snapshot 对齐恢复的 terminal tabs。
8. E2E 覆盖 A→B→A、tab 切换、右/下移动、renderer reload、多 terminal 隔离、fallback/rekey 和 delete/archive cleanup。

退出条件：验收 1–7、28–30、34 通过；spawn 计数证明恢复路径没有创建第二个进程；M1 可发布。

### Phase 3 — xterm 交互和视觉对齐

目标：补齐参考项目用户直接能感知的 terminal 体验。

涉及文件：

- `desktop-app/package.json` 和 lockfile
- `desktop-app/src/renderer/src/components/right-workspace/terminal/TerminalWorkspace.tsx`
- `[new] desktop-app/src/renderer/src/components/right-workspace/terminal/terminalKeyHandler.ts`
- `[new] desktop-app/src/renderer/src/components/right-workspace/terminal/terminalTheme.ts`
- `[new] desktop-app/src/renderer/src/components/right-workspace/terminal/terminalPreferences.ts`
- 对应 `.test.ts` 文件
- `desktop-app/src/renderer/src/components/workspace-container/workspaceFocusManager.ts`
- `desktop-app/src/renderer/src/App.tsx:913-955`

行动：

1. 加入与 xterm 5.5 兼容的 WebLinks 和 Clipboard addon；安装前核对 Electron/浏览器支持和许可证。
2. 实现安全链接 handler、平台键盘 handler、终端内新建 tab 和一次按键单一归属。
3. 接入 `onTitleChange`，实现 raw/fixed/effective title、控制字符过滤、cwd 前缀去重和稳定 fallback title。
4. 主题/字体变更实时更新现有 xterm；更新后 requestAnimationFrame fit。
5. 接通 `clear-active-terminal` 全局 intent，只清聚焦 xterm 的可视 buffer，不清 main/AI tail；UI 文案使用“清空当前视图”，不能写成“清空终端历史”。
6. 实现“接近底部才自动滚底”的滚动策略和条件式焦点恢复；补 Ctrl+Arrow/Backspace/Delete 控制序列。
7. 完善底部/右侧移动、zoom、选择、粘贴和 dispose 行为测试。

退出条件：验收 13–17、31–32 通过；M2 的可见交互部分可发布。

### Phase 4 — Shell 偏好、本地环境与三平台行为

目标：补齐 configurable shell、worktree 环境和 Windows/WSL 命令语义，不把选择权变成 renderer 任意执行路径。

涉及文件：

- `desktop-app/src/shared/terminalWorkspaceApi.ts`
- `desktop-app/src/preload/index.ts`
- `[new] desktop-app/src/main/terminal/terminalShellCatalog.ts`
- `[new] desktop-app/src/main/terminal/terminalEnvironment.ts`
- `[new] desktop-app/src/main/terminal/terminalCommand.ts`
- `desktop-app/src/main/rightWorkspace/registerRightWorkspaceIpc.ts:364-398`（迁移旧逻辑）
- `desktop-app/src/main/runtimeConfig.ts`（仅放 main-owned 默认项，不保存 renderer 原始命令）
- renderer terminal preferences/tests

行动：

1. main 探测可用 Shell 并返回稳定 `shellId`；创建请求只接受该目录中的 ID。
2. 固定优先级：host `terminal_command` > app/main 全局 terminal command > integrated terminal 用户 shellId 偏好 > 平台安全默认；环境中的 `SHELL`/`ComSpec` 只参与平台默认探测，不越过显式配置。
3. 本地环境继承完整 `process.env` 后应用明确 unset/set；清理 `TERMINFO*` 并设 `TERM=xterm-256color`。若项目已有 worktree 环境覆写，则只在 main 合并。
4. 分别实现 POSIX、PowerShell、cmd、WSL 的 cwd 和 runAction quoting；不存在的 cwd、remote home 和 `forceCwdSync` 采用明确 fallback 并记录可诊断原因。
5. Windows/macOS/Linux 通过条件单元测试；至少在 CI 可用平台运行真实 node-pty smoke。

退出条件：Shell 选择不能越过 main allowlist；本地默认行为无回归；M2 完成。

### Phase 5 — runAction、未附着队列与可选 headless 增强

目标：先复刻参考已证实的 runAction、未附着前排队和随后查看；独立 headless session 作为可选产品增强，不与参考能力完成度混算。

涉及文件：

- `desktop-app/src/shared/terminalWorkspaceApi.ts`
- `desktop-app/src/main/terminal/TerminalSessionManager.ts`
- `desktop-app/src/main/terminal/terminalCommand.ts`
- `desktop-app/src/main/rightWorkspace/registerRightWorkspaceIpc.ts`
- `desktop-app/src/renderer/src/components/right-workspace/terminal/terminalSessionStore.ts`
- `desktop-app/src/renderer/src/components/workspace-container/workspaceOpenTargets.ts`
- 对应 main/renderer tests 和 `right-workspace.e2e.ts`

行动：

1. 实现 session-scoped action restart queue，保证同 session 串行、不同 session 并发；session 尚未 attached 时由 renderer store 保序排队。
2. 实现动作输出、取消、exit metadata 和随后 attach；失败时清理 pending queue 并给出可见错误。
3. 动作固定标题优先于 shell title；动作完成后仍按既定 tail/tombstone 策略保留 16K 和 exitCode。
4. 区分用户显式动作、app 内部动作和未来 AI 触发动作；本阶段不把 runAction 暴露为 AI 可直接调用的动态工具。
5. 可选增强：独立 headless action 创建及 `preserveOnOwnerDestroy`；使用 feature flag/独立测试，不阻塞参考复刻里程碑。
6. E2E 必做未附着 queue→attach→查看历史和 cancel；若启用增强，再加 headless→open tab 场景。

退出条件：验收 18–19 通过；未附着动作能运行、附着和回收。独立 headless 增强只有启用时才进入发布门禁。

### Phase 6 — `read_thread_terminal` 动态工具

目标：让 AI 读取当前线程终端，而不是只在 renderer 显示一个同名工具卡片。

涉及文件：

- `desktop-app/src/main/codexAspProvider.ts`
- `desktop-app/src/main/codexAspProvider.test.ts`
- `desktop-app/src/main/codexChatRuntimeService.ts`（thread/conversation 绑定通知）
- `desktop-app/src/main/terminal/TerminalSessionManager.ts`
- `[new] desktop-app/src/main/terminal/readThreadTerminalTool.ts`
- `[new] desktop-app/src/main/terminal/terminalTextSanitizer.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/dynamic-tools.ts`（优先复用；只有缺少上下文字段时才小改）
- provider/main tests
- `desktop-app/src/renderer/src/lib/assistantRenderUnits.ts`

行动：

1. 在 provider settings 传入完整 tool definition 和 handler，定义空对象 input schema。
2. thread/start 后将真实 threadId 绑定到 conversation sessions；恢复已有 thread 时同样补齐 mapping。
3. handler 严格按 `context.threadId` 调 manager 的只读 snapshot，按固定活动优先级选 session。
4. 对输出做控制序列清理、16K 截断和结构化序列化；没有 terminal 返回正常空结果。
5. 覆盖跨 conversation、跨 window、无 threadId、已退出、action-session 优先级和 provider timeout 测试。

退出条件：验收 20–22、25 通过；明确记录 `read_thread_terminal` 是参考能力的等价、安全收敛实现，不是 renderer-first fallback 路径的逐字复刻；M3 可发布。

### Phase 7 — 真实远程终端

目标：让 remote project 通过远端 app-server 启动真实 TTY，完成参考项目的 local/remote backend 分流。

涉及文件：

- `[new] desktop-app/vendors/ai-sdk-provider-codex-asp/src/process-session-client.ts`
- `[new] desktop-app/vendors/ai-sdk-provider-codex-asp/tests/process-session-client.test.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/index.ts`
- `[new] desktop-app/src/main/hosts/CodexHostConnectionRegistry.ts`
- `desktop-app/src/main/localGit/GitHostRegistry.ts`
- `[new] desktop-app/src/main/terminal/RemoteProcessTerminalBackend.ts`
- `[new] desktop-app/src/main/terminal/TerminalBackendFactory.ts`
- `desktop-app/src/main/projects/ProjectService.ts`（只消费既有 target，不扩大职责）
- `desktop-app/src/main/rightWorkspace/registerRightWorkspaceIpc.ts`
- `desktop-app/src/main/index.ts:516-554,951-967`
- provider/main/E2E tests

行动：

1. provider fork 新增 `CodexProcessSessionClient`，封装 initialize、spawn、write、resize、kill、output/exited 路由、UTF-8 流式解码、断线和 shutdown。
2. 抽取 remote host connection registry，复用现有 SSH alias/remote executable 安全校验；GitHostRegistry 迁移到依赖注入但保持 Git API 不变。
3. backend factory 按 `ResolvedExecutionTarget.hostId` 选择 local node-pty 或 remote process client。
4. 远程创建只使用 main 解析出的 absolute cwd 和 main-owned shell command；renderer 不能覆盖。
5. 实现有界 pending input 合并和同 session 串行 `writeStdin` backpressure；断线拒绝/清理 pending input，绝不向重建 session 重放。
6. mock app-server 集成测试覆盖所有 `process/*`、分片 UTF-8、连续小输入、慢 RPC、断线期间写入；配置 `DASCOWORK_E2E_REMOTE_HOST` 时运行真实 SSH smoke。没有远端环境时必须明确记录该发布验证缺口，不能用 mock 声称真实远端已验收。
7. 断线保留 tail 并标记 `connection-lost`；重试新建 session；shutdown kill 全部 handles。

退出条件：验收 23–26、33 通过；真实配置环境完成 create/input/resize/exit smoke；M4 的功能部分完成。

### Phase 8 — 加固、打包和发布门禁

目标：证明长期运行、原生模块打包、权限边界和全部回归可靠，清理迁移期旧代码。

涉及文件：

- `desktop-app/electron-builder.yml` 或当前 builder 配置
- `desktop-app/tests/e2e/right-workspace.e2e.ts`
- `desktop-app/tests/e2e/support/terminalScenario.ts`
- `desktop-app/scripts/` 下已有 packaged smoke 脚本及必要扩展
- terminal/provider/main 全部测试
- `docs/ai-sdk-provider-codex-asp-api.md`
- `[new] docs/terminal-workspace-architecture.md`

行动：

1. packaged macOS/Windows/Linux 至少验证 node-pty 加载；remote smoke 在有 SSH fixture 的发布环境运行。
2. 跑 10 MiB 输出、100 次 session 循环、快速 create/close、窗口关闭、app quit、remote disconnect 和重复 attach 压力测试。
3. 检查所有错误文案脱敏：不记录 env、authorization、API key、SSH command line credential 或 terminal 全量输出。
4. 删除 Terminal API v1、旧 `TerminalWorkspaceService` 和 `runtime.terminalSessionId` 兼容分支；更新架构文档。
5. 执行完整 lint/typecheck/unit/E2E/packaged smoke；确认 app-server 目录无 diff。

退出条件：第 4 节 34 条验收全部通过或存在明确、获批的环境型缺口；旧实现删除；M4 完成。

## 6. 阶段依赖和并行边界

- Phase 0 必须最先完成。
- Phase 1 是所有后续阶段的硬依赖。
- Phase 2 依赖 Phase 1；Phase 3 与 Phase 4 可在 Phase 2 稳定后分支并行，但最终需要共同验证键盘、主题和 Shell。
- Phase 5 与 Phase 6 依赖 Phase 1/2；Phase 6 最好在 Phase 5 后合并，确保 AI 读取优先级覆盖 action session。
- Phase 7 的 provider process client 和 main host registry 可以与 Phase 3–6 并行开发，但 remote backend 集成必须基于 Phase 1 的 session interface。
- Phase 8 只能在全部功能阶段合并后执行。

建议每个 Phase 一个主 PR；Phase 3/4、Phase 7 的 provider/main 两部分可以拆子 PR，但每个 PR 必须保持应用可编译、现有本地终端可用。

## 7. 验证命令

每阶段先跑目标测试，再跑所在层完整门禁：

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test

npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
npm --prefix desktop-app test

npm --prefix desktop-app run test:e2e -- --reporter=line
npm --prefix desktop-app run test:e2e:packaged

git diff --name-only -- codex/codex-rs/app-server
```

远程阶段另加带受控 fixture 的 smoke；不能把开发者个人 SSH 主机写进测试或仓库配置。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 把 UI 增强先做在旧会话模型上 | 后续 attach 重构会推倒 UI | Phase 1/2 是 Phase 3 的硬依赖 |
| navigation cleanup 与显式 close 混淆 | 切任务误杀进程或关闭 tab 留孤儿 | API 分成 detach/close；两条路径分别测试 |
| 同一输出被 init 和 data 重复写入 | xterm 历史重复 | 先订阅、一次 init、单调事件序列；reload E2E |
| 高频 write 返回大 snapshot | IPC/GC 卡顿 | write/resize 只 ack；16K 单独 snapshot |
| inactive terminal 无 component listener | 标题/状态丢失 | 模块级 session store 统一订阅事件 |
| 远程协议实现在 main 复制 | 破坏分层，难以跟随 app-server | provider `CodexProcessSessionClient` 独占协议映射 |
| remote process 连接断开无法恢复 | 用户误以为还在运行 | 明确 `connection-lost`；只允许新建，不伪恢复 |
| `process/spawn` 是 unsandboxed | 远程任意执行风险 | 仅用户终端/受信动作使用；renderer 不能选 host/cwd/env；AI 工具只读 |
| terminal 输出可能含 secret | 模型读取敏感内容 | thread 严格归属、16K tail、无 env、控制序列清理；不承诺通用 secret 识别 |
| node-pty Electron ABI/打包差异 | 开发可用、发布失败 | Phase 8 packaged smoke；保留原生模块加载错误 UI |
| exited session 累积 | 内存增长 | backend 立即释放；20 条/24h tombstone 上限；100 次循环测试 |
| Shell quoting 跨平台不一致 | cwd 错误或命令被改写 | 按 shellKind 独立实现和测试，禁止共用 POSIX 拼接 |

## 9. 明确不在本计划内

- 不修改 Codex app-server 或为终端另写模型执行客户端。
- 不做跨应用重启的 PTY/process 保活；重启只恢复 tab 布局并启动新 Shell。
- 不新增通用任务脚本市场、完整进程监控器或任意 AI 命令执行工具。
- 不为 remote terminal 自建 SSH credential UI；继续使用系统 SSH 配置/agent。
- 不承诺对终端文本中的任意 secret 做可靠自动识别。
- 不把完整 terminal history、环境变量或远程凭据写进 conversation transcript。

## 10. 完成定义

计划实施完成必须同时满足：

1. 第 4 节所有验收标准通过，真实远程验证若受环境限制必须明确列为发布阻断或获批缺口。
2. provider、desktop lint/typecheck/unit/E2E 和 packaged smoke 全部通过。
3. `codex/codex-rs/app-server/` 无任何改动。
4. 当前旧终端 service/API/runtime 兼容分支已删除，没有两套会话事实来源。
5. 架构文档说明 session 所有权、detach/close、远程断线、AI 读取范围和资源回收策略。
6. [能力追踪表](./reference-terminal-workspace-capability-traceability.md) 中 T01–T40 每项都有实现提交、自动化测试或明确的“有意差异/待补证据”记录；不得以笼统的“终端可用”替代逐项闭环。

## 11. 2026-08-09 实施审查结论

- 开发实现已闭环：稳定 session、精确 attach、真实 restart/forceCwdSync、owner 隔离、有界 tombstone、队列失败语义、偏好 UI、刷新恢复和多终端隔离均有代码与自动化证据。
- 本机发布证据已闭环：macOS packaged smoke 启动真实打包应用，通过 node-pty 执行标记命令；关键 Electron E2E 覆盖右→下→右、renderer reload、A→B→A 和多终端隔离。
- 计划整体仍不标记“全平台完全验收”：`RW-E2E-09` 已由本机 `ssh2` loopback 与生产系统 `ssh` 验证远程 create/input/resize/output，但独立受控 SSH/POSIX 主机的 exit、断线与重试门禁仍未运行；Windows/Linux 打包 node-pty ABI 也必须在对应目标平台运行。这些是明确的发布环境门禁，不能用 mock、同机 loopback 或 macOS 结果代替。
- desktop 全量单元测试的既有记录含 8 个与终端无关的 local-git 默认超时，因此不把“desktop 全量套件通过”写成已有事实；本次改动使用定向 20 files / 133 tests、provider 27 files / 277 tests、typecheck、关键 E2E 和 packaged smoke 完成验证。
