# “提交或推送”弹窗参考项目对齐实施计划

## 1. 目标结果

把 Review 工具栏中的“提交或推送”按钮改造成截图所示的命令菜单式弹窗，并复刻参考项目在该弹窗内的核心能力：

- 顶部显示当前提交目标分支，并可切换为“新分支”。
- 提交消息可手工填写；留空时继续使用现有 Codex 提交消息生成能力。
- 可选择是否包含未暂存更改，并实时显示本次选择对应的新增/删除行数。
- 提供“提交”“提交并推送”“推送”三条动作；每条动作按当前仓库状态独立启用或禁用。
- 首次推送自动设置 upstream；已有 upstream 时推送到既定远端分支。
- 支持本地项目和现有远程 Git host，不绕过 Main 的可信仓库解析与 Git 执行边界。

本计划只产出桌面端改造方案，不修改 `codex/codex-rs/app-server/`。当前按钮位于
`desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:9-57`，入口由
`desktop-app/src/renderer/src/components/right-workspace/review/ReviewToolbar.tsx:136` 渲染。

## 2. 已确认的现状与参考行为

### 2.1 当前项目

- 按钮虽然已显示“提交或推送”，但点击后仍复用只支持 commit 的
  `CommitChangesDialog`，见
  `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:26-57`。
- `CommitChangesDialog` 的合同只有
  `onCommit(message, includeUnstaged)`，UI 也是普通表单加“Commit”按钮，见
  `desktop-app/src/renderer/src/components/local-git-review/CommitChangesDialog.tsx:16-31,62-121`。
- 该旧弹窗还被“切换分支前提交”流程复用，见
  `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.tsx:232-280,461-478`。本次不再保留旧组件：先把两个入口迁移到新的统一弹窗，再删除 `CommitChangesDialog.tsx`。
- shared/preload/Main 目前只暴露 `commitChanges`，没有 push 状态或 push 写接口，见
  `desktop-app/src/shared/localGitApi.ts:655-716`、
  `desktop-app/src/shared/codexIpcApi.ts:620-650`、
  `desktop-app/src/preload/index.ts:441-445`、
  `desktop-app/src/main/localGit/localGitIpc.ts:157-161`。
- 现有提交服务已经支持空消息自动生成、`includeUnstaged=true` 时执行 `git add --all`、提交后返回 SHA，见
  `desktop-app/src/main/localGit/LocalCommitService.ts:18-70`；这一能力应复用而非重写。
- `LocalGitService.getSummary()` 已能读取 staged/unstaged/untracked 数量、总增删行和当前分支，但没有按“只含 staged / staged+unstaged”拆分的增删统计，也没有 upstream、remote、ahead 状态，见
  `desktop-app/src/main/localGit/LocalGitService.ts:93-136,938-1003`。
- Main 已通过 `GitRepositoryTargetResolver` 和 `WorktreeRepository` 统一执行本地/远程 Git，见
  `desktop-app/src/main/localGit/LocalGitService.ts:66-90` 和
  `desktop-app/src/main/localGit/GitManager.ts:35-52,252-260`；新能力必须继续走这一层。

### 2.2 参考项目

- 参考弹窗组件在 beautified bundle 的 `eM` 区段，状态读取、分支目标和动作判断见
  `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:35224-35421`。
- 顶部分支选择、80px 提交消息区、未暂存 checkbox、三条动作和 420px 宽命令菜单分别见同文件
  `:35458-35535`、`:35607-35654`、`:35666-35769`、`:35777-35785`。
- “提交 / 提交并推送 / 推送”不会共用一个粗粒度 disabled；参考实现分别计算“无更改”“无可推送提交”“分支/远端不可用”等原因，见同文件
  `:32890-32918,33156-33217,35377-35394`。
- 推送在没有 upstream 时使用当前分支 refspec 并设置 upstream，见同文件
  `:34657-34699`。
- 工作流严格按“可选建分支 → 可选提交 → 可选推送”执行；push-only 不生成提交消息也不提交，见同文件
  `:34783-34920`。
- 普通 Enter 在提交消息框内只换行，Cmd/Ctrl+Enter 执行当前高亮动作；快捷键提示只显示在高亮行，见同文件
  `:35814-35816,35845-35899`。
- 中文目标文案见
  `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/zh-CN-t8Aas5q1.js:6571-6593`。

## 3. 范围与明确不做

### 3.1 本轮范围

1. 为弹窗新增专用 working-tree/publish 状态读取合同。
2. 新增固定语义的 push 合同与 Main service。
3. 新建截图风格的统一 `CommitOrPushDialog`，迁移 Review 和分支切换两个入口后删除旧 `CommitChangesDialog`。
4. 在 Renderer 复刻参考项目的顺序工作流：可选建分支、提交、推送；分支切换场景使用同一组件的 commit-only 模式。
5. 增加 shared、Main、Renderer 和真实仓库 E2E 验证。

### 3.2 不做

- 不修改 Codex app server、provider fork 或聊天推理链路。
- 不允许 Renderer 提交 remote、refspec、Git args、shell 或 force 等任意执行参数。
- 不提供 force push；普通 push 遇到 non-fast-forward 时返回可读错误。
- 不扩展到创建 PR、草稿 PR 或打开浏览器；截图弹窗只包含三条 Git 动作。
- 不保留旧弹窗或并行维护两套提交表单；“提交后继续切分支”迁移到新组件的 commit-only 模式。
- 不新增依赖；复用现有 Radix、cmdk、Lucide、Button、Checkbox、Popover/Tooltip 组件。

## 4. 可测试验收标准

### AC-1：弹窗结构和截图交互一致

- 点击“提交或推送”打开居中的命令菜单式 Dialog；内容宽度为 `420px`、最大宽度 `92vw`，无右上角关闭按钮。
- 顶部一行左侧显示 Git 分支图标与当前分支；点击后可在“当前分支”和“新分支”之间选择。
- 选择“新分支”后在顶部区域出现分支名输入框；空值、以 `/` 结尾、已存在或不安全 ref 均不能执行动作，并显示明确原因。前端校验与
  `desktop-app/src/shared/localGitApi.ts:17-39` 的 ref 约束一致，Main 仍以 `git check-ref-format` 为最终判定。
- 提交消息区固定为 3 行、约 `80px` 高，placeholder 为“提交信息（留空将自动生成）…”。
- “包含未暂存的更改”默认勾选；右侧显示当前选择的 `+新增 -删除`，取消勾选后只统计 staged 更改。
- 分隔线下按顺序展示“提交”“提交并推送”“推送”；高亮项使用完整圆角背景，右侧显示 `Cmd/Ctrl+Enter` 提示。
- 上下方向键循环切换动作；普通 Enter 在 textarea 内换行且不提交；Cmd/Ctrl+Enter 执行当前高亮且可用的动作；Escape 只在没有工作流执行时关闭。

### AC-2：状态必须来自真实 working tree，不受当前 Review 来源干扰

- 即使用户正在查看 commit、branch 或 last-turn diff，菜单中的更改数量、增删行、分支和 push 状态仍来自当前 working tree，而不是
  `ReviewWorkspaceController.loadState.groups`；当前错误耦合点为
  `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:12`。
- 新状态结果至少包含：当前分支、是否存在 HEAD、staged 选择摘要、unstaged+untracked 选择摘要、结构化的 upstream tracking ref、upstream remote 名称、upstream remote ref、选定 push remote、待推送 commit 数和 push 阻塞原因；不得让 Renderer 从 `origin/main` 之类的显示字符串反推 Git 参数。
- 工具栏按钮仅在以下任一条件成立时可用：存在可提交的 selected changes；或当前/待建分支有可推送内容。没有目标仓库、无更改且无待推送提交时禁用。
- 状态读取中或不可用时，三条动作分别展示 loading/disabled reason；commit 状态可用但 remote 不可用时，“提交”仍可执行，“提交并推送”和“推送”禁用。
- Git watch 发出 `config`、`head`、`index`、`remote-refs` 或 `working-tree` 变化后，菜单状态和按钮可用性会重新读取；现有事件类型见
  `desktop-app/src/shared/localGitApi.ts:675-694`。

### AC-3：提交动作保持现有语义

- “提交”只调用 `commitChanges`；不会调用 push。
- 消息非空时按用户文本提交；消息为空时调用现有 `CodexChatRuntimeService.generateCommitMessage()` 注入链，现有装配点为
  `desktop-app/src/main/index.ts:564-568`。
- 勾选未暂存更改时，在消息生成完成后对最新工作区执行 `git add --all`；取消勾选时只提交执行时的当前 index。现有时序与测试基线见
  `desktop-app/src/main/localGit/LocalCommitService.ts:21-67` 和
  `desktop-app/src/main/localGit/LocalCommitService.test.ts:41-141`。
- 选择新分支时先调用既有 `createBranch({ failIfExists: true })`，创建并 checkout 成功后才提交；失败则不提交。
- detached HEAD 可执行“提交”，但不能执行当前分支的 push；用户可选择新分支后再提交/推送。

### AC-4：推送动作安全且具备首次发布能力

- Renderer 的 push 请求只允许 `{ target }`；strict schema 必须拒绝 `remote`、`refspec`、`force`、`args`、`shell` 等额外字段。
- Main 在执行时重新读取当前分支、upstream、remote 和 ahead 状态，不能信任弹窗打开时的旧状态。
- 已有 upstream 时，Main 将当前 HEAD 推送到该 upstream 对应的 remote ref。
- 没有 upstream 时，Main 按以下固定顺序选择 remote：`branch.<name>.pushRemote` → `remote.pushDefault` → 合法的 `branch.<name>.remote` → `origin` → 唯一 remote；仍无法唯一确定时返回 `remote-missing` 或 `remote-ambiguous`，不执行 push。
- 首推执行等价于 `git push --set-upstream <resolved-remote> HEAD:refs/heads/<current-branch>`；目标分支由 Main 当前安全分支名构造，不接受 Renderer refspec。
- push-only 在无待推送 commit 时返回/展示 `nothing-to-push`；存在本地 ahead commit 时即使 working tree 干净也可执行。
- 普通 push 失败返回结构化 `push-failed` 与截断后的 Git stderr/stdout；不得自动 force push、reset、rebase 或修改工作区。
- push 成功后返回实际 branch/upstream，并立即失效 `config` 与 `remote-refs` 相关缓存；不只依赖 watcher 的下一次轮询。
- 本地与远程 Git host 都通过 `WorktreeRepository.git()` 执行；网络命令设置有限超时并禁止交互式终端密码提示，避免 Electron Main 无限挂起。

### AC-5：三条工作流顺序和部分成功反馈明确

- `commit`：可选建分支 → commit。
- `commit-and-push`：可选建分支 → commit 成功 → push；commit 失败时绝不 push。
- `push`：可选建分支 → push；不读取/生成提交消息，也不 stage/commit。
- 用户选择动作后立即关闭菜单并锁定工具栏入口，防止重复触发；完成后通过现有 Git operation feedback 区域显示结果，现有反馈容器见
  `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewProvider.tsx:101-123,196-216`。
- commit 成功但 push 失败时，反馈必须明确为“提交成功，但推送失败”，保留已经创建的 commit/branch，不做隐式回滚；刷新后按钮仍能提供 push-only 重试。
- 全流程完成后主动刷新 Review 和 publish 状态；反馈分别为“已提交到 {branch}”或“已推送 {branch}”。

### AC-6：旧弹窗被完整替换，分支切换流程不回归

- 删除 `desktop-app/src/renderer/src/components/local-git-review/CommitChangesDialog.tsx`，仓库内不再存在该组件的 import、渲染或测试引用。
- `LocalBranchSwitcher` 改用统一的 `CommitOrPushDialog`，通过显式 `mode="commit-before-switch"`（或等价受限动作合同）只展示“提交”，不展示“提交并推送”“推送”或新分支选择。
- 分支切换场景沿用新弹窗的提交消息、自动生成、包含未暂存更改、增删统计、键盘和 pending 交互；提交成功后继续原有 checkout，提交失败时停留在当前分支。
- `LocalBranchSwitcher.test.tsx` 中 commit-and-retry、生成消息失败和 checkout 失败用例继续通过，并新增“使用统一弹窗且不出现 push 动作”的断言。
- 删除旧英文标题、描述和按钮文案；不再保留“Commit local changes before switching branches.” 等旧 UI。

### AC-7：IPC 与架构边界保持

- 新 request/result/status 都在 `desktop-app/src/shared/localGitApi.ts` 用 strict Zod schema 定义，并由 `DesktopGitApi`、preload、Main handler 复用同一类型来源。
- Renderer 仍只能通过 `window.desktopApp.git` 访问 Git；不直接使用 Node、Electron、child_process 或 shell。
- Main 先通过现有 target resolver 验证 target，再执行固定 Git 业务动作；不新增任意命令执行 IPC。
- `codex/codex-rs/app-server/`、AI SDK provider fork 和 admin backend 均无改动。

## 5. 实施步骤

### Step 0：先补失败测试，锁定当前缺口

涉及：

- `desktop-app/src/shared/localGitApi.test.ts:65-102`
- `desktop-app/src/main/localGit/LocalCommitService.test.ts:10-158`
- 新增 `desktop-app/src/main/localGit/LocalPushService.test.ts`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/CommitOrPushDialog.test.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewWorkspace.test.tsx`

操作：

1. 先写 strict push/status schema 测试，证明任意 Git 字段会被拒绝。
2. 用临时普通仓库 + bare remote 写 push service 契约测试：首次推送、已有 upstream、无 remote、多个 remote 无默认值、nothing-to-push、non-fast-forward、detached HEAD。
3. 写新弹窗结构、键盘、checkbox 统计和三动作 disabled matrix 测试；生产组件尚未存在时测试应失败。
4. 写 `ReviewCommitControl` 集成测试，证明当前 displayed source 不是 working tree 时仍使用新状态 API，并覆盖三个动作的调用顺序。

停止条件：测试能稳定暴露“当前只有 commit、无 push API、按钮错误依赖当前 Review groups”三个缺口。

### Step 1：定义 publish 状态和 push 的 shared 合同

修改：

- `desktop-app/src/shared/localGitApi.ts:169-204,655-716`
- `desktop-app/src/shared/localGitApi.test.ts`
- `desktop-app/src/shared/codexIpcApi.ts:35-72,620-650`
- `desktop-app/src/preload/index.ts:71-93,410-456`
- `desktop-app/src/main/localGit/types.ts:1-36`

建议合同：

1. `LocalGitSelectionSummary`：`fileCount/additions/deletions`。
2. `LocalGitPublishStatus`：
   - `branch`, `hasHead`；
   - `staged`, `unstaged`（unstaged 摘要包含 untracked）；
   - `upstreamTrackingRef`（例如 `refs/remotes/origin/main`）、`upstreamRemote`（例如 `origin`）、`upstreamRemoteRef`（例如 `refs/heads/main`）；
   - `selectedPushRemote`、`commitsAhead`；
   - `pushBlockedReason`（`branch-missing | remote-missing | remote-ambiguous | nothing-to-push | status-unavailable | null`）；
   - 可选、限长的 `unavailableReason`。
3. `LocalGitPublishStatusRequest = { target }`。
4. `LocalPushRequest = { target }`。
5. `LocalPushResult`：`success`，或 `branch-missing/remote-missing/remote-ambiguous/nothing-to-push/push-failed`，错误文本统一限长。
6. 增加固定 IPC channels，例如 `git:get-publish-status` 与 `git:push-changes`，并在 `DesktopGitApi`/preload 暴露同名固定方法。

停止条件：shared schema、TypeScript 类型、preload parse 都拒绝额外执行字段，且不复制 DTO。

### Step 2：在 Main 实现状态读取与安全 push

新增/修改：

- 新增 `desktop-app/src/main/localGit/LocalPushService.ts`
- 新增 `desktop-app/src/main/localGit/LocalPushService.test.ts`
- `desktop-app/src/main/localGit/localGitIpc.ts:1-63,132-162`
- `desktop-app/src/main/index.ts:553-568,612-634`
- 必要时从 `desktop-app/src/main/localGit/LocalGitService.ts:938-1025` 提取可复用的 numstat parser/helper，避免复制统计规则。

实现顺序：

1. `LocalPushService.getStatus(target)` 先调用 `resolveTrustedRepository()`，并行读取：
   - `git branch --show-current` 与 HEAD 是否存在；
   - staged numstat/name count；
   - unstaged numstat/name count与 untracked numstat；
   - 当前分支结构化的 `upstreamTrackingRef`、`upstreamRemote`、`upstreamRemoteRef`；
   - remote 配置和待推送 commit 数。
2. ahead 计算规则固定：
   - 有 upstream：`rev-list --count <upstream>..HEAD`；
   - 无 upstream但存在 `<remote>/<branch>` tracking ref：比较该 ref 与 HEAD；
   - 首次发布且远端无同名 tracking ref：HEAD 存在时把该分支视为可发布，commit 数用 `rev-list --count HEAD` 展示。
3. `push(target)` 必须重新调用内部 status/resolve 流程；状态不允许时返回结构化结果。
4. 有 upstream 时直接使用 Main 在执行时重新解析出的 remote 名称和 remote ref；不拆分 shared status 中的显示字符串。无 upstream 时按 AC-4 解析 remote 并执行 `--set-upstream`。
5. Git 命令设置明确超时与输出上限，使用 `GIT_TERMINAL_PROMPT=0` 防止无终端环境悬挂，同时保留 credential helper/SSH agent 的正常工作方式。
6. push 成功后失效 `config`、`remote-refs` 缓存；失败只返回信息，不做任何补偿性写入。
7. 在 `createLocalGitIpcHandlers()` 注入 push service，所有 handler 先 parse shared schema、observe target，再调用 service；在 `main/index.ts` 注册两个新 channel。

停止条件：真实 bare remote 测试证明首推设置 upstream、二次推送使用同一 upstream、无 force 且异常均为结构化结果。

### Step 3：建立统一弹窗并删除旧实现

新增/修改：

- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/CommitOrPushDialog.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/CommitOrPushDialog.test.tsx`
- 修改 `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.tsx:24,232-280,461-478`
- 删除 `desktop-app/src/renderer/src/components/local-git-review/CommitChangesDialog.tsx`
- 如需共享校验，新增
  `desktop-app/src/renderer/src/components/local-git-review/branchNameValidation.ts`，并让
  `BranchCreateDialog.tsx:101-121` 复用；不要保留两套规则。
- 复用 `desktop-app/src/renderer/src/components/ui/command.tsx:15-159`、
  `dialog.tsx:9-142`、`popover.tsx`、`tooltip.tsx`、`checkbox.tsx`。

组件设计：

1. Props 只接收 `open/status/branches/pending/error/mode/onOpenChange/onAction` 等 UI 语义，不直接调用 Git；`mode` 至少区分完整的 `commit-or-push` 和受限的 `commit-before-switch`。
2. 用 `Dialog + DialogContent(showCloseButton=false) + Command` 组合实现 `420px` 命令菜单；`shouldFilter=false`、`loop=true`。
3. 顶部 branch trigger 展示当前分支；Popover 中只有当前分支和“新分支”。新分支输入通过共享 validator 即时校验。
4. 根据 checkbox 合并 `status.staged` 与 `status.unstaged`，生成 selected summary 和 commit disabled reason。
5. 分别计算：
   - commit：selected changes > 0，且新分支名合法；
   - commit-and-push：commit 条件 + 可解析分支/remote；不要求动作前已经 ahead，因为新 commit 会产生 ahead；
   - push：当前分支 `commitsAhead > 0`，或选择新分支且 HEAD 可发布；不依赖 selected changes。
6. disabled item 保留 tooltip，明确“无可提交更改”“无待推送提交”“当前不在分支上”“未配置远端”等原因。
7. 建立受控 `selectedAction`，实现方向键循环、textarea Enter 隔离与 Cmd/Ctrl+Enter 执行；pending 时禁止关闭和重复提交。
8. 将 `LocalBranchSwitcher` 迁移到 `commit-before-switch` 模式：`openCommitDialog()` 改为调用 `getPublishStatus({ target })` 并把结构化状态传给统一弹窗，不再使用 `getSummary()` 或旧的文件数 fallback 驱动提交弹窗；复用相同消息输入、checkbox、staged/unstaged 增删统计和 pending UI，但只允许 commit；保留提交成功后继续 checkout 的现有 continuation。
9. 两个调用点和测试完成迁移后删除 `CommitChangesDialog.tsx`，用全仓搜索确认零引用，不留兼容导出或包装组件。

停止条件：AC-1 的 DOM、可访问名称、焦点、键盘和 disabled matrix 单测全部通过；分支切换入口使用同一组件且只显示提交动作；旧组件文件和引用均已删除。

### Step 4：改造 ReviewCommitControl 并接入三条工作流

修改：

- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:1-60`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewToolbar.tsx:15-22,136`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewWorkspace.tsx:8-25`
- 可能补充 `reviewWorkspaceTypes.ts:94-151` 的 refresh/feedback 合同，但不要把 Git workflow 塞进 Review controller。

操作：

1. 删除 `ReviewCommitControl` 对旧 `CommitChangesDialog` 的引用；改为加载 branches + publish status，并以 `commit-or-push` 模式渲染统一 `CommitOrPushDialog`。
2. 按 publish status 而非 `controller.loadState.groups.length` 判断按钮可用性，修复查看历史 diff 时的错误提交数量。
3. 从 `ReviewWorkspace` 将现有 `notifyGitOperation` 以明确 callback 传给 `ReviewCommitControl`；不要新建第二套 toast。
4. 实现统一 workflow runner：
   - 若选择新分支，先调用 `createBranch`；
   - action 含 commit 时调用 `commitChanges`；
   - action 含 push 时调用 `pushChanges`；
   - 每步只在上一步成功后继续。
5. action 启动后关闭弹窗并锁按钮；使用 operation id 更新同一条 feedback，避免“创建分支/提交/推送”刷出三条互相冲突的消息。
6. 对每个结构化结果生成非程序员可理解的中文反馈；特别处理 commit 成功、push 失败的部分成功状态。
7. finally 中重新读取 publish status 并调用 `controller.refresh()`；Git watch 仍作为外部改动与丢失事件的兜底。

停止条件：三个 action 的调用次数、顺序、参数、短路、部分成功反馈和刷新行为都有 Renderer 单测证据。

### Step 5：补齐组件、Main 集成与 E2E 证据

修改：

- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewWorkspace.test.tsx:180-227,545-559`
- `desktop-app/src/renderer/src/App.test.tsx:400-435` 中 DesktopGitApi mock
- `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.test.tsx`
- `desktop-app/src/main/localGit/localGitIpc.test.ts`（若现有文件不存在则新增）
- `desktop-app/tests/e2e/local-git-review.e2e.ts`
- `desktop-app/tests/test-plan-coverage.json`

最小测试矩阵：

1. Renderer unit：截图结构、分支切换、新分支校验、selected stats、三动作 disabled reason、键盘、pending close guard。
2. Workflow unit：
   - commit-only 不 push；
   - commit-and-push 顺序正确；
   - push-only 不 commit；
   - create branch 失败短路；
   - blank message 原样传给现有 generator 链；
   - commit success + push failure 反馈可重试。
3. Main integration：首次 push 到 bare remote 自动 set-upstream；已有 upstream 二次 push；nothing-to-push；无/多 remote；detached；non-fast-forward；输出/超时映射；额外 IPC 字段被拒绝。
4. Local E2E：
   - 建立临时 bare remote；
   - UI “提交”后 working tree 干净但 branch ahead，按钮仍可打开并执行“推送”；
   - UI “提交并推送”后 remote ref 包含新 commit；
   - 选择“新分支”后提交并推送，验证当前分支、remote branch 和 upstream 三者一致。
5. Remote-host E2E：扩展
   `desktop-app/tests/e2e/local-git-review.e2e.ts:916-1012` 的 fake SSH 路径，证明状态、commit 与 push 都经现有 SSH Git host 执行。
6. 回归：完整运行 `LocalBranchSwitcher.test.tsx` 和现有分支切换 E2E，证明统一弹窗的 commit-only 模式能继续提交并切换分支，且不会暴露 push 动作。
7. 迁移所有旧弹窗测试定位方式：把 `[data-slot="commit-changes-dialog"]` 改为统一弹窗稳定标识 `[data-slot="commit-or-push-dialog"]`；把旧 `Commit`/`Cancel`、`Commit message` 和旧英文标题相关定位改为 `data-action="commit"`、textarea 的“提交信息”可访问名称以及 Escape 关闭。分支阻塞确认弹窗自身的文案选择器不在本次删除范围内，除非它依赖被删除的提交弹窗内容。
8. 视觉验收：在暗色主题、420 CSS px 内容宽度下截取弹窗，核对顶部 branch、80px textarea、checkbox/stats、分隔线、三条动作、高亮行与快捷键；不建立易碎的整页像素门禁。

停止条件：AC-1 至 AC-7 均可指向至少一个自动化断言；新增 E2E title/tag 登记到 test-plan coverage。

### Step 6：分层验证与静态清理

按由小到大运行：

```bash
npm --prefix desktop-app test -- \
  src/shared/localGitApi.test.ts \
  src/main/localGit/LocalCommitService.test.ts \
  src/main/localGit/LocalPushService.test.ts \
  src/renderer/src/components/right-workspace/review/CommitOrPushDialog.test.tsx \
  src/renderer/src/components/right-workspace/review/ReviewWorkspace.test.tsx \
  src/renderer/src/components/local-git-review/LocalBranchSwitcher.test.tsx

npm --prefix desktop-app run typecheck
npm --prefix desktop-app run lint
npm --prefix desktop-app test
npm --prefix desktop-app run test:plan-coverage
npm --prefix desktop-app run test:e2e -- --reporter=line
git diff --check
```

补充静态检查：

```bash
rg -n "pushChanges|getPublishStatus|git:push-changes|git:get-publish-status" \
  desktop-app/src desktop-app/tests

rg -n "remote|refspec|force|args|shell" \
  desktop-app/src/shared/localGitApi.ts \
  desktop-app/src/renderer/src/components/right-workspace/review

test ! -e desktop-app/src/renderer/src/components/local-git-review/CommitChangesDialog.tsx
! rg -n "CommitChangesDialog" desktop-app/src desktop-app/tests
! rg -n 'commit-changes-dialog|Commit local changes before switching branches\.|Commit message' \
  desktop-app/src desktop-app/tests
```

判定：

- 新接口在 shared → preload → Main 全链路存在且只接受固定业务字段。
- Renderer 不含 `child_process`、任意 Git args 或 force push 参数。
- Desktop test/typecheck/lint、plan coverage 和本地/远程目标 E2E 全绿。
- 旧 `CommitChangesDialog` 已删除且零引用；旧 data-slot、提交表单英文标题/label 和提交/取消按钮选择器已迁移；branch switch 测试全绿。
- 最终 diff 不包含 `codex/codex-rs/app-server/` 修改，也不覆盖当前工作区已有的无关 Review UI 改动。

## 6. 文件级变更清单

| 文件/模块 | 计划变更 | 验证 |
| --- | --- | --- |
| `shared/localGitApi.ts` | publish status、push request/result、channels | strict schema tests |
| `shared/codexIpcApi.ts` | `DesktopGitApi` 增加状态/push 方法 | typecheck + API mocks |
| `preload/index.ts` | parse 后 invoke 两个固定 channel | preload/typecheck |
| `main/localGit/LocalPushService.ts` | 状态、remote/upstream 解析、安全 push、缓存失效 | bare repo integration |
| `main/localGit/localGitIpc.ts` | handler 注入与 schema parse | IPC unit |
| `main/index.ts` | service 装配和 channel 注册 | Main typecheck/tests |
| `CommitOrPushDialog.tsx` | 截图 UI、分支/checkbox/统计/三动作/快捷键 | component unit + visual |
| `ReviewCommitControl.tsx` | 状态读取、按钮可用性、工作流编排、刷新 | workflow unit |
| `LocalBranchSwitcher.tsx` | 改用统一弹窗的 commit-only 模式和 `getPublishStatus`，保留提交后 checkout | branch switch regression |
| `CommitChangesDialog.tsx` | 删除旧弹窗，不保留包装层 | 全仓零引用检查 |
| `ReviewWorkspace.tsx` / `ReviewToolbar.tsx` | 传递现有 feedback callback | Review integration |
| `BranchCreateDialog.tsx` | 可选：复用共享分支名 validator | branch tests |
| `local-git-review.e2e.ts` | 本地 bare remote + remote host 真实链路 | Playwright E2E |
| `test-plan-coverage.json` | 登记新增稳定场景 | coverage validator |

## 7. 风险与缓解

### 风险 1：commit 成功、push 失败形成部分成功

这是 Git 的真实顺序，不能安全自动回滚 commit。通过结构化 step result、单条明确反馈和 push-only 重试入口处理；禁止隐式 reset/rebase。

### 风险 2：远端凭据或网络导致 Main 长时间阻塞

push 设置有限超时、输出上限与 `GIT_TERMINAL_PROMPT=0`；系统 credential helper/SSH agent 仍可工作。错误通过 `push-failed` 返回，不让 IPC 悬空。

### 风险 3：upstream 缺失或多个 remote 时推错目标

remote 只在 Main 通过固定优先级解析；歧义时拒绝执行。Renderer 无法指定 remote/refspec，也不提供“猜一个并继续”的后门。

### 风险 4：状态在弹窗打开后发生变化

菜单状态只负责预览和 disabled；每个写动作在 Main 执行时重新解析仓库状态。操作结束后主动刷新，watcher 继续兜底。

### 风险 5：统一弹窗迁移破坏分支切换流程

把动作范围做成显式模式而不是在调用点临时隐藏按钮；分支切换只允许 commit，并保留现有 continuation 状态机。删除旧组件前先跑 `LocalBranchSwitcher` 回归，删除后再跑一次全仓零引用和相同测试。

### 风险 6：当前工作区已有 Review UI 改动产生冲突

目前 `ReviewCommitControl.tsx`、`ReviewToolbar.tsx`、`ReviewWorkspace.test.tsx` 等文件已有用户改动。执行时以当前版本为基线做小步 patch，禁止 checkout/reset/覆盖这些改动；每步先读 staged/unstaged diff 再落代码。

## 8. 完成定义

只有同时满足以下条件才算完成：

1. UI 在暗色主题下与截图的结构、尺寸、选中态和键盘交互一致。
2. 三条动作和新分支目标在真实仓库上工作，首推能设置 upstream。
3. working tree 干净但存在 ahead commit 时，按钮仍可打开并完成 push-only。
4. 所有 Git 写入继续经过 shared schema、preload 和 Main 固定业务服务；无任意 Git 参数或 force push。
5. 本地与远程 host E2E、全量 test/typecheck/lint、plan coverage 全绿。
6. 旧 `CommitChangesDialog` 文件和引用已全部删除；分支切换使用统一弹窗且提交流程无回归。
7. 没有修改 Codex app server。
