# “切换置顶摘要”浮窗参考项目对齐开发计划

## 1. 先说明截图中的 `conversation-changes-row`

截图里的 `codex/conversationchangesrow` / `conversation-changes-row` 是**当前 Git 分支名**，不是“变更列表组件”的名字。
目标浮窗这一行应始终读取当前仓库的真实分支；当前项目已有 `LocalGitSummary.branch` 字段和
`git branch --show-current` 读取链路，见
`desktop-app/src/shared/localGitApi.ts:169-182`、
`desktop-app/src/main/localGit/LocalGitService.ts:93-123`。

## 2. 计划模式、目标与停止条件

- 计划模式：`$plan` 直接规划模式；需求已经足够明确，不进入访谈或共识规划。
- 目标：在会话顶部右侧增加“切换置顶摘要”按钮，点击后显示与三张附图一致的“环境信息”浮窗；提供“变更”“工作树”“当前分支”“提交或推送”四个本地能力入口，并复用现有 Git 审阅、分支切换、提交和推送能力。
- 停止条件：本文中的可测试验收标准全部通过；两条 GitHub 相关行没有渲染、查询或动作；`codex/codex-rs/app-server/` 没有改动。
- 实施边界：本轮把“置顶摘要”按用户附图实现为 Header 锚定浮窗。参考项目还存在 `overlay / shift / gutter` 三种响应式内联置顶模式，但用户明确要求“点击出现弹窗”，因此不在本轮引入聊天内容位移和常驻侧栏。参考模式判断见
  `/Users/nallylin/Documents/code/dasCowork/reference-projects/codex-electron-26.707.72221-beautified/webview/assets/use-thread-summary-panel-DWmCeaT1.js:921-934,1122-1132`。

## 3. 已确认的现状与参考逻辑

### 3.1 当前项目可直接复用的能力

- 目标 Header 是
  `desktop-app/src/renderer/src/App.tsx:1207-1225`；其 class 正是用户给出的
  `flex h-12 shrink-0 items-center gap-2 transition-[padding] duration-200 ease-out motion-reduce:transition-none`。当前只有会话标题，没有摘要按钮。
- Header 位于 `GitRepositoryProvider`、`LocalGitReviewProvider` 内，见
  `desktop-app/src/renderer/src/App.tsx:659-710,825-836`。因此新组件可直接使用可信 Git target 和审阅上下文，不需要新增全局状态或绕过 preload。
- `GitRepositoryProvider` 已负责把会话身份解析成可信仓库 target，并处理 loading、unavailable、error 和 retry，见
  `desktop-app/src/renderer/src/components/local-git-review/GitRepositoryProvider.tsx:31-93`。
- “变更”行所需分支、文件数、增删行数已经由 `getSummary()` 提供，见
  `desktop-app/src/shared/localGitApi.ts:169-187`、
  `desktop-app/src/main/localGit/LocalGitService.ts:93-135`。
- “变更”可以复用现有 Review 工作区，但当前 `useLocalGitReview().openReview()` 只接受后端来源
  `LocalGitReviewSource`，默认值还是 `{ type: 'unstaged' }`，见
  `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewProvider.tsx:39-63,69-100`。本轮必须补一个语义明确的
  `openUncommittedReview()`，不能让摘要行自己猜 `unstaged/staged`。
- 分支能力已经覆盖列表、搜索、创建、检出、脏工作区阻塞、提交后继续检出，见
  `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.tsx:42-302,304-479`；Main 端固定动作在
  `desktop-app/src/main/localGit/LocalBranchService.ts:11-75`。
- “提交或推送”对话框及安全的 commit/push 工作流已经实现，但目前状态、Git watcher 和 Dialog 都由 Review 工具栏内的
  `ReviewCommitControl` 持有，Header 摘要不在这个控制器作用域，见
  `desktop-app/src/renderer/src/components/right-workspace/review/CommitOrPushDialog.tsx:26-112,131-210`、
  `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:18-169`。
- Renderer 可用的 Git API 是固定白名单；`getSummary/listBranches/searchBranches/createBranch/checkoutBranch/commitChanges/getPublishStatus/pushChanges/subscribe` 已齐全，见
  `desktop-app/src/shared/codexIpcApi.ts:624-656`、
  `desktop-app/src/preload/index.ts:352-466`。本轮核心功能无需新增 Git IPC。
- 当前 DropdownMenu 包装只暴露 Root/Trigger/Content/Item/Separator，还没有 Radix 的 Sub/SubTrigger/SubContent，见
  `desktop-app/src/renderer/src/components/ui/dropdown-menu.tsx:9-75`；这正是实现“悬停左侧二级菜单”的最小基础改动。

### 3.2 参考项目需要复刻的逻辑

- 参考项目的浮窗以受控 Popover 打开，锚定 `end / bottom`、间距 `8px`，只在 open 时挂载内容，并对外部焦点/指针做关闭保护，见
  `/Users/nallylin/Documents/code/dasCowork/reference-projects/codex-electron-26.707.72221-beautified/webview/assets/toggle-thread-summary-panel-DdY6wKiB.js:13-65`。
- 参考项目在 overlay 模式下切换 `isPopoverOpen`；非 overlay 模式才切换内联 pinned 状态，见同文件
  `:72-79`。本轮保留其“受控开关、Escape/外部点击关闭、卸载清理”逻辑，只固定使用 overlay 呈现。
- “变更”行使用独立的 loading 状态和增删统计；有审阅入口时为按钮，没有入口时为 muted row，见
  `/Users/nallylin/Documents/code/dasCowork/reference-projects/codex-electron-26.707.72221-beautified/webview/assets/local-conversation-thread-TggZ39FG.js:6936-6993`。
- 参考项目的 Changes 行并不传 `unstaged/staged`：行组件只调用无参数的 `onOpenReviewTab`，由页面层把它接到统一的
  Review/Diff 导航动作，见同文件 `:6936-6993,9257-9264,9423-9447,9474-9502`。因此当前项目也应暴露“打开未提交审阅”这个
  UI 语义，而不是从摘要组件向下泄漏后端快照类型。
- 环境 section 的顺序是 Changes → Worktree → Branch → Commit/Push → GitHub；本轮只保留前四项。参考组合和明确隐藏 PR action 的参数见同文件
  `:9248-9315`。
- Worktree 行不是静态说明文字：它复用执行位置切换器、向左打开菜单，并根据当前会话是否已绑定、是否为 worktree 决定禁用和标签，见同文件
  `:8960-9071`。
- 分支行同样复用完整的 branch switcher，通过 `renderControl` 把真实当前分支、pending、disabled reason 和 chevron 显示进摘要面板，二级面板向左弹出，见同文件
  `:9147-9201`。
- 参考项目的提交/推送不是在两个 surface 各自创建 hook。`RN` 先用同一目标和会话建立 Git action scope，`fwe` 再按
  `surface="summary-panel" | "review-toolbar"` 只替换 trigger；modal 状态和 commit Dialog 在共同 owner 下只渲染一次，见
  `/Users/nallylin/Documents/code/dasCowork/reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:39727-39814,39816-39978`。

### 3.3 当前项目与参考项目的能力差异

- 当前项目明确禁止把已经启动的历史任务静默移动到全局新选中的项目，见
  `desktop-app/src/main/projects/ProjectService.ts:40-51`；Renderer 也只允许在线程尚未绑定、没有消息且 ready 时修改项目选择，见
  `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:322-327`。
- 当前 `ProjectSelection` 能表达本地、远程、路径和无项目，但没有“同一项目的本地检出 ↔ 云端环境”配对关系，也没有参考项目那套迁移未提交变更、stash/回滚、传输文件、移动任务的 handoff 协议，见
  `desktop-app/src/shared/projects/projectTypes.ts:35-73,84-123`。
- 因此本轮不能把任意 remote project 当成截图中的“云端”，也不能在已启动任务上伪造切换成功。工作树二级菜单会完整呈现，
  但只反映当前会话已经绑定的执行位置；另一位置在没有显式 counterpart/handoff 身份时必须禁用。完整任务 handoff 需要独立需求和协议设计，不塞进本 UI 任务。

### 3.4 审查前三项的逐项结论与本地适配

#### 3.4.1 “变更”行：使用语义化导航 intent，不传单一后端来源

- 参考事实：Changes row 只知道“打开 Review/Diff”，不知道 `unstaged`、`staged` 或 commit SHA；具体导航由页面层注入。因此
  row 是纯展示/触发器，来源聚合由 Review 层决定。
- 当前缺口：当前 `openReview({ type: 'unstaged' })` 初次挂载时会经
  `defaultDisplaySource()` 转成 renderer-only 的 `{ type: 'uncommitted' }`，但已挂载 Review 只在 incoming source 为
  `last-turn` 时主动同步，见
  `desktop-app/src/renderer/src/components/right-workspace/review/useReviewWorkspaceController.ts:52-73,123-128,841-853`。
  如果用户先在 Review 里选了 commit/branch，再点摘要“变更”，仅再次传 `unstaged` 不能证明会回到“未提交”。
- 本地决策：在 `LocalGitReviewProvider` 增加带递增 token 的 renderer-only `ReviewOpenIntent` 和
  `openUncommittedReview()`。该方法负责激活 Review tab、把 provider 的后端 source 复位为 `unstaged` 并清理 last-turn，同时发布
  `{ type: 'uncommitted', token }`。`ReviewWorkspace`/controller 消费每个新 token，并强制切换 display source；消费后按 token 回执清空，避免
  Review 关闭后普通重开时重放旧 intent。
- 边界：不把 `uncommitted` 加进 shared Git IPC schema；Review 仍通过现有
  `backendSourcesForDisplay()` 请求一次 `unstaged` 和一次 `staged` 快照，见
  `desktop-app/src/renderer/src/components/right-workspace/review/reviewWorkspaceModel.ts:163-166`。

#### 3.4.2 “提交或推送”：共同父级拥有一个 controller 和一个 Dialog

- 参考事实：summary 与 review-toolbar 只是两个 surface trigger；目标、异步状态、modal selection 和 Dialog 都属于共同的 Git action
  scope，不会因 surface 数量增加而复制。
- 当前缺口：`ReviewCommitControl` 直接依赖 `ReviewWorkspaceController`，自己查询状态、订阅 Git、持有 `open/pending/branches` 并渲染
  Dialog；把同一 hook 再放进 Header 会形成两个实例、两个 watcher 和两个 Dialog。
- 本地决策：在 `LocalGitReviewProvider` 内、`ConversationWorkspaceLayout` 外增加一次
  `CommitOrPushControlProvider`。它从 `GitRepositoryProvider` 取 trusted target，从 `LocalGitReviewProvider` 取统一反馈，唯一持有
  publish status、branches、pending、dialog state、Git subscription 和操作流程，并在 provider 末端只渲染一个
  `CommitOrPushDialog`。`ReviewCommitControl` 与摘要行都降为 context trigger。
- 解耦：共享 provider 不依赖可能尚未挂载的 `ReviewWorkspaceController.refresh()`。Git 操作完成后沿用已有 target-scoped Git change event；
  Review controller、summary controller 各自按现有 watcher 刷新。测试要分别覆盖 Review tab 关闭和打开两种情况。

#### 3.4.3 “工作树”：身份来自当前会话，不从项目列表猜本地/云端配对

- 参考事实：参考项目的 `Nv` 从同一个 `conversationId` 读取 composer mode、cwd、worktree 状态和当前 thread host，并把该 host 明确放进
  `remoteSelectionState.existingRemoteThreadState.hostId`；若任务已开始，真正的切换交给 conversation-scoped `threadHandoff`，见
  `/Users/nallylin/Documents/code/dasCowork/reference-projects/codex-electron-26.707.72221-beautified/webview/assets/local-conversation-thread-TggZ39FG.js:8960-9071`。
  它没有从“第一个 remote project”或“最近 local project”推断配对。
- 当前缺口：当前 `ProjectSelection` 只能表达一个明确选择；`localProjects`、`remoteProjects`、`activeLocalProjectId` 和
  `activeRemoteProjectId` 之间没有同仓库配对键。发送消息时又优先使用 active conversation 自身的 selection，见
  `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts:275-289`，所以只改全局 selection 也不会迁移已开始的任务。
- 本地决策：本轮使用唯一来源
  `activeConversation.projectSelection ?? projectState.state.activeProjectSelection`。`local/path` 映射为“本地检出”，`remote` 映射为“云端”，
  `projectless/undefined` 映射为未知。当前项显示 checked/current，点击只关闭菜单、不写状态；另一项因没有显式 counterpart/handoff 而禁用。
  两项都不得调用 `projectState.selectProject()`，也不得读取 `activeLocalProjectId/activeRemoteProjectId` 生成替代目标。
- 后续扩展条件：只有新增“与当前 conversation 绑定的明确 counterpart selection + handoff 协议”后，才允许把另一项变成可操作。该扩展不属于
  本浮窗任务。

## 4. 本轮范围与明确不做

### 4.1 本轮实现

1. 在 Header 右侧、现有工作区按钮左边加入可访问名称为“切换置顶摘要”的图标按钮。
2. 点击按钮打开/关闭“环境信息”浮窗；点击外部或按 Escape 关闭并把焦点还给触发器。
3. 主浮窗只渲染四行：
   - 变更：真实 `+additions -deletions`，点击通过 `openUncommittedReview()` 强制打开 staged+unstaged 聚合审阅。
   - 工作树：hover/focus 打开左侧“继续使用”二级菜单，显示当前会话的“本地检出/云端”身份和不可用项。
   - 当前分支：显示 `getSummary().branch`，hover/focus 打开左侧分支搜索、列表、创建和检出菜单。
   - 提交或推送：打开现有 `CommitOrPushDialog`，执行现有安全工作流。
4. 浮窗打开时按需加载 Git summary；分支数据只在分支子菜单打开时加载；提交状态只在提交对话框打开时加载。
5. 订阅已有 Git change event，在 `head/index/working-tree/config/remote-refs` 变化时刷新对应数据，避免用户操作后仍显示旧统计或旧分支。
6. 保留截图顶部“更多”和“运行”图标的视觉位置；“更多”至少提供“刷新环境信息”，没有可证明的环境运行 action 时“运行”保持禁用并显示原因，不能发送伪动作。

### 4.2 明确不做

- 不渲染“无法获取拉取请求状态”“比较分支”两行，也不执行 GitHub CLI、PR 状态、compare URL 或 remote fetch 查询。
- 不修改 `codex/codex-rs/app-server/`。
- 不新增任意 Git/shell IPC；Renderer 继续只调用固定的 `window.desktopApp.git` 方法。
- 不实现参考项目的 inline/gutter/shift 常驻布局，不移动聊天内容，也不新增 pinned 持久化字段。
- 不在已启动任务上实现本地/云端 handoff；不隐式 fork thread、不自动 stash、不复制文件、不改变现有 thread assignment。
- 不把截图中的分支名硬编码成 `codex/conversationchangesrow`；必须显示当前仓库实际分支。

## 5. 可测试验收标准

### AC-1：Header 入口位置和布局

- 目标 Header 内存在且只存在一个 `button[aria-label="切换置顶摘要"]`；按钮位于标题之后，并在视觉上处于既有底部工作区/右工作区按钮左侧。
- Header 原 class 不被替换；侧栏展开/折叠和右工作区打开/关闭时，标题、摘要按钮、工作区按钮互不覆盖。
- 触发器使用现有 32px `IconButton` 视觉规则；hover/focus/disabled 状态与
  `desktop-app/src/renderer/src/App.tsx:3606-3625` 一致。
- 连续点击触发器分别打开、关闭浮窗；重复渲染不会产生第二个入口。

### AC-2：主浮窗结构和视觉

- 浮窗锚定触发器右端下方，`side="bottom"`、`align="end"`、间距 `8px`；碰撞时允许 Radix 自动换边，但不能溢出视口。
- 按截图 2x 像素密度折算，CSS 主面板约 `300px` 宽、圆角 `24px`、细边框、`bg-popover`、阴影；正文四行约 `40–44px` 高，使用“左图标—中间标签—右统计/chevron”三列布局。
- 顶部标题为“环境信息”；右侧显示“更多”和“运行”图标。“运行”无后端 action 时是可解释的 disabled，不允许点击后无反馈。
- 主面板仅出现“变更”“工作树”“当前真实分支或不可用占位”“提交或推送”；DOM 中不存在“无法获取拉取请求状态”“比较分支”。
- loading 状态显示 spinner/skeleton；Git 不可用时保留结构并显示短原因，不能抛出导致 Header 崩溃。

### AC-3：“变更”行

- `getSummary()` 返回 `additions=89, deletions=222` 时，右侧分别以绿色 `+89`、红色 `-222` 显示，使用 tabular numbers 且不与标签重叠。
- 点击“变更”调用一次 `openUncommittedReview()` 并关闭主浮窗；不得直接调用
  `openReview({ type: 'unstaged' })`。即使 Review tab 已经存在、当前显示的是 commit/branch 或持久化来源，新的 intent token 也必须把
  `displaySource` 强制切回 `{ type: 'uncommitted' }`。
- “未提交”必须正好请求 staged 和 unstaged 两个后端快照并合并展示；测试分别放入一个 staged 文件和一个 unstaged 文件，断言二者都出现，且不请求
  commit/branch 快照。聚合规则见
  `desktop-app/src/renderer/src/components/right-workspace/review/reviewWorkspaceModel.ts:163-166`。
- Git target 不可用时该行 muted/disabled，显示原因且不调用审阅动作。
- Git change event 含 `index` 或 `working-tree` 时重新读取 summary；不相关 target 或不相关 change type 不触发刷新。

### AC-4：“工作树”二级菜单

- pointer hover 或键盘 focus/ArrowRight 到“工作树”行时，左侧出现二级菜单；主行在子菜单打开期间保持高亮。
- 二级菜单约 `230px` 宽、圆角 `16px`，标题为“继续使用”，包含“本地检出”和“云端”两项；图标分别为切换/本地与 cloud 语义。
- 唯一身份来源为 `activeConversation.projectSelection ?? projectState.state.activeProjectSelection`：`local/path` 选中“本地检出”，
  `remote` 选中“云端”，`projectless/undefined` 时两项均未选中。
- 当前项显示 checked/current；点击只关闭菜单且不写 project state。另一项 disabled，并提示“当前任务没有可切换的对应执行位置”；已有
  `threadId` 或消息时补充“已开始的任务暂不支持切换执行位置”。
- 两项都不得调用 `projectState.selectProject()`；不得读取 `activeLocalProjectId/activeRemoteProjectId`、列表第一项或最近项目来猜同仓库配对。
  单测必须断言这些状态下 `selectProject` 调用次数为 0。

### AC-5：分支二级菜单

- 主行显示 `getSummary().branch`；例如当前分支为 `codex/conversationchangesrow` 时原样显示，超长分支单行截断并保留完整 title/accessible name。
- pointer hover 或 focus/ArrowRight 打开向左的分支子菜单，主行持续高亮；菜单约 `300px` 宽，最大高度受视口限制并可滚动。
- 搜索框 placeholder 使用“搜索 {仓库名} 分支”；下方显示“分支”标题、本地分支列表、当前分支 check、当前分支的“未提交：N 个文件”副文案、分隔线及“创建并检出新分支…”入口。
- 输入搜索词调用 `searchBranches({ target, query })`；空搜索使用 `listBranches()` 返回的 local/recent/default 信息，不在 Renderer 自行执行 Git。
- 点击其他分支调用一次 `checkoutBranch()`；成功后主浮窗分支名立即更新，随后以 watch/重新读取结果校准。
- 创建新分支复用 `BranchCreateDialog` 和 `createBranch({ failIfExists: true })`；脏工作区阻塞时继续复用 `BranchSwitchBlockedDialog` 与 commit-before-switch 流程，不能删减现有保护。
- 子菜单 hover 移动到左侧内容时不闪退；Escape 先关闭最深层子菜单，再关闭主浮窗，焦点顺序可预测。

### AC-6：“提交或推送”行

- Git target 可用时点击该行先关闭菜单，再打开唯一的 `CommitOrPushDialog`；不得同时留下菜单遮罩或把焦点丢到 document body。
- `CommitOrPushControlProvider` 在共同父级只挂载一次；DOM 中任意时刻最多一个
  `[data-slot="commit-or-push-dialog"]`。Review tab 未挂载时，摘要入口仍能独立打开并完成操作。
- 对话框继续展示既有“提交”“提交并推送”“推送”三动作及其独立 disabled reason，不复制另一套动作矩阵。
- 执行路径继续使用既有 `createBranch → commitChanges → pushChanges` 顺序和部分成功反馈；现有实现基线见
  `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:83-143`。
- 操作成功或失败后使用 `LocalGitReviewProvider.notifyGitOperation()` 显示结果，并递增共享 `refreshVersion` 让 summary 立即刷新；已挂载的
  Review 继续通过既有 target-scoped Git change subscription 刷新。commit 成功但 push 失败时保留既有“提交成功，但推送失败”语义。
- Review 工具栏原按钮和摘要行必须只调用同一个 context controller；每个 target 只有该 controller 的一份状态查询/订阅、pending 状态和 Dialog，
  不允许两个 surface 各自调用控制 hook。

### AC-7：打开、关闭、键盘和状态生命周期

- Enter/Space 可打开主浮窗；ArrowDown 可进入第一行；ArrowRight/hover 打开二级菜单；ArrowLeft/Escape 按层级关闭。
- 点击主浮窗、二级菜单和 Dialog 内部不会被 outside handler 误判；点击外部关闭主浮窗并把焦点还给触发器。
- active conversation、Git target 或仓库发生变化时：关闭旧浮窗、取消/忽略旧异步结果、清空旧 summary；慢请求不能覆盖新会话数据。
- 组件卸载后移除 Git subscribe；多次打开关闭不累积 listener。
- `prefers-reduced-motion` 下不依赖动画完成状态切换。

### AC-8：架构和排除项

- 新 UI 只位于 `desktop-app/src/renderer/`；Git 数据仍经 preload 白名单和 Main trusted target 执行。
- 不出现 Renderer 对 Node、Electron、`child_process`、任意 shell 或 Git args 的直接调用。
- `git diff --name-only -- codex/codex-rs/app-server` 为空。
- 全仓搜索确认新组件、测试和 E2E 都没有 GitHub/PR/compare action；允许旧 Review 功能仍存在，但摘要浮窗不能导入或渲染它们。

## 6. 实施步骤

### Step 0：先补失败测试和固定选择器

新增/修改：

- 新增 `desktop-app/src/renderer/src/components/conversation-summary/ConversationPinnedSummary.test.tsx`
- 修改 `desktop-app/src/renderer/src/App.test.tsx:1895-1949`
- 修改 `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewProvider.test.tsx`
- 修改 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewWorkspace.test.tsx`
- 修改 `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.test.tsx`
- 修改 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.test.tsx`

操作：

1. 为主触发器、主面板、四个 row、两个 submenu 添加稳定的 `data-slot`，测试不依赖 Tailwind class 文本。
2. 在 `App.test.tsx` 先写 Header 入口唯一性、左右动作不重叠、侧栏/右工作区状态切换的失败测试。
3. 写主浮窗四行、`+/-` 统计、GitHub 两行缺席、loading/unavailable、outside/Escape、慢请求竞态和 listener cleanup 测试。
4. 写“Review 已关闭”和“Review 已打开且停留在 commit/branch”两组测试，证明每次新的 uncommitted intent 都聚合 staged+unstaged。
5. 写 Worktree 的 local/remote/projectless 显示、已启动任务禁用、无配对和 `selectProject` 零调用测试。
6. 扩充分支测试，覆盖 summary 触发形态、左侧子菜单、搜索、current check、未提交副文案、创建/检出和 blocked commit retry。
7. 扩展 commit control 测试，证明两个 trigger 共用一份 provider 状态、一个 watcher 和一个 Dialog。

停止条件：测试能稳定暴露当前“无语义化 uncommitted intent、无共同 commit provider、Worktree 身份不可证明、无 Header 按钮、无主面板、
DropdownMenu 无 Sub”的缺口。

### Step 1：增加语义化“打开未提交审阅”导航 intent

新增/修改：

- 新增 `desktop-app/src/renderer/src/components/local-git-review/reviewOpenIntent.ts`
- 修改 `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewProvider.tsx:39-100,164-190`
- 修改 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewWorkspace.tsx:8-16`
- 修改 `desktop-app/src/renderer/src/components/right-workspace/review/reviewWorkspaceTypes.ts:172-178`
- 修改 `desktop-app/src/renderer/src/components/right-workspace/review/useReviewWorkspaceController.ts:45-128`
- 修改对应 provider/workspace tests。

操作：

1. 定义 renderer-only `ReviewOpenIntent = { token: number; type: 'uncommitted' }`；intent 不依赖 Review 目录里的类型，也不进入
   `desktop-app/src/shared/localGitApi.ts`、preload 或 Main。
2. `LocalGitReviewContextValue` 增加 `openUncommittedReview()`、`reviewOpenIntent` 和
   `acknowledgeReviewOpenIntent(token)`。每次打开都：把 provider 的后端 source 复位到
   `{ type: 'unstaged' }`、清空 last-turn、递增 token，并调用现有 `workspace.openReview({ type: 'unstaged' })` 激活/创建 tab。
3. `ReviewWorkspace` 把 intent 传给 controller；controller 用 `lastHandledIntentTokenRef` 保证每个 token 只消费一次，并执行
   `setDisplaySourceState({ type: 'uncommitted' })`、同步 preferences 后加载聚合来源，再按同一 token 回执清空 intent。不能只依赖首次挂载的
   `defaultDisplaySource()`。
4. 保留 Review 内部 source menu 的行为：用户手动选择 uncommitted 不回写 shared backend source；选择 commit/branch/last-turn 继续走现有
   `onSourceChange`。
5. 单测必须覆盖连续两次 intent、StrictMode 重渲染、消费后关闭/普通重开不重放旧 intent、已有 Review tab 的 persisted commit/branch 来源，
   以及 staged+unstaged 两次 snapshot 调用。

停止条件：无论 Review tab 是否已存在，摘要“变更”每次点击都确定进入 uncommitted display source；shared Git schema 没有新增
`uncommitted`。

### Step 2：补齐嵌套菜单基础组件

修改：

- `desktop-app/src/renderer/src/components/ui/dropdown-menu.tsx:9-75`

操作：

1. 基于现有 `radix-ui` 依赖导出 `DropdownMenuLabel`、`DropdownMenuSub`、`DropdownMenuSubTrigger`、`DropdownMenuSubContent`；不新增依赖。
2. `SubContent` 使用 Portal、与主 Content 相同的颜色/边框/动画 token，并保留 `sideOffset`、`alignOffset`、collision padding 配置。
3. `SubTrigger` 支持 `data-[state=open]` 高亮、disabled、右侧 chevron slot 和键盘语义。
4. 用组件级测试验证 hover、focus、ArrowRight、ArrowLeft、Escape 和 pointer 从主行到左侧面板的稳定性。

停止条件：可以只用 Radix 状态完成二级菜单，不需要手写全局 pointerdown/定时器来维持 hover。

### Step 3：提取可复用的分支菜单控制器和内容

新增/修改：

- 新增 `desktop-app/src/renderer/src/components/local-git-review/useLocalBranchMenuController.ts`
- 新增 `desktop-app/src/renderer/src/components/local-git-review/LocalBranchMenuContent.tsx`
- 修改 `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.tsx:42-479`
- 修改 `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.test.tsx`

操作：

1. 从 `LocalBranchSwitcher` 提取 list/search/rows/pending/error/create/checkout/blocked/commit-and-retry 状态机；保留原 `LocalGitReviewProvider` workflow 锁和反馈。
2. 把搜索框、状态、列表、current check、副文案和 footer 变成 `LocalBranchMenuContent`，接收 controller，不直接自行读取另一个 target。
3. 原 Composer 入口继续使用既有按钮和弹出位置；摘要入口以 `DropdownMenuSubContent side="left" align="start"` 承载同一内容。
4. Dialog 继续在 Portal 层单例渲染；打开 Dialog 前关闭 branch/main menu，关闭后焦点回到正确触发器。
5. 保留现有创建/检出和脏工作区提交后继续逻辑，不复制、降级或删除测试。

停止条件：Composer 旧入口行为不变，摘要入口能复用相同 controller，所有分支写操作只有一套实现。

### Step 4：建立共同父级的提交/推送控制器

新增/修改：

- 新增 `desktop-app/src/renderer/src/components/local-git-review/CommitOrPushControlProvider.tsx`
- 修改 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:18-169`
- 保留并复用 `desktop-app/src/renderer/src/components/right-workspace/review/CommitOrPushDialog.tsx:49-210`
- 修改 `desktop-app/src/renderer/src/App.tsx:659-710`
- 修改对应 tests。

操作：

1. 把 `refreshStatus/openDialog/runAction/pending/branches/buttonEnabled` 从 `ReviewCommitControl` 移到 context provider；provider 从
   `useGitRepository()` 获取 trusted target，从 `useLocalGitReview()` 获取统一 feedback，不接受 `ReviewWorkspaceController`。
2. 在 `App.tsx` 中把 provider 放在 `LocalGitReviewProvider` 内层、`ConversationWorkspaceLayout` 外层，只挂载一次；它同时覆盖 Header 和右侧
   Review workspace，并在 provider 尾部唯一渲染 `CommitOrPushDialog`。
3. `ReviewCommitControl` 变成只读取 context 状态并调用 `openDialog({ origin: 'review-toolbar' })` 的薄 trigger；摘要行调用
   `openDialog({ origin: 'summary-panel' })`。两个组件都不得调用新的 control hook 或自行渲染 Dialog。
4. Git status 查询和 subscription 只由 provider 创建一次，并按 target/change types 过滤；切 target/unmount 时清理。provider 暴露单调递增的
   `refreshVersion`，供 summary 在操作结束后立即刷新；Review workspace 继续通过现有 Git change subscription 刷新，不把 controller 反向注入 provider。
5. 菜单 close 完成后下一 animation frame 打开 Dialog，规避 Radix Menu → Dialog 焦点竞争；关闭 Dialog 时依据 `origin` 把焦点还给正确
   trigger。
6. 保留现有 `createBranch → commitChanges → pushChanges`、部分成功反馈和重试语义；测试统计 provider 的 subscribe/unsubscribe 次数，并断言
   DOM 只有一个 dialog slot。

停止条件：两个入口对同一 Git 状态给出相同可用性、pending、动作顺序和反馈；一个 target 只有一个 provider 实例、一个 Dialog 和一份
commit/push matrix。

### Step 5：实现摘要数据控制器和 Worktree 身份适配器

新增：

- `desktop-app/src/renderer/src/components/conversation-summary/useConversationSummaryController.ts`
- `desktop-app/src/renderer/src/components/conversation-summary/ConversationExecutionTargetSubmenu.tsx`

修改：

- `desktop-app/src/renderer/src/App.tsx:235-238,715-845,1207-1225`，把 `projectState` 传到 Header 摘要组件。

操作：

1. controller 从 `useGitRepository()` 获取 target，从 `useLocalGitReview()` 获取 `openUncommittedReview`，从共享 commit provider 获取
   `refreshVersion/openDialog`。
2. 主浮窗打开后调用 `getSummary`；用 request id/Abort-like generation 忽略过期结果，切 conversation/target 时归零。
3. 订阅 Git event，仅在 target 匹配且含 `head/index/working-tree` 时刷新 summary；错误转为 renderer-safe 显示状态。
4. 只从 `activeConversation.projectSelection ?? projectState.state.activeProjectSelection` 计算当前执行位置：`remote` 显示云端，
   `local/path` 显示本地检出，`projectless/undefined` 显示未知。
5. 当前项是只读 checked/no-op，另一项 disabled；实现中不得调用 `projectState.selectProject()`，不得扫描 local/remote project 列表寻找
   counterpart。已启动任务与未启动任务都遵循同一规则，已启动任务多显示 handoff 不可用原因。
6. 不扩展 shared schema，不写 conversation assignment，不调用 `thread/fork`，不伪造 handoff。

停止条件：Worktree 菜单的每个 enabled/disabled 状态都能由当前 `ProjectState + ActiveConversationContext` 解释，没有“点击看似成功但实际任务未迁移”的状态。

### Step 6：实现主浮窗并接到 Header

新增：

- `desktop-app/src/renderer/src/components/conversation-summary/ConversationPinnedSummary.tsx`
- `desktop-app/src/renderer/src/components/conversation-summary/ConversationPinnedSummary.test.tsx`

修改：

- `desktop-app/src/renderer/src/App.tsx:1207-1225`
- 必要时仅调整 Header 右侧预留宽度和对应测试；不改原 class。

操作：

1. 以受控 `DropdownMenu` 或同等 Radix menu root 实现主浮窗：trigger 为现有 `IconButton`，Content `align=end side=bottom sideOffset=8`。
2. 主面板固定四行和顶部标题/actions；使用 Lucide 中现有的 changes/worktree/branch/commit 图标，不复制 reference SVG bundle。
3. “变更”行接 controller stats/openUncommittedReview；Worktree 和 Branch 使用 `DropdownMenuSub`；Commit 行只调用共同 provider 的
   `openDialog()`。
4. 二级菜单 `side="left"`，结合 collision padding 在窄窗口自动换边；主行 open/hover 状态由 Radix data state 驱动。
5. Header 中以 `ml-auto` 放置摘要 trigger，并按 `workspaceState.isOpen` 为外层绝对 Workspace actions 预留足够空间；测试四种 sidebar/right-workspace 组合的 bounding box 不相交。
6. conversation/target change 和组件卸载时关闭主面板及子面板；不把 overlay open 状态写进 sidebar preferences/localStorage。

停止条件：三张截图的主卡片、工作树子菜单和分支子菜单结构可以由稳定 DOM 选择器复现；变更、分支、提交三个 action 连接真实能力，Worktree
只展示可证明的当前身份和真实禁用状态，不出现假切换。

### Step 7：E2E、视觉核对和回归验证

修改：

- `desktop-app/tests/e2e/local-git-review.e2e.ts:570-646,707-779,850-900`
- 或新增更聚焦的 `desktop-app/tests/e2e/conversation-pinned-summary.e2e.ts`，复用同一套 Git repo/launcher helper。

操作：

1. 在临时 Git 仓库制造可预测的 `+89/-222` 或更小固定 diff，打开摘要并断言真实统计、真实当前分支和 GitHub 两行缺席。
2. 同时制造 staged 和 unstaged 文件；先把 Review 切到 commit/branch，再从“变更”行重新打开，断言两类未提交文件都出现。
3. hover Worktree 行，断言左侧“继续使用/本地检出/云端”、当前身份、另一项禁用原因，且 task/project selection 没有变化。
4. hover Branch 行，搜索、切换到安全分支、创建新分支；另用已有脏工作区用例验证 blocked commit retry。
5. 从摘要行打开 `CommitOrPushDialog`，执行 commit 或 commit-and-push，并断言仓库和 feedback 的真实结果；保留现有 Review 工具栏入口 E2E。
6. 以 658×502、1054×484、1194×790 附图比例附近的 viewport 截图核对：主卡右下锚定、二级面板向左略有重叠、行高/圆角/颜色/截断无破版。
7. 用键盘完成 open → ArrowDown → ArrowRight → Escape → focus return 流程。

停止条件：真实 Electron E2E 覆盖读、审阅、分支写、提交/推送四条路径，且视觉截图无明显偏移。

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 把 `conversationchangesrow` 误当 UI 名称或硬编码 | 任意仓库都显示错误分支 | 只读取 `LocalGitSummary.branch`；用多个分支名测试 |
| 摘要把“未提交”降成单一 `unstaged` 来源 | staged 文件缺失，或已打开的 Review 仍停留在 commit/branch | 使用递增的 `openUncommittedReview` intent；既有 tab + staged/unstaged 双来源测试 |
| Header trigger 与现有 Workspace actions 重叠 | 按钮不可点、标题被遮挡 | 明确预留 action rail；用 sidebar/right-workspace 四状态 DOM/E2E bounding box 验证 |
| 手写 hover 定时器造成二级菜单闪退 | 鼠标无法从主卡移动到左卡 | 扩展现有 Radix DropdownMenu Sub，复用其 pointer grace/keyboard 状态 |
| Menu 关闭与 Dialog 打开抢焦点 | Dialog 瞬间关闭或焦点丢失 | 先 close menu，再在下一 animation frame/open transition 打开 Dialog；加焦点回归测试 |
| 两个 surface 各自创建提交 hook/Dialog | watcher、pending、反馈分裂，Dialog 重复 | 共同父级唯一 `CommitOrPushControlProvider`；两个 surface 只保留 trigger，断言单实例/单 Dialog |
| 同一能力出现两套分支逻辑 | 后续 bug 修复不一致 | 提取 headless branch controller + presentational content；旧入口也迁移到同一实现 |
| Git watcher 导致重复请求或旧请求覆盖新会话 | 闪烁、统计串会话 | 仅 open/需要时订阅；按 target/type 过滤；request generation 丢弃 stale result |
| 误把任意 remote project 当“云端” | 任务跑到错误机器/目录 | 没有明确配对则禁用，不基于 last-active 猜测；完整 handoff 独立规划 |
| 已启动任务静默变更 cwd/assignment | 历史与实际执行环境不一致 | 遵守 `ProjectService`/Registry 现有保护；本轮不 fork、不迁移、不写 assignment |
| Git 不可用、detached HEAD 或远程 watcher 失败 | 浮窗崩溃或出现假操作 | 保留 unavailable/disabled UI、retry，所有写动作继续走 Main 固定 schema |
| 为复刻截图误引入 GitHub 查询 | 超出用户范围并引入网络依赖 | 组件无 GitHub imports/rows；测试断言两条文案不存在 |

## 8. 验证命令与完成证据

按从小到大的顺序执行：

1. 定向 Renderer 测试：
   - `npm --prefix desktop-app test -- LocalGitReviewProvider`
   - `npm --prefix desktop-app test -- ReviewWorkspace`
   - `npm --prefix desktop-app test -- ConversationPinnedSummary`
   - `npm --prefix desktop-app test -- LocalBranchSwitcher`
   - `npm --prefix desktop-app test -- ReviewCommitControl`
   - `npm --prefix desktop-app test -- App.test.tsx`
2. 桌面端完整静态和单测：
   - `npm --prefix desktop-app run typecheck`
   - `npm --prefix desktop-app run lint`
   - `npm --prefix desktop-app test`
3. Electron E2E：
   - `npm --prefix desktop-app run test:e2e -- tests/e2e/conversation-pinned-summary.e2e.ts --reporter=line`
   - 若直接扩展既有文件：`npm --prefix desktop-app run test:e2e -- tests/e2e/local-git-review.e2e.ts --reporter=line`
4. 范围与补丁卫生：
   - `git diff --check`
   - `git diff --name-only -- codex/codex-rs/app-server`，输出必须为空。
   - `rg -n "无法获取拉取请求状态|比较分支|create pull request|pull request status" desktop-app/src/renderer/src/components/conversation-summary desktop-app/tests/e2e/conversation-pinned-summary.e2e.ts`，除负向测试外必须无命中。

最终交付记录应包含：改动文件、定向测试/完整测试/E2E 结果、三种浮窗截图、已启动任务 Worktree 禁用说明，以及 app-server 零改动证据。

## 9. 建议实施顺序

`Step 0 测试锁缺口` → `Step 1 uncommitted intent` → `Step 2 Radix Sub` → `Step 3 分支复用` →
`Step 4 共同 commit provider` → `Step 5 summary controller/Worktree 身份` → `Step 6 Header 与主浮窗` →
`Step 7 E2E/视觉/全量验证`。

这一路径先锁定三个不能靠 UI 猜测的契约（未提交来源、提交控制器所有权、当前会话执行身份），再解决容易复制出第二套状态机的分支区域并组装
UI，能让“复刻参考逻辑”落在现有架构上，而不是只做一张静态外壳。
