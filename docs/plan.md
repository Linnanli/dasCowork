# 按参考项目引入统一 GitManager

## 总体方案

- 以参考项目构建产物中的 `S3 / h3 / b3 / y3` 为移植源，逐方法复制 `GitManager`、`RepoRepository`、`WorktreeRepository`、`GitReviewSnapshot` 的控制流程和缓存失效规则。
- 恢复可读的 TypeScript 命名，只替换参考项目专属的日志、Host、查询缓存和 Electron 运行时依赖；不做简化版仿写，也不新增第三方依赖。
- `GitManager` 统一负责仓库身份、缓存、快照生命周期和刷新；分支、提交、Review 等服务保留各自业务职责，避免形成万能类。
- 当前通过 `readThread()` 修补可信 cwd 的方案仅保留为历史会话兼容能力，不再作为各个 Git 弹窗各自解决 cwd 的补丁。

## 核心接口与主进程架构

- 在 Main 新增统一模块：

  - `GitManager`：按 `hostId + canonicalGitRoot` 复用仓库对象。
  - `RepoRepository`：管理 common directory、origin 和仓库级配置。
  - `WorktreeRepository`：管理 worktree 查询缓存、变更代次和 Review 快照。
  - `GitReviewSnapshot`：提供临时 index/object store、过期检测、终止和清理。
  - `GitHostRegistry`：提供本机与远程主机适配器。

- 定义统一目标 `GitRepositoryTarget`，至少包含 `conversationId`、`threadId`、`hostId`、`cwd`、`gitRoot`；`commonDir` 只保留在 Main，不能由 Renderer 指定。
- 增加 `resolveRepositoryTarget()` IPC：Main 根据项目分配或历史 thread 解析可信 cwd，再由 `GitManager` 发现 Git 根目录。无法解析或不是仓库时返回 `unavailable`，不抛出弹窗打开错误。
- 所有 Git IPC 都接收已解析目标，同时在 Main 重新核对会话、host 和 cwd，Renderer 不能传任意本地或远程路径。
- 将现有 `LocalGitService`、分支、提交、Review、turn patch 和 watch broker 攄接到同一个 `WorktreeRepository`；所有成功修改必须调用对应的 mutation/repo-change 缓存失效方法。
- 接入参考项目的生命周期规则：应用回到前台、任务完成、分支切换、提交、暂存、撤销和外部文件变化时，统一清理短期缓存并推进 Review generation。
- 将 staged patch 中的初始化顺序保留，但在运行时只创建一个 `GitManager`、一个 `GitHostRegistry` 和一个 Git IPC 门面。

## 本机与远程执行

- 本机 `GitHost` 继续使用受控 argv 方式启动 Git，不经过 shell。
- 远程项目通过持久 SSH stdio 连接启动远端 `codex app-server --listen stdio://`；`hostId` 解释为已配置的 SSH alias。
- Provider fork 新增 `CodexCommandClient`，使用现有 `AppServerClient` 封装：

  - `command/exec`
  - `command/exec/outputDelta`
  - `command/exec/write`
  - `command/exec/terminate`

  并复用生成的协议类型，不修改 Codex app-server。
- `RemoteGitHost.spawn()` 将上述接口包装成与本机一致的进程对象，支持 stdout、stderr、stdin、超时、AbortSignal 和输出上限。
- 远端只允许配置 Codex 可执行文件名或绝对路径，默认 `codex`；SSH alias 和命令来自 Main 持久配置，不接受 Renderer 提交任意 shell 命令。
- 远端预先安装 Codex。连接时检查 app-server 是否可用和版本是否兼容；本次不实现自动下载安装。
- 首版远端执行目标为 POSIX SSH 主机；远程聊天传输不在本次迁移范围内，新增远程连接只服务 Git 和远程工作区校验。

## UI 接入

- 在会话根部增加一个 `GitRepositoryProvider`，项目或 thread 变化时只解析一次仓库目标，对下提供 `loading / ready / unavailable / error` 状态。
- 将现有 `localGitTarget` 和分散的 `conversationId + threadId` 推导移除，统一从 Provider 获取目标。
- 下列入口全部接入统一 Git 状态：

  - Composer 分支选择、创建和切换。
  - Review 模式、基准分支、提交记录和文件 diff。
  - 会话 Changes 行和 Review 面板。
  - 暂存、取消暂存、撤销、重新应用和提交弹窗。
  - turn patch 操作和 Git 变更订阅。

- 移除 `!isRemoteExecution` 对分支和 Review 的硬编码隐藏；是否显示由仓库目标是否可用决定。远程连接失败时显示可重试状态，不让组件自行判断或执行 Git。
- 将公开 API 从 `desktopApp.localGit` 收口为 `desktopApp.git`；当前功能尚未发布，不保留两套长期兼容接口。
- 不新增当前产品没有的 PR、push 或 worktree UI，但这些未来入口必须直接消费同一个 `GitManager` 和 `GitRepositoryTarget`。

## 测试与验收

- 单元测试覆盖：同 host/root 对象复用、不同 host 隔离、嵌套 cwd、非仓库、1 秒权限错误重试、前后台刷新、mutation 失效和过期 Review 快照。
- Provider 测试覆盖 command 输出、stdin、终止、超时、连接关闭以及不同 processId 的隔离。
- Main 测试覆盖历史本地会话 fallback、远程项目解析、伪造 cwd/host 拒绝、SSH 连接复用和应用退出清理。
- Renderer 测试覆盖本地与远程分支弹窗、加载/不可用/重试状态，以及所有 Git UI 使用同一个 repository target。
- E2E 使用本地临时仓库和可控的假 SSH/app-server fixture，验证分支列表、创建、切换、Review、暂存和提交。
- 最终运行 provider lint/typecheck/tests，以及 Desktop lint、typecheck、test、test-plan-coverage 和 local Git E2E。

## 默认约束

- 不修改 `codex/codex-rs/app-server`。
- 不持久回填历史 thread 的项目分配；历史 cwd 只在解析目标时只读恢复。
- 不把远程命令、凭据或完整主机配置暴露给 Renderer。
- 验收标准是所有 Git UI 不再自行解析 cwd、不会直接执行 Git，并且分支弹窗不再出现 `trusted local conversation cwd` 错误。
