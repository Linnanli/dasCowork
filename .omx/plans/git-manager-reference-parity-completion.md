# GitManager 参考实现完整复刻与剩余验收补完计划

## 执行结果（2026-07-29）

本计划已完成；下方“历史基线”只保留启动时的背景，不再作为当前事实来源。本次最终差距修复的有效验证结果为：

- 未跟踪文件使用独立 generation、10/20 秒 TTL、并发去重和失效期间重试；workspace summary、Review 读取与 all-untracked 使用 canonical cache，并具备命令次数断言。
- watcher 以 typed multi-change event 上报 config、HEAD、index、remote refs、synced branch、worktree topology、working tree 及受限路径，并在本地 watcher 出错后持续轮询、重建。
- 临时 index 覆盖普通、缺失、split-index、独立 git dir 和 linked worktree；turn patch 覆盖子目录、安全拒绝、批次顺序和 generation 失效。
- 远程 command transport 意外断开会清除连接状态和宿主缓存，Retry 可建立新连接。
- 新增的 P004-E2E-16、P004-E2E-17、P004-E2E-18 与完整 `local-git-review.e2e.ts` 均已在同一环境通过（17 passed）。
- 已通过：provider command client 9 项、local Git 定向单元/集成测试 40 项、Node typecheck、plan coverage validator 33 项；未修改 `codex/codex-rs/app-server/`。

## 1. 目标与完成定义

本计划只补完 `docs/plan.md` 尚未完成的部分，不重写已经落地的统一 repository target、Main 单例装配、`desktopApp.git`、远程 command client 和 Renderer `GitRepositoryProvider`。

最终结果必须同时满足：

1. `RepoRepository`、`GitReviewSnapshot`、`WorktreeRepository`、`GitManager` 按参考项目 `h3 / y3 / b3 / S3` 逐方法复刻控制流程和缓存规则，仅替换本项目不存在的 Host、查询缓存和 Electron 运行时依赖。
2. Git 读取确实经过复刻后的缓存层，不能只保留没有消费者的 generation 计数。
3. 临时 index 支持普通 index、split-index、独立 git dir、worktree 和本地/远程 POSIX 路径。
4. turn patch 从仓库子目录产生时，Undo/Reapply 在原 batch cwd 下应用，但仍由 canonical `WorktreeRepository` 负责安全校验和缓存失效。
5. 本地和假 SSH 远程 E2E 都通过 UI 覆盖分支列表、创建、切换、Review、暂存和提交。
6. 所有计划列出的质量门禁通过，暂存 diff 没有空白错误，且 `codex/codex-rs/app-server/` 没有改动。

计划依据：

- 总体复刻要求：`docs/plan.md:5-9`
- Main、生命周期与统一 repository 要求：`docs/plan.md:13-27`
- 本地/远程执行要求：`docs/plan.md:29-47`
- UI 与统一 target 要求：`docs/plan.md:49-65`
- 测试和最终验收要求：`docs/plan.md:67-74`

## 2. 历史基线与已修复缺口

> 以下表格记录计划启动时的缺口；当前完成状态以“执行结果（2026-07-29）”为准。

| 范围 | 当前状态 | 补完依据 |
| --- | --- | --- |
| Main 单例与 target 安全 | 已完成，保留并做回归测试 | `desktop-app/src/main/index.ts:496-564`、`desktop-app/src/main/localGit/GitRepositoryTargetResolver.ts:27-95` |
| Renderer 统一 Git target | 已完成，补远程交互测试 | `desktop-app/src/renderer/src/components/local-git-review/GitRepositoryProvider.tsx:31-86` |
| `RepoRepository` | 缺少 24 小时 origin memoization | 当前 `desktop-app/src/main/localGit/GitManager.ts:52-60`；参考 `.vite/build/src-HagpvBpE.js:53133-53155` |
| `GitReviewSnapshot` | 缺少 `gitDiff()`、`queryKey()`；临时 index 只复制主 index | 当前 `GitManager.ts:71-193`；参考 `.vite/build/src-HagpvBpE.js:53173-53276` |
| `WorktreeRepository` | 缺 config API 和真实查询缓存，失效方法只递增数字 | 当前 `GitManager.ts:195-251`；参考 `.vite/build/src-HagpvBpE.js:53278-53333` |
| `GitManager` 生命周期 | untracked 与 short-lived 未分离，repo-change reason 被丢弃 | 当前 `GitManager.ts:294-344`；参考 `.vite/build/src-HagpvBpE.js:53376-53502` |
| Git path / split-index | 相对路径一律按 repo root 解析，未复制 shared index | 当前 `GitManager.ts:94-116,484-502`；参考 `.vite/build/src-HagpvBpE.js:50534-50631` |
| turn patch 子目录 | patch 相对 batch cwd 生成，却在 git root 下应用 | `turn-diff.ts:165-208`、`LocalGitService.ts:292-307`、`applyPatch.ts:14-24` |
| 远程验收 | Main/provider 单测存在，但没有 fake SSH/app-server E2E | `GitHostRegistry.test.ts:1-119`、`tests/e2e/local-git-review.e2e.ts:501-590` |
| 分支创建 E2E | 测试直接执行 `git branch`，未验证创建分支 UI | `tests/e2e/local-git-review.e2e.ts:522-528` |
| 最终质量门禁 | 定向测试通过，但全量 plan coverage 和 staged whitespace 尚未全绿 | `desktop-app/package.json:10-24`、provider `package.json:32-36` |

## 3. 参考行为矩阵

实现时建立逐项勾选的 parity table，任何一项不能以“目前没有调用”为理由省略。

### 3.1 `RepoRepository` 对齐 `h3`

- 保留 `commonDir`、`host` 和 `getCommonDir()`。
- `getOriginUrl(signal?)` 使用以实例为范围、24 小时过期、并发 Promise 去重的缓存。
- Git 命令保持 `config --get remote.origin.url`，失败或空输出返回 `null`。
- 缓存 key 不包含 AbortSignal；首个实际执行使用调用时的 signal，缓存命中不重复执行 Git。
- 对齐参考：`.vite/build/src-HagpvBpE.js:53120-53155`。

### 3.2 `GitReviewSnapshot` 对齐 `y3`

- 完整提供 `git()`、`gitDiff()`、`queryKey()`、`read()`、`withTempIndex()`、`retire()`。
- `gitDiff()` 使用参考 diff 固定参数：
  `diff --no-ext-diff --no-textconv --color=never --src-prefix=a/ --dst-prefix=b/`，
  并应用 `diff.mnemonicPrefix=false`、`diff.noprefix=false`、`core.quotePath=false`。
- `queryKey(type, ...parts)` 返回：
  `['git', host.id, root, type, 'review', generation, ...parts]`。
- `withTempIndex()` 必须把临时 object store 环境与临时 index 环境合并。
- `run()` 在执行前、取得环境后、执行完成后都检查快照是否仍为当前 generation；旧快照统一抛 `GitReviewSnapshotStaleError`。
- retire 后只在活动操作数归零时删除临时 object store。
- 删除没有参考对应且无生产调用的公开 `withTempObjectStore()`；object store 创建保留为私有流程。
- 对齐参考：`.vite/build/src-HagpvBpE.js:53173-53276`。

### 3.3 `WorktreeRepository` 对齐 `b3`

- 每个 worktree 拥有独立查询缓存实例、`gitReadGenerationValue` 和当前 review snapshot。
- 补齐：
  - `getConfigValue(key, signal?)`
  - `getConfigValueForScope(key, 'local' | 'worktree', signal?)`
  - `setConfigValueForScope(key, value, 'local' | 'worktree', signal?)`
- worktree config 写入遇到未启用 `extensions.worktreeConfig` 时，按参考流程启用后重试一次。
- `clearGitReadCaches()`：generation +1，失效全部 Git 查询。
- `clearShortLivedGitReadCaches()`：generation +1，只失效 `short-lived` 查询。
- `invalidateGitReadCachesForMutation()`：generation +1、推进 review generation、失效 short-lived 查询。
- `invalidateGitReadCachesForRepoChange(reason, paths?)`：generation +1、推进 review generation，并按 `reason + paths` 精确失效。
- 对齐参考：`.vite/build/src-HagpvBpE.js:53278-53333`、`:49877-49939`、`:50879-50910`、`:51966-51988`。

### 3.4 `GitManager` 对齐 `S3`

- repo key 和 worktree key 都严格使用 `host.id + canonical path`；相同 host/root 复用，不同 host 隔离。
- stable root/common-dir Promise 缓存保留 24 小时 TTL。
- “无法读取当前目录且权限不足”错误缓存 1 秒；到期后允许重试，并删除失败的 stable metadata entry。
- `invalidateUntrackedPathsCache(paths = null, host?)` 独立维护 untracked generation 和查询失效，不能再转调 short-lived invalidation。
- `invalidateShortLivedGitReadCaches(host?)` 只处理 short-lived。
- `invalidateGitReadCachesForMutation(root, host)` 优先命中指定 worktree；解析失败才回退到同 host 全部 worktree。
- `invalidateGitReadCachesForRepoChange(reason, host?)` 必须把 reason 传给每个 worktree。
- background → foreground 以及 turnComplete 都同时执行 untracked 和 short-lived 失效。
- 对齐参考：`.vite/build/src-HagpvBpE.js:53335-53502`、`:50461-50500`。

### 3.5 Git path 与 split-index 对齐

- `rev-parse --git-path <name>` 的结果：
  - 绝对路径直接使用；
  - `.git/...` 相对 repo root；
  - 其他相对路径先解析 `rev-parse --git-dir`，再相对 git dir 拼接。
- `rev-parse --shared-index-path` 返回空值时表示未使用 split-index。
- 为 index 记录 `size / mtime / ctime / inode` 指纹；主 index 未变化时复用 shared-index 解析结果。
- 临时目录中同时复制主 index 和 shared index；目标 shared index 保留 basename，使主 index 中的链接仍有效。
- `ENOENT`、`ENOTDIR` 在复制 index/shared index 时按参考逻辑忽略，其他错误必须上抛。
- 保留可选的 Windows → WSL 临时 index 路径转换钩子；当前 Host 不启用时走原生路径。
- 对齐参考：`.vite/build/src-HagpvBpE.js:50522-50631`。

## 4. 实施步骤

### 步骤 1：先补参考行为测试，锁定“完整复刻”的定义

修改：

- `desktop-app/src/main/localGit/GitManager.test.ts`
- 新增 `desktop-app/src/main/localGit/GitManager.integration.test.ts`
- 必要时扩充 `desktop-app/src/main/localGit/testHelpers.ts`

先写会失败的测试：

1. origin 并发读取和 24 小时内只执行一次。
2. `gitDiff()` 固定参数、config override、输出上限和 AbortSignal 合并。
3. review `queryKey()` 包含 host/root/review generation。
4. config 普通读取、local/worktree scope 读取和 worktreeConfig 自动启用。
5. query cache Promise 去重、TTL、全量/短期/reason/path 失效。
6. untracked generation 与 short-lived 失效互不替代。
7. background→foreground 和 turnComplete 同时失效两类缓存。
8. 普通 index、缺失 index、split-index、独立 git dir 和 Windows 路径。
9. 旧 review snapshot 中途 retire 后抛 stale，并在最后一个操作结束后清理临时目录。
10. 使用真实临时 Git 仓库运行 `git update-index --split-index`，证明临时 index 操作成功。

完成标准：测试名称逐项对应 3.1～3.5；在实现前能够稳定暴露当前缺口。

### 步骤 2：实现本项目内的参考等价 Git 查询缓存

新增：

- `desktop-app/src/main/localGit/GitReadCache.ts`
- `desktop-app/src/main/localGit/GitReadCache.test.ts`

缓存只实现参考 GitManager 实际使用的能力，不引入第三方依赖：

- key：`['git', host.id, canonicalRoot, type, ...parts]`
- entry：Promise/data、创建时间、staleTime、invalidated、metadata
- metadata：
  - `gitReadInvalidation: 'short-lived'`
  - `gitReadInvalidation: ['config' | 'head' | 'index' | 'remote-refs' | 'working-tree']`
  - 可选 `gitReadPaths`
- 操作：`fetch()`、`find()`、按 key 失效、按 predicate 失效、全部清理。
- 同 key 的并发请求只能执行一次；失败 Promise 不留在缓存中。
- 路径失效采用参考项目的双向父子路径判断，统一把 `\` 归一化为 `/`。

完成标准：

- 行为与参考 `.vite/build/src-HagpvBpE.js:49877-49939` 一致。
- `WorktreeRepository` 不依赖 React/Renderer query client。
- `package.json` 不新增依赖。

### 步骤 3：逐方法重写 GitManager 四层对象

修改：

- `desktop-app/src/main/localGit/GitManager.ts`
- `desktop-app/src/main/localGit/gitCli.ts`
- `desktop-app/src/main/localGit/GitHostRegistry.ts`
- `desktop-app/src/main/localGit/GitHostRegistry.test.ts`

执行顺序：

1. 给 `GitHost` 增加 reference helper 所需的最小文件 stat/路径能力；本地用 Node API，远程继续通过 `CodexCommandClient` 的 argv 命令，不经过 shell。
2. 在 `gitCli.ts` 增加参考等价的 diff runner，集中固定 diff 参数、config override、32 MiB 上限和非零退出码规则。
3. 实现 git-dir/git-path/shared-index/index fingerprint helper。
4. 依次完成 `RepoRepository`、`GitReviewSnapshot`、`WorktreeRepository`、`GitManager` 的 3.1～3.4 方法矩阵。
5. 保留现有可读 TypeScript 命名；新增代码旁注写明对应参考符号和参考行号。
6. 删除或收回没有参考对应、也没有生产调用的公开替代接口，避免两套行为并存。

完成标准：

- 步骤 1、2 的所有单元/集成测试通过。
- `rg "void reason|invalidateUntrackedPathsCache.*invalidateShortLived|withTempObjectStore"` 不再命中简化实现。
- split-index 集成测试使用真实 Git 通过。

### 步骤 4：让现有读取与写入链路真正消费缓存规则

修改：

- `desktop-app/src/main/localGit/reviewSnapshot.ts`
- `desktop-app/src/main/localGit/LocalGitService.ts`
- `desktop-app/src/main/localGit/LocalBranchService.ts`
- `desktop-app/src/main/localGit/LocalCommitService.ts`
- `desktop-app/src/main/localGit/LocalGitWatchBroker.ts`
- 对应 `*.test.ts`

要求：

1. Review 快照内的读取使用 `GitReviewSnapshot.read/git/gitDiff/queryKey`，同一 generation 的重复读取可复用，generation 推进后绝不复用。
2. branch、HEAD、config、remote refs、index、working tree、untracked 读取按参考 metadata 分类。
3. checkout/create 成功至少发送 `head` 和 `working-tree` repo-change。
4. commit 成功发送 `head`、`index`、`working-tree`；stage/unstage/revert 发送 mutation，并独立失效 untracked。
5. watch broker 根据 index、HEAD、config、refs、普通文件变化传入正确 reason；能解析到路径时把路径传给 worktree 做局部失效。
6. `LocalGitService`、分支、提交和 Review 始终复用 resolver 返回的同一 `WorktreeRepository`，不新建旁路 Git client。

新增断言：

- 缓存命中时 Git 命令次数不增加。
- 不相关 reason/path 不清缓存。
- 相关 mutation、repo change、外部文件变化后下一次读取必然重新执行。
- 不同 host、不同 worktree 的缓存互不影响。

完成标准：缓存不再是孤立设施，至少 Review、branch summary、workspace state 三条生产读取链路有命中和失效测试。

### 步骤 5：修正子目录 turn patch 的执行基准

修改：

- `desktop-app/src/main/localGit/LocalGitService.ts`
- `desktop-app/src/main/localGit/applyPatch.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/turn-diff.ts`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/event-mapper.test.ts`
- `desktop-app/src/main/localGit/LocalGitService.test.ts`

方案：

1. 保留 patch path 相对每个 `batch.cwd` 的 provider 合同。
2. Main 重新解析并确认 `batch.cwd` 属于 target 的 host、canonical git root 和授权 workspace。
3. `applyGitPatch()` 接受经过 Main 校验的 command cwd；Git apply 从 batch cwd 执行，缓存失效仍落在 canonical `WorktreeRepository`。
4. 继续拒绝绝对路径、`..`、NUL 和仓库外路径；不能通过重写字符串绕过 `validateGitPatch()`。
5. Undo 继续逆序，Reapply 继续原顺序；任一 batch 非 success 立即停止。

测试矩阵：

- repo root cwd；
- `/repo/desktop-app` 子目录 cwd，patch `src/a.ts`；
- 本地和 remote POSIX；
- cwd 在 repo 外；
- cwd 属于同 host 的另一仓库；
- patch 路径越界；
- 多 batch 不同子目录及失败短路。

完成标准：子目录测试证明实际修改的是 `/repo/desktop-app/src/a.ts`，不会创建或修改 `/repo/src/a.ts`。

### 步骤 6：补齐远程和分支创建 E2E

修改/新增：

- `desktop-app/tests/fixtures/fake-ssh-app-server.mjs`
- `desktop-app/tests/e2e/local-git-review.e2e.ts`
- `desktop-app/tests/test-plan-coverage.json`
- 必要时给 `GitHostRegistry.ts` 增加仅 Main 可配置的 SSH executable 注入点

fixture 要求：

- 模拟 `ssh <alias> "exec codex app-server --listen stdio://"` 的 stdio 生命周期。
- 实现测试所需的 initialize、`command/exec`、outputDelta、write、terminate 和进程退出。
- command/exec 在测试创建的“远端”临时目录中执行受控 argv；不接受 Renderer 自定义命令。
- 每个测试独立仓库、独立 host alias、独立进程表；结束时验证连接关闭和临时目录清理。

E2E 必须通过真实 UI 覆盖：

1. 本地：分支列表、Create and checkout、切换、Review、stage、unstage、commit。
2. 远程：同一组主流程，验证 Git 控件未因 remote 隐藏。
3. 远程断线后显示 retry，重试复用/重建正确连接。
4. 子目录会话的 turn Undo/Reapply。

删除测试中用裸 `git branch other` 代替 UI 创建分支的验收方式；裸 Git 只允许用于 fixture 初始数据准备和最终结果核验。

完成标准：`test-plan-coverage.json` 为本计划新增独立、可追踪的远程和子目录用例 ID，不能继续只用“本地 Git 审核与恢复”证据代替。

### 步骤 7：完成全量质量门禁并清理暂存质量问题

依次运行：

1. `git diff --cached --check`
2. `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint`
3. `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck`
4. `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test`
5. `npm --prefix desktop-app run lint`
6. `npm --prefix desktop-app run typecheck`
7. `npm --prefix desktop-app test`
8. `npm --prefix desktop-app run test:e2e -- --reporter=line tests/e2e/local-git-review.e2e.ts`
9. `npm --prefix desktop-app run test:plan-coverage`

若全量 E2E 中存在与本改动无关的历史失败：

- 必须保存失败用例、日志和与本分支基线的对比；
- 本计划新增/修改的 Git 用例必须全部通过；
- 不能把“看起来无关”作为完成依据，除非基线在相同环境同样失败且新增 Git 用例为绿。

最终静态检查：

- `git diff -- codex/codex-rs/app-server` 无输出。
- Renderer 中不存在直接 Git 执行或任意本地/远程 cwd 输入。
- `desktopApp.localGit` 不重新出现。
- provider command client 文件没有 trailing whitespace。

## 5. 可测试验收标准

### AC-01 GitManager 方法完整性

- 四个类的方法矩阵与 3.1～3.4 一一对应。
- 每个参考方法至少有一个直接测试；缓存失效和快照生命周期必须有状态转换测试。
- 不允许保留只递增 generation、却不清理任何查询的实现。

### AC-02 缓存等价性

- 同 key 并发读取只执行一次 Git。
- stable metadata 和 origin 在 24 小时内命中；权限 cwd 错误仅阻止 1 秒。
- short-lived、config、head、index、remote-refs、working-tree 和路径级失效都有互不误伤的测试。
- foreground 与 turnComplete 同时刷新 untracked 和 short-lived。

### AC-03 临时 Git 环境

- 普通仓库、worktree、独立 git dir 和 split-index 都能在临时 index 中完成至少一次读取和一次写入演练。
- 操作结束后临时 index/object store 被清理。
- snapshot retire 发生在操作中途时，结果不能被提交给调用方。

### AC-04 turn patch 安全与正确路径

- batch cwd 为 repo root 和嵌套子目录都能正确 Undo/Reapply。
- 任何仓库外 cwd/path 都在执行 Git 前被拒绝。
- canonical repository 的 generation 在成功后只推进一次；失败 batch 不误报成功。

### AC-05 本地与远程产品链路

- 本地和 fake SSH 远程均通过 Renderer → preload → Main → provider command client → Git host 的真实链路。
- 两类 host 都能从 UI 完成分支创建、切换、Review、stage/unstage 和 commit。
- 远程失败有 retry，应用退出会关闭持久 command client。

### AC-06 最终门禁

- 步骤 7 的命令全部为绿，或只有经过相同环境基线证明的历史失败。
- `git diff --cached --check` 为绿。
- app-server 目录无改动，无新增第三方依赖。

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 只补方法签名，现有服务仍直接执行 Git | 缓存规则形同虚设 | 步骤 4 强制给生产读取链路添加命中/失效命令次数断言 |
| 缓存 reason 标注错误 | UI 显示陈旧分支、diff 或状态 | 先移植 reference metadata/predicate，再逐写操作做精确失效测试 |
| split-index 只在 mock 中通过 | 真实仓库临时 index 失败 | 使用真实 `git update-index --split-index` 集成测试 |
| remote stat/path 能力在不同 POSIX 系统不一致 | 远程 split-index 不稳定 | Host 层返回统一结构；优先 Git 自身路径命令，平台差异只留在 Host 适配器 |
| fake SSH fixture 变成另一套产品实现 | E2E 不能证明真实链路 | fixture 只模拟 stdio 协议和远端进程，Desktop 仍走生产 `GitHostRegistry` 与 `CodexCommandClient` |
| 修补 turn patch 时降低路径安全 | 可写到仓库外 | batch cwd 先由 Main 与 canonical root 比对，随后继续执行 patch path 校验和越界反例测试 |
| 暂存区改动量大导致回归定位困难 | 全量 E2E 失败难归因 | 每个步骤先跑定向测试，步骤完成后再跑 Desktop 单测，最后才跑全量 coverage |

## 7. 执行顺序与停止条件

严格按“测试锁定 → 缓存基础 → 四层复刻 → 生产接入 → 子目录修复 → 远程 E2E → 全量门禁”执行。步骤 2～5 不并行修改 `GitManager.ts`，避免同一核心文件产生冲突；E2E fixture 可在步骤 3 完成稳定接口后并行准备。

只有以下条件全部成立才停止：

- 所有 AC 都有测试证据；
- GitManager parity table 无未勾选项目；
- 本地、子目录、远程三类关键链路通过；
- 无 app-server 改动、无新依赖、无 staged whitespace；
- `docs/plan.md` 中“逐方法复制、完整缓存失效、远程 E2E、最终全量验证”均能指向已通过的测试。
