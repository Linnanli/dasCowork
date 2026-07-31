# P0-04 本地 Git 改动审核与恢复：逻辑与 UI 交互复刻实施计划

## 1. 结论与目标

对照 `reference-projects/codex-electron-26.707.72221-beautified` 后，原 P0-04 有明显缺漏，并且把两类不同能力混在了一起：

1. **Git diff 审核面板**：读取未暂存、已暂存、指定提交、分支和上一个 turn 的 diff，并对 section、文件或 hunk 执行暂存、取消暂存和恢复。
2. **Codex Review**：选择“未提交改动”或“相对基准分支”，把审查规则作为普通用户输入，通过现有 `turn/start` 聊天链路运行，并把 `::code-comment` 结果渲染为可定位的审查意见。

原清单还漏了 turn 撤销后的重新应用、patch batches 的正反顺序、写前 revision 校验、部分成功结果、已暂存恢复的两阶段处理、分支阻塞后的“提交并切换”、过期快照与大 diff 状态等关键闭环。上述缺漏已经补入：

- `docs/codex-electron-conversation-gap-checklist.md` 的 P0-04。

本计划的完成标准是：用户能在真实 Electron 链路中查看本地 Git 改动、执行安全的细粒度 Git 操作、撤销或重新应用某个 turn 的改动、启动 Codex Review，以及创建或切换本地分支；功能入口、组件层级、文案、菜单、弹窗、键盘行为、加载/空/失败状态和成功后的页面流转均复刻参考项目，任何失败都不能静默丢失用户改动。

## 2. 不可突破的边界

- 不修改 `codex/codex-rs/app-server/`。
- Renderer 不执行 Git 命令，也不接收任意命令参数；只能调用 preload 白名单中的强类型能力。
- Main process 是本地 Git 读取、写入、工作区解析和安全校验的唯一执行层。
- Provider fork 只负责保留 App Server 事件中的 turn diff / fileChange 信息，不实现本地 Git。
- Codex Review 复用现有 `ConversationTranscriptController.sendMessage()` → `ElectronIpcChatTransport` → Main → provider → App Server 链路，不新增 `review/start` helper，也不建立第二套模型客户端。
- P0-04 不包含 push、PR、CI、reviewer、GitHub 评论或合并；这些仍归 P1-07。
- 不增加第三方依赖；Git 执行继续使用 `execFile()` 参数数组，文件监听优先使用 Node/Electron 已有能力。

## 3. 参考项目对齐决策

| 能力                 | 本项目目标行为                                                             | 参考证据                                                                      |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 审核数据源           | 未暂存、已暂存、指定提交、分支相对基准分支、上一个 turn                    | `webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:42301-42493` |
| commit / branch 选择 | commit 列表含加载、空、失败和重试；branch 显示当前分支到基准分支           | 同文件 `42564-42829`                                                          |
| Git 审核写操作       | section、文件、hunk 的 stage、unstage、revert                              | 同文件 `30374-30861`                                                          |
| staged revert        | 先反向应用到 index，再反向应用到工作区；第二步失败为 partial-success       | 同文件 `30776-30810`                                                          |
| turn 撤销            | patch batches 按逆序撤销，成功后按原顺序 Reapply                           | 同文件 `61171-61429`                                                          |
| 写前安全检查         | 重新读取文件 revision；与快照不一致则拒绝写入                              | `.vite/build/worker.js:67577-67645`                                           |
| Git apply 结果       | 返回 applied、skipped、conflicted；区分 success、partial、error            | `.vite/build/worker.js:63348-63468`                                           |
| 全局 Changes 入口    | 会话 Git 摘要中显示 Changes、加载态和增删统计；点击打开 Review             | `webview/assets/local-conversation-thread-TggZ39FG.js:6936-6993`              |
| turn diff 卡片       | 默认显示文件/增删统计；hover 显示 Review changes；独立 Undo/Reapply/Review | `webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:61090-61455` |
| Review 面板          | 右侧 Review tab、数据源选择、文件区、diff 区和完整工具栏                   | 同文件 `42301-42829,43159-44274,45748-45838`                                  |
| Review 写操作 UI     | section/file/hunk 操作、部分成功反馈和首次 revert 确认                     | 同文件 `30374-30861,44578-44720`                                              |
| 分支切换             | Composer footer 分支控件；阻塞时“Commit and switch branch…”再重试          | `webview/assets/git-branch-switcher-DHRrTd6u.js:430-810,815-1564`             |
| Commit dialog        | Commit target、选择摘要、message、include unstaged 和 pending/error        | `webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:35383-35699` |
| Codex Review         | 未提交或基准分支两种目标；当前会话 inline 或独立会话 detached              | `webview/assets/review-mode-content-CRO4r5jd.js:126-255,558-660`              |
| Review Mode UI       | Composer 内选择目标，再选择基准分支；包含 Git/Xcode 错误与重试状态         | 同文件 `323-551,558-866`                                                      |
| Review 执行链        | 组装 review prompt 后走普通 `start-turn-for-host` / `start-conversation`   | 同文件 `168-217`                                                              |

不照搬参考项目的 remote host、cloud review、VS Code host、GitHub PR、实验开关和多窗口缓存体系。

## 4. UI 与交互复刻规范

### UI-01 对齐原则

- “复刻”按参考项目的入口位置、信息层级、状态机、可见文案、图标语义、操作顺序和反馈方式实现；不能用“功能等价”的独立页面、通用弹窗或临时 drawer 替代参考项目的 Composer footer、turn 卡片、Composer Review Mode 和右侧 Review tab。
- 复用本项目现有颜色、字号、圆角、间距、阴影、focus ring 和 tooltip token；参考项目中能够测量的宽高、padding、gap、对齐和 hover/pressed/disabled 状态，在固定测试视口中允许的几何偏差不超过 2 px。
- 同一动作只保留参考项目中的主入口。为了测试增加的 `data-slot` / `data-testid` 不得改变 DOM 层级、焦点顺序和视觉结果。
- 用户可见文案先与参考项目一致；项目后续统一中文化时必须整组翻译，不能在同一控件中混用两套术语。自动化测试以稳定 message id 或 aria-label 为定位，不以翻译后的文本作为唯一 selector。

### UI-02 会话级 Changes 入口

- 在会话的 Git/项目摘要区域增加一行 `Changes`：左侧是变更图标，中间是标签，右侧加载时显示 spinner，完成时显示总 additions/deletions。
- 有 Review 能力时整行是可点击按钮；点击后激活右侧 `Review` tab，默认来源为当前工作区改动。能力不可用时保留同样排版但使用 muted、不可点击状态。
- Changes 数量变化时只更新右侧 meta，不造成摘要区整体跳动；focus、hover 和 pressed 视觉与同区域其他 item 一致。
- 对齐证据：`local-conversation-thread-TggZ39FG.js:6936-6993`。

### UI-03 completed turn diff 卡片

- 卡片主区域标题使用参考项目的 `Edited file` / `Edited files` 语义，默认副信息显示文件数与 additions/deletions；鼠标 hover 或键盘 focus 主区域时，副信息切换为 `Review changes`。
- 点击卡片主区域、标题或 `Review` 按钮都打开同一个右侧 Review tab，并选择该 turn 的 `last-turn` 来源；不打开另一个样式的 modal。
- 卡片 footer 独立放置 `Undo` / `Reapply` 与 `Review`。Undo 成功后原位切为 Reapply，Reapply 成功后切回 Undo；pending 时按钮显示 loading 并禁止重复提交。
- 非 Git、patch 缺失、patch 超限、cwd 不安全或 turn 未完成时保留按钮位置并禁用；tooltip 明确说明不可用原因，至少覆盖参考项目的 `Undo requires a Git repository` / `Reapply requires a Git repository`。
- 对齐证据：`app-initial~app-main~onboarding-page-DWQ2hD55.js:60580-60585,61090-61455`。

### UI-04 右侧 Review tab 与面板骨架

- Review 是会话内容右侧的 tab/panel，打开后保持会话上下文可见；不能实现为居中弹窗、全屏路由或浮动 drawer。关闭后焦点返回触发入口，再打开时恢复上次 source、选中文件和滚动位置；切换会话时使用各自独立状态。
- 顶部 source picker 按参考项目提供 `Unstaged`、`Staged`、`Commit`、`Branch`、`Last turn`。Commit 使用二级列表并覆盖 loading/error/retry/empty；Branch 显示 `current → base` 并覆盖基准分支 loading/error/retry。
- 面板由可显示/隐藏的文件区和 diff 主区组成。文件行显示状态、路径、重命名前路径、增删统计和 viewed 状态；选择文件后 diff 主区滚动到对应文件。`Jump to file`、`Mark as viewed` / `Mark as not viewed`、加载更多等行为与参考项目一致。
- 顶部工具栏按参考项目保留 `Refresh`、`Collapse all diffs` / `Expand all diffs`、split/unified 切换、`Show files` / `Hide files` 和 `Review options`。Review options 依能力显示 `Load full files`、rich preview、word diffs、white space 与 `Copy git apply command`；不支持的能力隐藏，不能显示一个永远无效的开关。
- 对齐证据：`app-initial~app-main~onboarding-page-DWQ2hD55.js:31192-31285,41589-41590,42301-42829,43159-43975,44268-44274,45748-45838`。

### UI-05 Review 状态与写操作

- loading 使用与参考面板相同位置的 skeleton/spinner；刷新时显示 `Refreshing changes` 且保留已有内容；error 原位显示原因与 Retry；empty 分别显示 `No staged changes`、`No unstaged changes`，适用时显示 `Accept edits to stage them`。
- `Diff too large to display` 时先展示文件摘要；选择单文件后进入单文件模式。二进制、冲突、gitlink、文件已不存在、改动已提交/恢复等状态使用专门提示，不渲染伪文本 diff。
- section/file/hunk 的 stage、unstage、revert 操作放在对应 header/hunk 控件上；pending 只锁定受影响范围，完成后使用 success/partial/error toast，并保留 applied/skipped/conflicted 路径。
- 首次 destructive revert 使用参考项目结构的 feature dialog：标题 `Revert changes?`，说明 `This action removes all of these changes.`，提供 `Don't ask again`、`Cancel` 和主确认按钮；取消、Esc 或关闭均不写 Git。
- 对齐证据：`app-initial~app-main~onboarding-page-DWQ2hD55.js:25620-26134,30374-30861,42266-42300,44578-44720`。

### UI-06 Composer Review Mode

- Codex Review 不是独立 `CodeReviewLauncher`。从 Composer 的 Review action/mode 入口进入后，在原 Composer 容器内用 `ComposerReviewMode` 替换普通输入内容；关闭后恢复进入前的草稿、附件和焦点。
- `choose-target` 状态只显示两个同级选项：`Review against a base branch`、`Review uncommitted changes`。选择基准分支后进入 `choose-base`，在同一容器内显示候选分支行；加载显示 spinner，失败显示 `Unable to load branches` 与 `Retry`。
- macOS Git 被 Xcode license 阻塞时原位显示警告、命令说明和 `Try again`，不以通用 toast 代替；Git root 不存在或启动失败使用参考项目对应 toast。
- 提交目标后只在被点击行显示 pending，防止双击；delivery 使用已有 `reviewDelivery` 偏好决定 inline/detached，不在此模式中新增参考项目没有的第三个选择页。成功后 inline 关闭 Review Mode 并留在当前会话，detached 导航到新会话。
- 对齐证据：`review-mode-content-CRO4r5jd.js:323-551,558-866`。

### UI-07 Composer footer 分支控件

- `LocalBranchSwitcher` 固定放在 Composer footer，与参考项目的运行配置/上下文控件同一层；trigger 显示当前分支并提供 `Switch branch` tooltip。不能放到 Review 面板页头作为替代入口。
- popover 顶部是自动聚焦的分支搜索，主体依次呈现默认分支、当前分支、近期/本地分支和搜索结果；当前分支下显示 `Uncommitted: N files`。覆盖 initial loading、background fetching、load error/retry、search loading、search error/retry 和空仓库禁用态。
- 列表底部用 separator 隔开 `Create and checkout new branch…`。创建弹窗标题为 `Create and checkout branch`，输入框自动聚焦，校验空名称、尾随 `/`、名称已存在和非法 ref，按钮为 `Cancel`、`Create and checkout`。
- checkout/create-and-checkout 被工作区改动阻塞时，弹窗标题为 `Commit changes to switch branch`；有冲突路径时逐行显示路径与 diff stats，并提示 `Please commit your changes to continue`；否则显示总文件数与总增删统计。按钮为 `Cancel`、`Commit and switch branch…`。
- 点击 `Commit and switch branch…` 后打开参考项目同结构的 Commit dialog：顶部显示 commit target 与选择摘要，中间是 `Commit message` textarea（`Commit message (leave blank to generate)…`），下方是 `Include unstaged changes` checkbox 和 `Commit` 主操作；pending、disabled、自动生成失败、nothing-to-commit 与 commit 失败都在原 dialog 内保持可恢复。
- Commit 成功才重试被保存的 checkout 或 create-and-checkout，失败保持在可恢复状态。P0-04 不暴露自动 stash、stash rollback、stashRef 或“暂存改动后切换”UI。
- 对齐证据：`git-branch-switcher-DHRrTd6u.js:430-810,815-1035,1037-1280,1282-1564`；`app-initial~app-main~onboarding-page-DWQ2hD55.js:35383-35699`。

### UI-08 键盘、焦点和动效

- 所有 icon button 有参考语义对应的 aria-label 和 tooltip；开关使用 `aria-pressed`，菜单/弹窗使用正确 role，loading 状态使用可读 status。
- Enter/Space 激活当前按钮或菜单项；上下方向键在 source/branch/menu 行移动；Esc 只关闭最上层 popover/dialog/Review Mode；关闭后焦点回到触发器。
- destructive confirm、创建分支和阻塞提交弹窗启用 focus trap；首焦点分别落在安全取消项或输入框，具体顺序与参考项目一致。pending 期间不允许通过快捷键重复提交。
- 动效只复用项目现有 popover/dialog/tab transition，并服从 `prefers-reduced-motion`；不得用新增动效改变参考项目的交互节奏。

### UI-09 视觉验收

- 在相同 Electron/Chromium 版本、字体、主题和固定视口下，分别采集参考项目与本项目截图；最少覆盖 1440×900 的 light/dark，以及 1280×800 的主流程。
- 组件关键区域（trigger、turn 卡片、Review header/toolbar、source picker、branch popover、所有 feature dialog、Commit dialog、Composer Review Mode）的 `maxDiffPixelRatio` 不超过 0.005；整页不超过 0.01，且任何关键控件边界偏移不超过 2 px。
- 颜色或字体抗锯齿造成的允许差异必须在视觉基线说明中列明；不能通过扩大截图 mask、阈值或隐藏组件来让测试通过。
- 每个视觉基线必须同时有交互断言，防止“截图像但按钮无效”；每个关键交互也必须有截图状态，防止“逻辑通但 UI 不像”。

## 5. 功能验收标准

### AC-01 审核入口和数据源

- 会话摘要中的 `Changes` 行按 UI-02 显示增删统计并打开右侧 Review tab。
- 完成的 `turnDiff` 卡片按 UI-03 显示主区域、hover 文案和独立的 Review、Undo/Reapply。
- “Review”打开同一套右侧 Review tab，并默认选中“上一个 turn”。
- 审核面板能切换未暂存、已暂存、指定提交、分支和上一个 turn。
- 非 Git 目录只允许查看已有的上一个 turn diff；所有 Git-backed 数据源显示明确不可用原因。

### AC-02 审核面板状态

- 面板有文件树、当前文件 diff、增删统计、刷新、加载、空、失败和重试状态。
- 面板入口、tab 位置、source picker、文件区、diff 区和工具栏满足 UI-04。
- diff 过大时先显示文件摘要，用户选择单文件后再读取该文件 diff。
- 快照过期时写操作不可用，刷新成功后才能继续。
- 未跟踪、重命名、复制、类型变化、冲突、二进制和 submodule/gitlink 都有稳定文件状态，不伪装成普通文本修改。

### AC-03 细粒度 Git 操作

- 未暂存来源支持 stage 和 revert。
- 已暂存来源支持 unstage 和 revert。
- 操作范围支持全部、文件和 hunk。
- 文件和 hunk patch 以 atomic 模式应用；section 操作允许 partial-success，但必须返回精确路径。
- staged revert 必须先处理 index，再处理工作区；第二阶段失败时不能误报完整成功。
- 首次 destructive revert 按 UI-05 弹出确认，并支持“不再询问”；取消确认不执行任何 Git 写入。

### AC-04 turn 撤销与重新应用

- Provider 产出的 completed `turnDiff` 保留可执行的 `patchBatches`，每批包含自己的 cwd 和完整 patch；UI 预览仍可单独截断。
- 完整 action patch 超过既定 IPC / journal 上限时标记为 `patch-too-large` 并禁用撤销，绝不拿截断后的 preview 执行恢复。
- 撤销按 batch 逆序执行，重新应用按原顺序执行。
- 任一 batch 返回非 success 时立即停止后续 batch，并显示 applied、skipped、conflicted。
- patch、cwd 或仓库根无法安全解析时按钮禁用。
- 撤销成功后按钮变为“重新应用”；重新应用成功后变回“撤销”。

### AC-05 快照与工作区漂移保护

- Main 为每个 Git 审核快照生成 `snapshotGeneration`，每个文件带 `revision`。
- 所有 section/file/hunk 写入请求都必须携带 Main 先前签发的 generation 和 revision，而不是让 Renderer 自行构造。
- 写入前重新读取目标文件状态；任一 revision 不匹配时整个目标操作拒绝执行，并返回 `stale-snapshot`。
- 操作完成后只刷新 applied、skipped、conflicted 涉及的文件；没有路径时退回刷新 patch 中解析出的路径。

### AC-06 Codex Review

- 从 Composer 进入并按 UI-06 在原 Composer 容器中完成 choose-target → choose-base，不新增独立 launcher。
- 用户只能选择“审核未提交改动”或“相对基准分支审核”。
- 分支审核先在 Main 解析 merge-base；解析失败时不创建 turn。
- inline 模式向当前会话发送一条普通 review prompt。
- detached 模式创建新本地会话并发送相同 prompt。
- prompt 要求优先找 bug、回归、风险和缺失测试，并以 `::code-comment` 输出可定位意见。
- 现有 `codeCommentDirectives.ts` 继续负责解析；无效 directive 保留为普通文本。
- 整条链只产生正常的 `thread/start` / `thread/resume` / `turn/start`，不调用 `review/start`。

### AC-07 本地分支

- 能读取当前分支、默认基准分支、本地分支和近期分支。
- 能创建分支和切换分支，不依赖 remote、GitHub、插件或 `gh`。
- 入口、搜索、列表、创建弹窗和阻塞弹窗满足 UI-07。
- checkout 被工作区改动阻塞时返回 `blocked-by-working-tree-changes` 和涉及路径。
- 只有用户完成“Commit and switch branch…”提交步骤后才重试原 checkout/create-and-checkout。
- 用户取消或提交失败时不切分支、不丢草稿、不改动工作区；重试仍被阻塞时保留路径并允许再次处理。
- 成功后失效 HEAD、index、working tree 相关快照并刷新 UI。

### AC-08 分层和安全

- Shared Zod schema 拒绝空 cwd 身份、非法 ref、非法路径、未知 action/source/target 和超限 patch。
- Main 依据 conversation/thread 对应的项目分配解析可信 cwd，并确认其真实 Git root；Renderer 传入的展示路径不能改变执行根。
- patch 内所有新旧路径都必须是仓库内相对路径，不允许绝对路径、`..`、NUL 或工作区外路径。
- 所有 Git 子进程有超时、输出上限和结构化错误，不拼接 shell 字符串。

## 6. 数据合同

在 `desktop-app/src/shared/localGitApi.ts` 新增并由 `desktop-app/src/shared/index.ts` 导出：

### 6.1 读取模型

- `LocalGitTarget`：`conversationId`、可选 `threadId`。Main 用它解析可信 cwd。
- `LocalGitReviewSource`：
  - `{ type: 'unstaged' }`
  - `{ type: 'staged' }`
  - `{ type: 'commit'; commitSha: string }`
  - `{ type: 'branch'; baseBranch: string }`
  - `{ type: 'last-turn'; turnId: string }`
- `LocalGitReviewSnapshot`：
  - `snapshotGeneration`
  - `gitRoot`
  - `source`
  - `files[]`
  - `stagedFileCount`
  - `unstagedFileCount`
  - `largeDiff`
- `LocalGitReviewFile`：
  - `path`
  - `previousPath`
  - `changeKind`
  - `revision`
  - `additions`
  - `deletions`
  - `binary`
  - `conflicted`

### 6.2 写入模型

- `LocalGitReviewAction`：`stage | unstage | revert`。
- `LocalGitReviewScope`：`section | file | hunk`。
- `LocalGitPatchTarget`：`staged | unstaged | staged-and-unstaged`。
- 所有审核写请求包含：
  - target 身份
  - source
  - snapshotGeneration
  - 文件 path + revision
  - scope
  - 可选 hunk index
- `LocalGitMutationResult`：
  - `status: success | partial-success | error`
  - `errorCode`
  - `appliedPaths`
  - `skippedPaths`
  - `conflictedPaths`

### 6.3 turn patch 模型

- `TurnPatchBatch`：`cwd`、`diff`、可选 `gitRoot`。
- `TurnPatchAction`：`undo | reapply`。
- Main 必须把每个 cwd 解析到已授权项目根或其 managed worktree 内，再执行 patch。
- action patch 有独立大小上限；超过上限的 turn 仍可审核预览，但不能通过被截断的数据撤销。

### 6.4 分支与提交模型

- `LocalBranchSummary`：current、defaultBase、local、recent。
- `LocalBranchSearchResult`：branch、isCurrent、isDefault、isRecent、uncommittedFileCount。
- checkout request：仅包含业务目标 branch；不接受 `stashUncommitted`、任意 Git 参数或 shell 字符串。
- create-and-checkout request：branch、`failIfExists: true`。
- checkout error：`blocked-by-working-tree-changes | invalid-branch | branch-not-found | not-git-repo | unknown`，并在阻塞时返回 `conflictedPaths`。
- `LocalBranchContinuation` 只存在于 Renderer 状态：`checkout | create-and-checkout` + branch；Main 不接受 Renderer 伪造的 continuation token。
- `LocalCommitRequest`：message、includeUnstaged、snapshotGeneration；空 message 表示请求自动生成后提交。
- `LocalCommitResult`：`success | stale-snapshot | nothing-to-commit | generation-failed | commit-failed`，成功时返回 commit SHA。
- 自动生成 commit message 必须复用 Codex App Server provider 链路；不得从 Renderer 或 Main 直接请求 OpenAI-compatible API。

## 7. 实施步骤

### 阶段 A：保留可执行的 turn patch 信息

1. 修改 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/turn-diff.ts`：
   - 将展示用 `diff` 与执行用 `patchBatches` 分开。
   - `diff` 继续受 `TURN_DIFF_PREVIEW_CHAR_LIMIT` 限制。
   - completed item 才携带可执行 batch；in-progress item 只用于预览，撤销按钮保持禁用。
   - action patch 超过独立安全上限时只输出不可操作原因，不输出可被误用的截断 action patch。
2. 修改 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts`：
   - 在一个 turn 内按事件顺序记录 completed `fileChange` 及其有效 cwd。
   - turn completed 时用 fileChange 记录构建 patch batches，不只保留最后一份合并 diff。
   - 清理 turn 状态时同步清理 batch 缓存，避免跨 turn 污染。
3. 修改 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-mapper.ts`：
   - 复用现有 `fileChangeDiffBatchesForTurn()` 生成历史 turn 的 batches。
   - live 与 reopen 后的 `turnDiff` 输出结构一致。
4. 扩充：
   - `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/event-mapper.test.ts`
   - `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/history-mapper.test.ts`
   - 覆盖单 cwd、多 cwd、连续修改同文件、失败/declined fileChange、preview 截断但 action patch 完整，以及 action patch 超限后禁用。

阶段 A 的 gate：同一个已完成 turn 在 live 和 reopen 两条路径产出的 batch 顺序、cwd 和 patch 内容一致。

### 阶段 B：Shared / Preload 本地 Git 能力合同

1. 新建 `desktop-app/src/shared/localGitApi.ts`，实现第 6 节全部类型和 Zod schema。
2. 在 `desktop-app/src/shared/codexIpcApi.ts` 增加 `DesktopLocalGitApi`：
   - `getSummary`
   - `getReviewSnapshot`
   - `getFileDiff`
   - `applyReviewAction`
   - `applyTurnPatch`
   - `listBranches`
   - `searchBranches`
   - `createBranch`
   - `checkoutBranch`
   - `commitChanges`
   - `generateCommitMessage`
   - `subscribe`
3. 更新：
   - `desktop-app/src/shared/index.ts`
   - `desktop-app/src/preload/index.ts`
   - `desktop-app/src/preload/index.d.ts`
4. IPC channel 使用固定枚举；preload 只做 schema 校验和 `ipcRenderer.invoke` / 事件订阅，不包含 Git 逻辑。
5. 增加 `desktop-app/src/shared/localGitApi.test.ts`，覆盖非法 ref、路径穿越、未知 action/source、超限 patch 和 mutation result。

阶段 B 的 gate：Renderer 只能提交业务字段，不能提交命令名、任意 git args 或未绑定工作区的绝对执行路径。

### 阶段 C：Main Git 引擎与安全恢复

1. 新建 `desktop-app/src/main/localGit/LocalGitService.ts`：
   - 通过项目分配解析 conversation/thread 的可信 cwd。
   - `realpath` 后确认 Git top-level 和允许的 workspace/worktree。
   - 所有命令经可注入的 `runGit(cwd, args)` 执行，沿用 `WorkspaceRecoveryService.ts:254-259` 的 `execFile` 模式，并增加 timeout、maxBuffer 和脱敏错误。
2. 新建 `desktop-app/src/main/localGit/reviewSnapshot.ts`：
   - unstaged：index tree → working tree，并合入 untracked / unmerged。
   - staged：`--cached`。
   - commit：parent commit → selected commit；root commit 使用 empty tree。
   - branch：merge-base/base ref → current tree。
   - 生成 snapshotGeneration 和逐文件 revision。
   - 支持 rename detection、numstat、binary、type change 和 gitlink。
3. 新建 `desktop-app/src/main/localGit/reviewPatch.ts`：
   - 从服务端快照重建 section/file/hunk patch。
   - 写前重新计算 revision。
   - file/hunk 以 atomic patch 执行。
   - stage、unstage、revert 映射与参考项目一致。
   - staged revert 依次处理 index 和 worktree，并保留 partial-success。
4. 新建 `desktop-app/src/main/localGit/applyPatch.ts`：
   - 使用临时 patch 文件和 `git apply`。
   - 支持 reverse、binary、index/working-tree target。
   - turn patch 非 atomic 时可使用 3-way；review file/hunk 必须 atomic。
   - 解析 applied/skipped/conflicted，finally 清理临时文件。
5. 新建 `desktop-app/src/main/localGit/LocalBranchService.ts`：
   - list/search/create/checkout。
   - 解析 checkout 阻塞文件。
   - checkout 只尝试目标操作，不自动 stash、不自动 commit；阻塞时返回冲突路径。
   - create-and-checkout 的 create 成功但 checkout 阻塞时保留新分支，并返回可重试的业务结果，不能再次创建同名分支。
6. 新建 `desktop-app/src/main/localGit/LocalCommitService.ts`：
   - 读取 staged/unstaged/untracked summary，并用 snapshotGeneration 防止提交查看后发生漂移。
   - `includeUnstaged` 为 true 时按参考项目语义把 unstaged/untracked 纳入本次提交；为 false 时只提交 staged。
   - commit message 为空时通过现有 Codex App Server provider 能力生成消息，再执行本地 commit；显式输入时不调用模型。
   - 生成失败、nothing-to-commit、hook 失败和 commit 失败返回结构化结果，不能继续 branch checkout。
7. 新建 `desktop-app/src/main/localGit/LocalGitWatchBroker.ts`：
   - review 面板打开期间监听 HEAD、index 和 working tree。
   - 合并短时间内重复变更，发送 generation invalidated 事件。
   - 平台不支持可靠 watch 时退回面板可见期间的低频状态 generation 轮询。
8. 新建 `desktop-app/src/main/localGit/localGitIpc.ts`，集中做 schema parse、服务调用和错误归一化。
9. 在 `desktop-app/src/main/index.ts:475-535` 附近注册 handler；窗口销毁时移除该窗口的 watch subscription，不影响其他窗口或后台 turn。

阶段 C 的 gate：所有 destructive 测试都在临时 Git 仓库运行；任何 stale revision、冲突或非法路径都不能修改文件。

### 阶段 D：Git 审核面板

1. 新建：
   - `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewProvider.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewPanel.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/ReviewSourcePicker.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/ReviewFileTree.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/ReviewFileDiff.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/ReviewToolbar.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/ConversationChangesRow.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/useLocalGitReview.ts`
2. 在 `desktop-app/src/renderer/src/App.tsx:1910-1945` 的 render-unit 上层提供 review context，并把 `LocalGitReviewPanel` 接入会话右侧 tab/panel 容器；不让 `renderUnitDetails.tsx` 持有全局面板状态，也不使用 modal/drawer 替代。
3. 在会话 Git/项目摘要区接入 `ConversationChangesRow`：
   - loading 时右侧 spinner。
   - ready 时右侧 additions/deletions。
   - click 激活右侧 Review tab，并默认打开工作区 source。
4. 面板严格按 UI-04/UI-05 实现：
   - source picker、commit submenu、current → base branch picker。
   - 可显示/隐藏文件区、diff 主区、文件统计、viewed 状态和 jump-to-file。
   - refresh、collapse/expand、split/unified、Review options 和能力条件展示。
   - loading、refreshing、empty、error、retry、large diff、binary、conflicted、stale snapshot。
   - mutation pending、success、partial、error 与受影响范围锁定。
5. 复用 `desktop-app/src/renderer/src/components/assistant-ui/diff-viewer.tsx`；扩展其 split/unified、word diff、white space、rich preview、完整文件加载和 hunk action 回调，不能复制第二套 diff 渲染。
6. 在 `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx:454-533` 按 UI-03 重构 completed turn card：
   - 移除静态 `CardAction`，主区域支持 hover/focus 的 `Review changes` 切换。
   - 主区域与 Review 按钮都打开 last-turn Review tab。
   - Undo/Reapply 调 `applyTurnPatch`。
   - in-progress、patch 缺失、cwd 未解析、mutation pending 时禁用。
   - 保持按钮位置，展示具体 disabled tooltip。
   - 展示 partial / conflicted 结果，不在失败时乐观切换按钮。
7. destructive revert 的“不再询问”仅存 UI 偏好；Main 仍执行所有 revision 和路径校验。

阶段 D 的 gate：UI-02 至 UI-05 全部有组件和截图证据；每个按钮都能追踪到准确 API 调用，静态占位 selector `turn-diff-static-actions` 不再存在。

### 阶段 E：Codex Review

1. 新建：
   - `desktop-app/src/renderer/src/components/local-git-review/ComposerReviewMode.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/ReviewTargetPicker.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/ReviewBaseBranchPicker.tsx`
   - `desktop-app/src/renderer/src/lib/codeReviewPrompt.ts`
2. 在现有 Composer action/mode 入口加入 Review；进入后保留普通 composer draft/attachments snapshot，并在同一 Composer 容器内渲染 UI-06 的状态机：
   - `choose-target`
   - `choose-base`
   - `submitting`
   - `git-error`
   - `xcode-license-required`
3. target 只允许：
   - uncommitted
   - base branch
4. 分支目标通过 Main `resolveMergeBase` 得到固定 SHA 后再组 prompt，不能在 Renderer 猜测 merge-base。
5. 修改 `desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts:284-307`，暴露受控的：
   - `startInlineCodeReview`
   - `startDetachedCodeReview`
6. inline 调当前 `activeEntry.controller.sendMessage()`；detached 先走现有 `startNewConversation()` / registry，再调用新 entry 的 controller。参考现有 follow-up 在 `useConversationFollowUpCoordinator.ts:188-189` 的程序化发送方式。
7. prompt 规则：
   - uncommitted：审核 staged、unstaged 和 untracked。
   - branch：明确 base branch 和 merge-base SHA。
   - 只报告可执行发现；每条定位意见输出独立 `::code-comment`。
   - 无发现时给简短结论，不伪造评论。
8. 复用现有：
   - `desktop-app/src/renderer/src/lib/codeCommentDirectives.ts:18-82`
   - `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx:672-679`
9. 不修改 provider 的 turn 启动协议；测试断言只出现普通 chat start，不出现 `review/start`。

阶段 E 的 gate：UI-06 的 choose-target/choose-base/error/pending/close 均与参考截图对齐；inline 和 detached 都能在真实 renderer → IPC → Main → provider → App Server 链路中完成，并渲染结构化 review comments。

### 阶段 F：分支控件

1. 新建：
   - `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/BranchListPopover.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/BranchCreateDialog.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/BranchSwitchBlockedDialog.tsx`
   - `desktop-app/src/renderer/src/components/local-git-review/CommitChangesDialog.tsx`
2. 只在 Composer footer 接入 `LocalBranchSwitcher`，按 UI-07 实现 trigger、搜索、分支排序、当前分支 uncommitted meta 和底部 create action。
3. create-and-checkout dialog 对齐参考项目的自动聚焦、默认建议名、尾随 `/`、已存在分支、空仓库和 pending 状态；成功后刷新 current/source/base。
4. 初次 checkout/create-and-checkout 不自动 stash。收到 `blocked-by-working-tree-changes` 后保存 `LocalBranchContinuation`，按 UI-07 显示冲突路径或总 diff stats。
5. `Commit and switch branch…` 打开共享 `CommitChangesDialog`：
   - 标题 `Commit`。
   - 显示 commit target 和选择摘要。
   - textarea label `Commit message`，placeholder `Commit message (leave blank to generate)…`。
   - checkbox `Include unstaged changes`。
   - 主操作 `Commit`，pending/disabled/错误反馈与参考项目一致。
6. commit 成功后关闭 dialog，并按保存的 continuation 重试 checkout 或 create-and-checkout；重试成功清理 continuation，重试仍阻塞则回到 blocked dialog。取消、生成失败、commit hook 失败或 commit 失败均不重试。
7. 不实现或展示自动 stash、stash rollback、stashRef、“暂存改动后切换”等非参考 UI。

阶段 F 的 gate：UI-07 全部状态有交互与截图证据；无 remote、无 GitHub 登录、无 `gh` 的本地仓库仍能完成 list/search/create/commit/checkout。

## 8. 测试计划

### 8.1 Provider

- `event-mapper.test.ts`
  - live completed turn 生成 patchBatches。
  - 多 cwd 撤销顺序保持。
  - preview 截断不破坏 action patch。
  - in-progress 无 action patch。
- `history-mapper.test.ts`
  - reopen 后与 live 结构一致。
  - command cwd 切换和 fileChange batch 顺序正确。

### 8.2 Main 单元/集成

新增：

- `desktop-app/src/main/localGit/LocalGitService.test.ts`
- `desktop-app/src/main/localGit/reviewSnapshot.test.ts`
- `desktop-app/src/main/localGit/applyPatch.test.ts`
- `desktop-app/src/main/localGit/LocalBranchService.test.ts`
- `desktop-app/src/main/localGit/LocalCommitService.test.ts`
- `desktop-app/src/main/localGit/localGitIpc.test.ts`

用临时仓库覆盖：

1. 非 Git、空仓库、root commit。
2. unstaged、staged、untracked、unmerged。
3. rename、copy、type change、binary、submodule/gitlink。
4. section/file/hunk stage、unstage、revert。
5. staged revert 第二阶段失败。
6. revision drift 和 stale generation。
7. patch 部分应用、skip、conflict。
8. turn 多 batch undo 逆序和 reapply 正序。
9. branch search、create-and-checkout、checkout blocked 和成功 commit 后重试。
10. commit message 显式/自动生成、includeUnstaged、nothing-to-commit、hook/commit failure、提交后再次阻塞。
11. 非法 ref、绝对 patch path、`..`、NUL、工作区外 cwd。

### 8.3 Renderer 组件

新增：

- `LocalGitReviewPanel.test.tsx`
- `ReviewSourcePicker.test.tsx`
- `ConversationChangesRow.test.tsx`
- `ComposerReviewMode.test.tsx`
- `LocalBranchSwitcher.test.tsx`
- `CommitChangesDialog.test.tsx`

扩充：

- `desktop-app/src/renderer/src/App.test.tsx`
- `desktop-app/src/renderer/src/lib/assistantRenderUnits.test.ts`
- `desktop-app/src/renderer/src/lib/codeCommentDirectives.test.ts`

覆盖：

- 所有 source 和状态。
- large diff 只请求单文件。
- stale 时 action disabled。
- first revert confirm / don't ask again。
- complete/partial/error UI。
- Undo ↔ Reapply，仅 success 切换。
- turn card 默认/hover/focus/disabled tooltip。
- Review tab 打开、关闭、状态恢复和会话隔离。
- inline/detached review prompt 和结构化 comments。
- Review Mode choose-target/choose-base/Xcode/error/close 后草稿恢复。
- branch search/create/blocked → commit → retry 与取消/失败路径。
- 键盘焦点、aria-label、loading status。

### 8.4 Electron E2E

新增 `desktop-app/tests/e2e/local-git-review.e2e.ts`，使用真实临时 Git 仓库和真实 renderer → preload → Main IPC：

- P004-E2E-01：打开 unstaged/staged/commit/branch/last-turn。
- P004-E2E-02：文件和 hunk stage / unstage。
- P004-E2E-03：首次确认后 revert，取消不写入。
- P004-E2E-04：turn undo 后 reapply，文件内容回到准确版本。
- P004-E2E-05：后续编辑造成 drift，操作被拒绝且文件保留。
- P004-E2E-06：部分成功和 conflict 路径可见。
- P004-E2E-07：inline Codex Review 走一个新 turn，并渲染 `::code-comment`。
- P004-E2E-08：detached Codex Review 创建独立会话。
- P004-E2E-09：checkout blocked → Commit and switch → commit 成功后重试 checkout。
- P004-E2E-10：commit 取消/失败不重试 checkout，文件和当前分支保持不变。
- P004-E2E-11：没有 remote、GitHub 或 `gh` 时本地功能仍完整。
- P004-E2E-12：非 Git、binary、rename、untracked 和 large diff 状态。
- P004-E2E-13：Changes 行、turn 卡片 Review 和 source picker 都打开同一个右侧 Review tab。
- P004-E2E-14：Composer Review Mode inline/detached 成功后的关闭与导航符合 UI-06。

把 P004 用例登记到 `desktop-app/tests/test-plan-coverage.json`，确保计划条目和自动化证据一一对应。

### 8.5 视觉回归

新增：

- `desktop-app/tests/e2e/local-git-review.visual.e2e.ts`
- `desktop-app/tests/e2e/visual-baselines/p0-04/reference/`
- `desktop-app/tests/e2e/visual-baselines/p0-04/implementation/`
- `desktop-app/tests/e2e/visual-baselines/p0-04/README.md`

截图矩阵至少包含：

1. Changes row：loading、ready、muted。
2. turn card：default、hover/focus、Undo pending、Reapply、disabled tooltip。
3. Review tab：五种 source、commit submenu、branch picker、files shown/hidden、split/unified、options menu。
4. Review state：loading、refreshing、empty、error、large diff、binary、conflicted、stale。
5. mutation：file/hunk action、partial toast、Revert changes dialog。
6. Composer Review Mode：choose-target、choose-base、loading/error/retry、Xcode license、submitting。
7. branch：popover、search/loading/error、create dialog validation、blocked dialog、Commit dialog。

视觉测试先断言 UI-09 的视口/主题/字体前置条件，再用 Playwright screenshot diff 校验；基线更新必须同时附参考项目截图，不能只接受本项目新截图。

## 9. 验证命令

按依赖顺序运行：

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test
npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
npm --prefix desktop-app test
npm --prefix desktop-app run test:plan-coverage
npm --prefix desktop-app run test:e2e -- --grep "P004" --reporter=line
```

专项 E2E 全绿后，再运行完整：

```bash
npm --prefix desktop-app run test:e2e -- --reporter=line
```

若完整 E2E 因环境条件无法运行，最终报告必须写明未运行原因，并至少提供 provider、Main 临时仓库集成、Renderer 组件和 P004 专项 E2E 的新鲜结果。

## 10. 风险与缓解

| 风险                                | 缓解                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| preview 被截断后误用于恢复          | 展示 diff 与 action patch 分离；in-progress、action patch 不完整或超限时禁用写入  |
| Renderer 伪造 cwd 或 patch          | Main 从 conversation/thread 解析可信 cwd，校验 realpath、Git root 和 patch 内路径 |
| 用户在查看后继续修改文件            | snapshotGeneration + per-file revision；写前重新读取，不一致即拒绝                |
| staged revert 只完成一半            | 两阶段结果保留 partial-success 和精确路径，不回滚已成功的第一阶段并伪装成功       |
| 多 cwd turn 撤销顺序错误            | Provider 保留 batch 顺序；undo reverse，reapply forward，并用测试锁定             |
| branch checkout 丢失未提交改动      | checkout 阻塞即停止；必须完成可验证 commit 后才重试；取消/失败绝不切分支          |
| UI 功能等价但不像参考项目           | UI-01 至 UI-09 锁定入口/层级/状态；参考截图与实现截图成对保存并执行像素差异门禁   |
| Commit dialog 绕过 App Server 生成  | 显式 message 不调用模型；留空生成只走现有 App Server provider，不新增直连客户端   |
| binary / gitlink 被文本 patch 破坏  | 快照标记专门类型，使用 binary patch；gitlink 额外校验 SHA 和子仓库干净状态        |
| Git watcher 不可靠                  | watch 只做失效提示；任何写操作仍以即时 revision 校验为准，并提供手动刷新/轮询降级 |
| 误把 Codex Review 做进 review/start | E2E 断言普通 turn 路径；provider API 不新增 review/start                          |

## 11. 交付顺序与停止条件

交付顺序固定为 A → B → C → D → E → F。B 依赖 A 的 turn patch 合同，D 依赖 B/C，E 依赖 D 的入口和现有聊天 runtime，F 依赖 C 的分支服务。

P0-04 只有在以下条件全部满足时才能从“部分实现”改为“已完成”：

1. 所有 UI-01 至 UI-09、AC-01 至 AC-08 都有自动化或视觉基线证据。
2. 静态“撤销/审核”占位已删除。
3. live 与历史 turn 都能安全 Undo/Reapply。
4. Git 面板所有写操作都有 revision 保护和 partial/error 结果。
5. Changes、turn card 和 source picker 打开的是同一个右侧 Review tab。
6. Codex Review 以 Composer Review Mode 呈现，并只走现有普通 turn 链路。
7. 分支阻塞流程是 Commit and switch，不存在自动 stash UI。
8. 本地分支能力不依赖 GitHub 或 remote。
9. 关键截图满足 UI-09 阈值，且不存在通过 mask/隐藏组件规避的差异。
10. Provider、desktop lint/typecheck/test、P004 E2E 全部通过，或验证缺口被明确记录。
