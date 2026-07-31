# GitManager 参考项目最终差距修复计划

## 1. 结论

当前开发**尚未完成** `docs/plan.md` 对 GitManager 参考一致性的全部要求。

已经完成且应保留的部分包括：

- Main 进程中的统一 `GitManager`、`RepoRepository`、`WorktreeRepository`、`GitReviewSnapshot` 四层对象。
- `host.id + canonical root/commonDir` 的仓库身份与对象复用。
- 24 小时稳定元数据、1 秒权限错误缓存、Review generation、临时 object store。
- 普通 index、split-index、独立 git dir、linked worktree 的主要路径解析和复制逻辑。
- Renderer 统一 `GitRepositoryProvider`、本地与假 SSH 远程 Git UI 主链路。
- turn patch 的可信仓库校验、batch 顺序、Undo 逆序与失败短路。

仍然阻止“完成”结论的核心问题是：

1. 未跟踪文件缓存没有参考项目的独立 generation，失效中的并发读取可能返回旧结果。
2. 当前 watcher 只比较 `HEAD / index / worktree` 三个粗粒度指纹，同时变化时只上报一个原因，也没有路径级变更、config/refs/topology 类型和断线重建。
3. 缓存类已经存在，但 Review、branch、summary 等生产读取缺少命令次数证据，部分路径级失效没有真实生产消费者。
4. 临时 index 主要由 mock 和只读集成测试证明，尚未覆盖“在临时 index 内执行写入且真实 index 不变”的完整矩阵。
5. 子目录 turn patch 主要是 mock 级证明；本地真实仓库、远程 POSIX、越界拒绝和多 batch 组合尚未形成验收矩阵。
6. 远程 Git 初次连接失败可以 Retry，但连接成功后 transport 崩溃时，`CodexCommandClient.connected` 不会复位，现有 Retry 不能保证建立新连接。
7. 本地 E2E 没有通过 UI 创建并 checkout 分支；远程 E2E 没有断线恢复；turn patch E2E 只覆盖仓库根目录。
8. 最近一次 `test:plan-coverage` 有 5 个失败；未取得同环境基线前，不能把它们直接认定为无关，也不能宣称最终门禁全绿。

因此修复策略不是重写现有 GitManager，而是保留已对齐的骨架，补齐参考项目真正用于保证一致性的缓存、监听、恢复和验收闭环。

## 2. 参考项目如何解决

参考目录：

- `reference-projects/codex-electron-26.707.72221-beautified/.vite/build/worker.js`
- `reference-projects/codex-electron-26.707.72221-beautified/.vite/build/src-HagpvBpE.js`
- `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/`

### 2.1 四层对象各自只承担一层职责

| 参考对象 | 参考位置 | 解决的问题 | 本项目决策 |
| --- | --- | --- | --- |
| `h3` / RepoRepository | `src-HagpvBpE.js:53144-53155` | common dir 与 origin；origin 24 小时去重缓存 | 当前实现已基本对齐，不重写 |
| `y3` / GitReviewSnapshot | `src-HagpvBpE.js:53173-53276` | 固定 generation 的读取、临时 index/object store、过期检测与延迟清理 | 保留现有实现，补生产查询 key 和真实写入验证 |
| `b3` / WorktreeRepository | `src-HagpvBpE.js:53278-53333` | worktree 查询缓存、config、review generation、按原因失效 | 补独立 untracked generation 和真正的生产缓存消费者 |
| `S3` / GitManager | `src-HagpvBpE.js:53335-53502` | 按 host/root 复用对象，统一生命周期和跨 worktree 失效 | 当前对象复用保留；修正 untracked API 语义 |

### 2.2 缓存不是一个总开关

参考实现把 Git 读取分成不同失效域：

- config；
- HEAD；
- index；
- remote refs；
- working tree；
- short-lived；
- all-untracked。

短期缓存的 metadata 和路径匹配位于：

- `worker.js:61497-61539`
- `src-HagpvBpE.js:49877-49927`

路径失效采用父路径/子路径双向匹配，`.gitmodules` 等特殊文件可以触发更宽失效。

未跟踪文件则有**独立 generation、独立 TTL 和独立并发保护**：

- `worker.js:62112-62231`

它的关键规则是：

1. 普通 TTL 10 秒；一次查询超过 7 秒后，将该结果 TTL 放宽到 20 秒。
2. 发起读取时记录 generation；读取完成时若 generation 已变化，旧结果不能重新成为有效数据。
3. 文件变化不超过 64 个路径时，只对这些路径执行
   `git ls-files --stage --others --exclude-standard -z -- <paths>`，
   再与已缓存的全量 untracked 列表合并。
4. 没有全量缓存、没有可靠路径、路径超过 64 个、或 `.gitignore` 变化时，退化为全量失效。

当前 `GitReadCache.fetch()` 会优先复用已存在的 pending Promise；只把 entry 标成 invalidated 并不能阻止失效前的 in-flight untracked 结果返回。因此必须补 generation，而不是只补测试。

### 2.3 watcher 上报“发生了哪些变化”，不是只给一个总指纹

参考 watcher 位于：

- `worker.js:70837-71145`
- 消费与缓存失效位于 `worker.js:72382-72425`

它监听并区分七类变化：

- `config`
- `head`
- `index`
- `remote-refs`
- `synced-branch`
- `worktree-topology`
- `working-tree`

具体观察对象包含 `HEAD`、common HEAD、index、`FETCH_HEAD`、`packed-refs`、heads/remotes refs、config、exclude、attributes、worktree config、worktree topology 和普通文件。

参考实现还有三项当前版本没有的行为：

1. 每种 change type 独立 debounce，同一轮里多个变化不会因 `if/else` 丢失。
2. working-tree 事件携带归一化路径；rename 同时记录父目录；去除被父目录包含的子路径；超过 64 个时折叠到顶层，仍不可靠则退化为全量。
3. watcher start/close/error 后以 1 秒节奏重建 session。

本项目不修改 Codex app-server，也不能假设远程端有项目私有 watcher 协议。因此采用“**本地文件监听 + 通用 Git 指纹轮询 fallback**”达到可观察行为一致：

- 本地优先文件监听，失败自动回到轮询并重试监听。
- 远程继续使用 `CodexCommandClient` 执行只读 Git 指纹查询。
- 两种后端统一产出相同的 typed change event。

### 2.4 临时 index 会复制与主 index 配套的 shared index

参考实现：

- Windows/路径包含关系：`src-HagpvBpE.js:50435-50449`
- index 缺失容错和临时复制：`:50524-50553`
- git-dir、git-path、fingerprint、shared-index：`:50554-50631`
- 临时目录、`GIT_INDEX_FILE`、finally 清理：`:53157-53165`

它不是只验证“能够读取 status”，而是确保：

1. `rev-parse --git-path index` 按 git dir 语义解析。
2. split-index 时把 shared index 一并复制，且保留 basename 关系。
3. `ENOENT / ENOTDIR` 表示空 index 场景，可继续；其他错误上抛。
4. 所有操作只写临时 index，finally 后真实 index 完全不变。

### 2.5 turn patch 先明确路径坐标系

参考 UI 在：

- `webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:61171-61282`

它把每个 batch 的 cwd 和 Git root 一起交给转换函数，将 patch 统一为 root-relative，再在 root 执行；Undo 逆序、Reapply 原序，首个失败后停止。

当前 provider 的合同是 cwd-relative patch，Main 已在：

- `desktop-app/src/main/localGit/LocalGitService.ts:302-343,412-430`
- `desktop-app/src/main/localGit/applyPatch.ts:16-53`

通过 `git apply --directory=<repo-relative-cwd>` 保留该坐标系，并重新验证 cwd、root 和嵌套仓库。该实现与参考行为等价，不应仅为了形式相同而改写 provider；需要补真实仓库和远程证据。

### 2.6 Retry 必须重建失效的传输状态

参考 Git UI 明确提供无法加载后的 Retry：

- `webview/assets/review-mode-content-CRO4r5jd.js:506`
- `webview/assets/git-branch-switcher-DHRrTd6u.js:497`

当前 Renderer 的 Retry 会清理目标解析缓存：

- `desktop-app/src/renderer/src/components/local-git-review/GitRepositoryProvider.tsx:31-86`

但 provider command client 在：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/command-client.ts:83-101`

一旦首次连接成功，就将 `connected` 保持为 `true`；transport 意外关闭只会让活动请求失败，没有把 `connected / connectPromise` 复位。底层 `AppServerClient` 已提供：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-client.ts:275-287`

的 `onTransportTermination()`。修复应利用现有 hook，让 command client 在异常终止后进入可重新连接状态，而不是让 UI 的 Retry 只重跑一次注定失败的请求。

## 3. Requirements Summary

### 3.1 目标

在不修改 `codex/codex-rs/app-server/`、不新增第三方依赖、不新增旁路 LLM/Git 执行路径的前提下，使本项目对参考 GitManager 的可观察行为完整对齐：

- 缓存命中、失效和失效期间并发读取均正确。
- 外部 Git/文件变化不会漏报关键类型，监听失败后能恢复。
- 本地与远程 Git 使用相同 repository target 和 WorktreeRepository。
- 临时 index 在所有支持的仓库形态下不会污染真实 index。
- turn patch 在根目录和子目录、本地和远程都遵守同一安全规则。
- 用户能通过 UI 完成创建/切换/Review/stage/unstage/commit，并能从远程断线恢复。

### 3.2 范围

允许修改：

- `desktop-app/src/main/localGit/`
- `desktop-app/src/main/index.ts`
- `desktop-app/src/shared/localGitApi.ts`
- `desktop-app/src/preload/`
- `desktop-app/src/renderer/src/components/local-git-review/`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/command-client.ts`
- 对应 provider、Main、Renderer、E2E 测试和 `tests/test-plan-coverage.json`

明确不修改：

- `codex/codex-rs/app-server/`
- admin backend
- 模型调用链路
- package dependency manifests，除非只是现有脚本的测试登记且不引入依赖
- 当前已通过的 Git repository target 安全边界

### 3.3 实施原则

- 先用失败测试锁定每个缺口，再修改生产代码。
- 优先扩展现有 `GitReadCache`、`WorktreeRepository`、`LocalGitWatchBroker`，不再建立第二套 GitManager。
- 只追求参考项目的行为一致，不复制混淆后的命名和产品内部依赖。
- watcher 的本地实现可以使用 Node 文件能力；Renderer 仍只能通过 preload 白名单访问。
- 远程 watcher 使用通用 command client 轮询 fallback，不向 app-server 添加协议。

## 4. Testable Acceptance Criteria

### AC-01：未跟踪文件缓存独立且无并发陈旧回流

- `WorktreeRepository` 有独立的 untracked generation，不通过 short-lived generation 代替。
- 同 generation 的并发全量 untracked 查询只执行一条 Git 命令。
- 查询进行中触发 untracked invalidation 后，旧 Promise 的结果不能作为失效后的返回值或重新写回有效缓存。
- Review、summary 和 workspace state 共用一个 canonical all-untracked 缓存 key，不再分别使用 `[] / ['summary'] / ['summary-z']`。
- 路径数 `1..64` 且存在全量缓存时可局部 reconcile；`.gitignore`、空路径、不可靠路径或超过 64 路径时全量失效。
- untracked invalidation 与 short-lived invalidation 可分别测试，互不隐式替代。

### AC-02：监听类型完整、同时变化不丢失、失败可恢复

- shared event 能表达 `config/head/index/remote-refs/synced-branch/worktree-topology/working-tree`，working-tree 可选 `changedPaths`。
- 同一采样周期 HEAD、index、working tree 同时变化时，三类事件或一个包含三类的等价事件都被处理，不能只保留优先级最高的一类。
- config、packed refs、remote refs、worktree topology 的变化有单测。
- working-tree 路径归一化、父子折叠、rename 父目录、64 路径上限和 `.gitignore` 全量退化有单测。
- 本地 watcher close/error 后自动回到轮询，并重试建立监听；订阅释放后关闭 watcher/timer。
- 远程不依赖本地 `fs.watch`，轮询仍能产生相同 typed event。

### AC-03：生产读取真实消费缓存

- Review 重复读取、branch summary 重复读取、workspace summary 重复读取均有“第二次 Git 命令数不增加”的断言。
- 相关 reason/mutation 后下一次读取会增加命令数并取得新数据。
- 不相关 host、root、reason 和路径不会误清对应缓存。
- Review 的实际查询 key 包含 `host/root/type/'review'/generation`。
- 已 retire 的 snapshot 不会把完成较晚的旧结果发布给调用方。
- 若某类读取没有可证明的路径级消费者，不得在文档中宣称已实现路径级精确失效；应使用 reason 级失效并明确范围。

### AC-04：临时 index 读写矩阵完整

使用真实临时 Git 仓库覆盖：

- 普通 index；
- 缺失 index；
- split-index；
- `--separate-git-dir`；
- linked worktree。

每种适用场景在 `withTempIndex()` 内至少执行：

1. 修改文件；
2. `git add`；
3. `git diff --cached` 验证临时 staged 内容；
4. 退出后验证真实 `git diff --cached` 和真实 index fingerprint 未变化。

另外覆盖：

- `ENOENT / ENOTDIR` 容错；
- shared-index fingerprint 变化后重新解析；
- Windows `GIT_INDEX_FILE`/Git path 转换；
- remote POSIX 的 stat/copy/remove argv；
- 操作失败和 abort 时仍清理临时目录。

### AC-05：turn patch 坐标、安全和顺序完整

- 本地真实仓库：root cwd 与子目录 cwd 的 Undo/Reapply 都成功。
- 远程 POSIX fixture：子目录 patch 成功，命令 cwd、`--directory` 和 writable roots 正确。
- cwd 在仓库外、同 host 的另一个仓库、嵌套仓库 root 不匹配、绝对 patch path、`..` 逃逸均被拒绝。
- 多 batch Reapply 保持原序，Undo 逆序。
- 首个失败后停止；后续 batch 不执行，也不产生成功失效。
- 每个成功 batch 都推进对应 WorktreeRepository generation；失败 batch 不伪造成功状态。

### AC-06：UI 与恢复 E2E 完整

- 本地 E2E 必须通过分支弹窗的 Create and checkout UI 创建分支，不能用测试脚本预先 `git branch` 代替。
- 本地和假 SSH 远程均通过 UI 覆盖分支列表、创建、切换、Review、stage、unstage、commit。
- 远程 transport 在一次成功使用后被 fixture 主动关闭；界面显示可重试状态；点击 Retry 后创建新连接并恢复分支/Review 数据。
- turn patch E2E 至少有一个 batch cwd 是仓库子目录。
- 每个新增 E2E 场景在 `desktop-app/tests/test-plan-coverage.json` 有独立 ID，测试标题携带该 ID。

### AC-07：最终门禁和边界

- provider `qa` 全绿。
- desktop lint、typecheck、unit、local Git E2E、plan coverage 全绿。
- 当前已知 5 个 plan coverage 失败必须：
  - 在同一环境的干净基线也失败，并登记为明确的既有失败；或
  - 被修复到通过。
- `git diff --check` 无空白错误。
- `codex/codex-rs/app-server/` 无 diff。
- 没有新增依赖，没有 renderer 直连 Node/Electron/Git。

## 5. Implementation Steps

### Phase 0：冻结基线与先写失败测试

文件：

- `desktop-app/src/main/localGit/GitManager.test.ts`
- `desktop-app/src/main/localGit/GitReadCache.test.ts`
- `desktop-app/src/main/localGit/LocalGitWatchBroker.test.ts`
- `desktop-app/src/main/localGit/reviewSnapshot.test.ts`
- `desktop-app/src/main/localGit/LocalGitService.test.ts`
- `desktop-app/src/main/localGit/LocalBranchService.test.ts`
- `desktop-app/src/main/localGit/GitHostRegistry.test.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/command-client.test.ts`

动作：

1. 先运行并保存当前定向测试和 `test:plan-coverage` 输出。
2. 在相同 Node、Git、环境变量下对干净基线运行 plan coverage，确认现有 5 个失败是否由本分支引入。
3. 按 AC-01～AC-06 先补会失败的单元/集成测试。
4. 每个测试只断言一个对外合同：命令次数、generation、事件、清理、安全拒绝或 UI 恢复。

退出条件：

- 每个待修缺口至少有一个在修复前稳定失败的测试。
- 既有 plan coverage 失败有可复查的同环境基线证据。

### Phase 1：补独立 untracked cache 和 canonical 查询

文件：

- `desktop-app/src/main/localGit/GitManager.ts:229-375,377-566`
- `desktop-app/src/main/localGit/GitReadCache.ts:55-88`
- `desktop-app/src/main/localGit/reviewSnapshot.ts:316-330`
- `desktop-app/src/main/localGit/LocalGitService.ts:483-536`
- 对应测试

动作：

1. 在 `WorktreeRepository` 增加独立 `untrackedGeneration`、canonical cache key 和读取方法。
2. 读取开始时捕获 generation；读取完成后再次比较。若已变化，丢弃旧结果并重新读取当前 generation。
3. 将 Review 与 summary 中三套 `all-untracked-paths` key 收口到上述方法。
4. 在 `WorktreeRepository` 增加路径 reconcile：
   - 缓存存在且路径可靠、数量不超过 64 时定向查询；
   - 合并新增与已删除的 untracked path；
   - `.gitignore` 或不可靠输入全量失效。
5. 将 `GitManager.invalidateUntrackedPathsCache()` 的第一个参数改回 reference 语义：repository root selector 或 `null`；changed paths 只属于 repository-change 事件，不再被这个 API 接收后忽略。
6. foreground 恢复和 turnComplete 分别调用 untracked 与 short-lived 失效。

退出条件：

- AC-01 全部通过。
- `rg "all-untracked-paths" desktop-app/src/main/localGit` 只保留一个生产 key 定义和必要测试。
- 不存在 `void paths` 形式的无效 API。

### Phase 2：把 watcher 改成 typed event，并建立恢复机制

文件：

- `desktop-app/src/shared/localGitApi.ts:406-413`
- `desktop-app/src/main/localGit/LocalGitWatchBroker.ts:4-183`
- `desktop-app/src/main/localGit/LocalGitService.ts:356-379`
- `desktop-app/src/main/localGit/GitHostRegistry.ts:86-315`
- `desktop-app/src/main/index.ts:511-525`
- 新增或扩展 `desktop-app/src/main/localGit/LocalGitRepoWatcher.ts`
- 对应 Main/preload/Renderer 测试

动作：

1. 扩展 shared change event，使用稳定的 change type 联合类型和可选 `changedPaths`；保持 IPC payload 可验证。
2. 将 broker 的 `changeReason()` 从优先级 `if/else` 改为返回全部变化。
3. 扩展 polling fingerprint：config、HEAD、index、local/remote refs、synced branch、worktree topology、working tree。
4. 本地新增受控文件 watcher session：
   - 监听参考集合中的 Git metadata 与 working tree；
   - 每类事件独立 debounce；
   - 路径归一化、父子折叠和 64 路径上限；
   - close/error 后切换到 polling，并以有界退避重建；
   - dispose 后移除所有 listener/timer。
5. 远程 host 不实现本地文件 watcher，继续走相同 fingerprint polling。
6. Main 收到每一种事件后调用对应 `invalidateGitReadCachesForRepoChange(type, paths)`；config/index 另外使 untracked cache 失效，working-tree 先执行路径 reconcile。
7. 空的定向 reconcile 事件不刷新 UI；退化事件发送无路径的全量刷新。

退出条件：

- AC-02 全部通过。
- 同一 poll 中多个 fingerprint 变化都有独立失效断言。
- watcher 故障不会停止后续刷新。

### Phase 3：让生产读取使用 snapshot query key，并用命令数证明

文件：

- `desktop-app/src/main/localGit/GitManager.ts:96-227`
- `desktop-app/src/main/localGit/reviewSnapshot.ts:96-104,360-401`
- `desktop-app/src/main/localGit/LocalGitService.ts:113-127`
- `desktop-app/src/main/localGit/LocalBranchService.ts`
- 对应测试

动作：

1. 让 `runReviewRead()` 接收已捕获的 `GitReviewSnapshot`，统一使用 snapshot 的 signal、env、generation 和 `queryKey()`。
2. 整个 Review 请求只捕获一次 snapshot，避免同一响应混用两代数据。
3. 按生产含义标注 config/head/index/remote-refs/working-tree/short-lived metadata。
4. 将 workspace state hash 的重复裸 Git 读取纳入明确的 cache key，或者复用已经缓存的组成部分。
5. 为 Review、branch summary、workspace summary 增加命令计数测试：
   - 首次读取执行；
   - 第二次命中；
   - 相关失效后重新执行；
   - 不相关 host/root/reason/path 不重新执行。
6. 只有存在真实 path metadata 消费者的查询才使用路径级失效；其余保持 reason 级，避免“看起来精确、实际总失效”。

退出条件：

- AC-03 全部通过。
- 生产代码中的 review 查询 key 可直接证明包含 snapshot generation。

### Phase 4：补临时 index 的真实读写矩阵

文件：

- `desktop-app/src/main/localGit/GitManager.ts:621-736`
- `desktop-app/src/main/localGit/GitManager.test.ts:361-477`
- 新增或扩展 `desktop-app/src/main/localGit/GitManager.integration.test.ts`
- `desktop-app/src/main/localGit/GitHostRegistry.test.ts`

动作：

1. 建立共享 Git test helper，创建普通、split-index、separate git dir、linked worktree 仓库。
2. 每个场景在进入前记录真实 index fingerprint 和 staged diff。
3. 在 `withTempIndex()` 内修改、add、读取 cached diff，退出后重新读取真实 staged diff/fingerprint。
4. 增加 missing index 的真实仓库用例，以及 mock 的 `ENOTDIR` 和非容错错误用例。
5. 模拟 shared-index fingerprint 变化，断言缓存重新执行 `--shared-index-path`。
6. 对 Windows path hook 做纯函数测试；对 remote POSIX 验证 argv、cwd、目标 basename、owned temp dir 和 finally remove。
7. operation throw 与 AbortSignal 两条路径都验证清理。

退出条件：

- AC-04 全部通过。
- 不再以单纯 `git status --short` 成功作为临时 index 完成证据。

### Phase 5：补 turn patch 真实仓库与远程矩阵

文件：

- `desktop-app/src/main/localGit/LocalGitService.ts:302-343,412-430`
- `desktop-app/src/main/localGit/applyPatch.ts:16-53`
- `desktop-app/src/main/localGit/LocalGitService.test.ts:114-200`
- 新增或扩展 `desktop-app/src/main/localGit/LocalGitService.integration.test.ts`
- `desktop-app/tests/e2e/local-git-review.e2e.ts:356-430`

动作：

1. 保留 provider 的 cwd-relative patch 合同和 Main 的 `--directory` 适配。
2. 使用真实本地仓库验证 root/subdir Undo/Reapply。
3. 使用 fake SSH/app-server fixture 验证远程子目录 patch 的 cwd、sandbox writable roots 和结果。
4. 增加仓库外 cwd、同 host 不同仓库、嵌套仓库、绝对路径、`..` 路径拒绝。
5. 增加三 batch 测试，分别证明 Reapply 原序、Undo 逆序和中间失败短路。
6. 记录每个成功 batch 的 generation，证明失败及未执行 batch 没有被当作成功。

退出条件：

- AC-05 全部通过。
- 不修改 turn-diff 的路径语义，除非真实测试证明当前合同本身无法满足安全/正确性要求。

### Phase 6：修复远程 command transport 恢复

文件：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/command-client.ts:16-28,59-101,229-264`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-client.ts:275-287`（只消费现有 hook，通常无需修改）
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/command-client.test.ts:151-184`
- `desktop-app/src/main/localGit/GitHostRegistry.ts:133-209`
- `desktop-app/src/main/localGit/GitHostRegistry.test.ts`

动作：

1. 在 command client 的 logical client interface 暴露可选 transport termination 订阅。
2. 连接建立时注册 termination handler；异常终止后：
   - `connected = false`
   - `connectPromise = undefined`
   - 清理旧 server info 和 listener
   - disconnect 旧 logical client 的残留资源
3. 因默认 `AppServerClient`/transport 实例已经终止，command client 应保存 client factory，在下一次 `connect()` 创建新的 logical client；不能继续复用已死亡的实例。
4. 明确区分：
   - 初始化失败：当前调用失败，下一次可重试；
   - 活动命令期间断线：当前调用只失败一次，下一次 exec 重连；
   - 用户 shutdown：永久禁止重连。
5. `RemoteGitHost` 在 transport termination 错误后清理 `availabilityPromise` 和依赖该连接的 common-dir 缓存，使 `GitRepositoryProvider.retry()` 能重新验证远程端。
6. 增加断线时多个并发 exec 的测试，确保只建立一个新连接。

退出条件：

- provider command-client 测试证明“成功连接 → transport close → 下一次 exec 重新 initialize 并成功”。
- registry 测试证明远程可用性不会永久缓存已死亡连接。

### Phase 7：补齐 UI/E2E 和计划登记

文件：

- `desktop-app/tests/e2e/local-git-review.e2e.ts`
- `desktop-app/tests/e2e/support/fake-ssh.mjs`
- `desktop-app/tests/e2e/support/remote-git-app-server.mjs`
- `desktop-app/tests/test-plan-coverage.json`
- 必要时 `desktop-app/src/renderer/src/components/local-git-review/GitRepositoryProvider.test.tsx`
- 必要时 `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.test.tsx`

动作：

1. 把本地分支创建测试从 fixture 预创建改为 UI 的 Create and checkout。
2. 保留现有远程 UI 全链路，并增加远程 transport 主动关闭控制。
3. 断线后等待 error/unavailable UI，点击 Retry，断言新连接、目标恢复和数据刷新。
4. 增加子目录 turn patch E2E。
5. 为三类新增验收分配独立计划 ID：
   - local UI create-and-checkout；
   - remote disconnect-and-retry；
   - subdirectory turn patch。
6. `test-plan-coverage.json` 使用真实 fixture 路径 `desktop-app/tests/e2e/support/`，不登记不存在的 `tests/fixtures/`。

退出条件：

- AC-06 全部通过。
- plan coverage 能逐项定位测试，而不是由一个大测试泛化承诺多个行为。

### Phase 8：最终门禁与完成判定

按以下顺序执行：

1. provider 定向测试与 `qa`。
2. Main/Renderer 定向单元与集成测试。
3. desktop lint、typecheck、全量 unit。
4. local Git E2E。
5. plan coverage。
6. staged diff 和架构边界检查。

仅当 AC-01～AC-07 全部有新鲜证据时，才把
`git-manager-reference-parity-completion.md` 的状态更新为完成。旧计划中的“当前基线”不得继续作为事实来源，应以本计划执行时的新输出替换。

## 6. Risks and Mitigations

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `fs.watch` 在 macOS/Linux/Windows 行为不同 | 漏事件或重复事件 | 本地 watcher 只做低延迟入口；typed fingerprint polling 作为正确性 fallback；事件去重但不吞类型 |
| untracked reconcile 与全量读取并发 | 旧列表覆盖新列表 | 独立 generation；完成时二次检查；generation 变化时丢弃旧结果 |
| 为追求路径精度引入复杂而无消费者的 metadata | 代码复杂但没有收益 | 只有生产命令次数测试证明收益时启用路径级缓存；否则 reason 级失效 |
| transport close 后复用已终止 logical client | Retry 永久失败 | command client 保存 factory并创建新 client；shutdown 与异常终止状态分离 |
| 远程断线 E2E 时序不稳定 | 测试偶发失败 | fixture 提供确定的“下一条命令后关闭/等待新 initialize”协议，测试等待可观察状态，不使用固定 sleep |
| split-index 测试依赖 Git 版本/配置 | CI 差异 | 测试先确认 `git update-index --split-index` 成功；失败输出明确环境能力，不静默跳过核心门禁 |
| 大量已暂存修改与新修复交叠 | 误覆盖用户改动 | 每个 Phase 小范围修改；开始和结束记录 `git status --short`；不 reset、不 checkout 用户文件 |
| 既有 plan coverage 失败混入完成判断 | 错误归因或虚假全绿 | 同环境干净基线对照；每个失败登记来源、所有者和是否由本次变更触发 |
| watcher 加入 config/ref 轮询增加 Git 命令量 | 远程性能下降 | 一个采样合并查询、订阅存在时才运行、沿用缓存和退避；用命令次数测试设上限 |

## 7. Verification Steps

### 7.1 Provider

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test -- tests/command-client.test.ts
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run qa
```

### 7.2 Main 定向测试

```bash
npm --prefix desktop-app test -- src/main/localGit/GitReadCache.test.ts
npm --prefix desktop-app test -- src/main/localGit/GitManager.test.ts
npm --prefix desktop-app test -- src/main/localGit/GitManager.integration.test.ts
npm --prefix desktop-app test -- src/main/localGit/LocalGitWatchBroker.test.ts
npm --prefix desktop-app test -- src/main/localGit/reviewSnapshot.test.ts
npm --prefix desktop-app test -- src/main/localGit/LocalGitService.test.ts
npm --prefix desktop-app test -- src/main/localGit/LocalGitService.integration.test.ts
npm --prefix desktop-app test -- src/main/localGit/LocalBranchService.test.ts
npm --prefix desktop-app test -- src/main/localGit/GitHostRegistry.test.ts
```

若最终没有拆出某个 `*.integration.test.ts`，对应真实仓库场景必须存在于同模块测试文件中，并从命令列表删除不存在的路径，不能让验证命令以“未找到测试”假通过。

### 7.3 Desktop 全量

```bash
npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
npm --prefix desktop-app test
```

### 7.4 E2E 与计划覆盖

```bash
npm --prefix desktop-app run test:e2e -- --reporter=line tests/e2e/local-git-review.e2e.ts
npm --prefix desktop-app run test:plan-coverage
```

### 7.5 边界与 diff

```bash
git diff --check
git diff -- codex/codex-rs/app-server
git diff -- desktop-app/package.json desktop-app/package-lock.json desktop-app/pnpm-lock.yaml
git status --short
```

完成证据必须包含：

- 每条命令的退出码和测试数量；
- 本地、远程、子目录三个 E2E 场景的独立测试标题；
- plan coverage 的同环境基线比较；
- `codex/codex-rs/app-server/` 无修改；
- 没有新增依赖。

## 8. 推荐执行顺序

按风险和依赖关系执行：

1. Phase 0 基线与失败测试；
2. Phase 1 untracked cache；
3. Phase 3 生产缓存消费；
4. Phase 2 watcher typed event 与恢复；
5. Phase 4 临时 index 真实矩阵；
6. Phase 5 子目录 turn patch；
7. Phase 6 远程 transport 重连；
8. Phase 7 UI/E2E；
9. Phase 8 全部门禁。

其中 Phase 1 与 Phase 3 必须先完成，否则 watcher 即使更精确，也只会触发当前粗粒度或没有消费者的失效逻辑。
