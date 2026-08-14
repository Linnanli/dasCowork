# “提交或推送”审查问题修复与参考能力补齐计划

> 生成日期：2026-08-12  
> 计划模式：`$plan` 直接规划  
> 上游计划：`.omx/plans/commit-or-push-dialog-reference-parity-plan.md`  
> 目标：修复审查发现的主要问题，并用 `reference-projects/codex-electron-26.707.72221-beautified` 的既有方案补齐状态机、并发控制和验证证据。

## 1. 目标结果

在不重做现有 shared/preload/Main 推送合同的前提下，完成以下收尾：

1. 修复干净 detached HEAD 无法进入弹窗、push-only 默认落在禁用动作、结构化 push 失败被压成通用文案的问题。
2. 复用现有 `LocalGitReviewProvider`，补上参考项目的仓库级工作流锁和阶段反馈，避免提交、推送、建分支、切分支并发冲突。
3. 补齐 remote 选择优先级、non-fast-forward、超时、输出截断等 Main 安全验证。
4. 把本地首次发布、新分支发布和 SSH remote host 推送纳入真实 E2E，并登记为 `P004-E2E-19`。
5. 只有目标测试、全量桌面测试和测试计划覆盖命令全部通过，才把上游计划视为完成。

## 2. 已确认问题与参考依据

### 2.1 当前实现缺口

- `ReviewCommitControl` 只在“有更改”或 `commitsAhead > 0` 时启用入口；干净 detached HEAD 即使已有 HEAD 和可选远端也被挡在弹窗外，见 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:145-147`。弹窗内部其实已经允许“新分支 + push-only”，见 `desktop-app/src/renderer/src/components/right-workspace/review/CommitOrPushDialog.tsx:392-415`。
- 弹窗每次打开都把 `selectedAction` 重置为 `commit`，上下键又遍历全部可见动作，而不是只遍历可执行动作，见 `desktop-app/src/renderer/src/components/right-workspace/review/CommitOrPushDialog.tsx:62-76,114-129`。因此只有待推送提交时，`Cmd/Ctrl+Enter` 初始会落到禁用的 commit。
- `LocalPushResult` 已区分 `branch-missing`、`remote-missing`、`remote-ambiguous`、`nothing-to-push`、`status-unavailable` 和 `push-failed`，见 `desktop-app/src/shared/localGitApi.ts:724-748`；但 Renderer 在没有 `message` 时统一显示“推送失败”，见 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:118-137`。
- `LocalGitReviewProvider` 已有按 `hostId + cwd` 建立的仓库级工作流注册表和可替换同 ID 反馈，见 `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewProvider.tsx:28-50,109-123,133-163,232-234`；当前类型只允许 `commit-and-switch`，`ReviewCommitControl` 仍只用组件内 `pending`，见 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:18-23,95-142`。
- Main 已安全重读状态、解析远端、设置 upstream，并限制 push 为 45 秒/64 KiB/非交互，见 `desktop-app/src/main/localGit/LocalPushService.ts:38-93,131-177,287-317`；现有测试只覆盖首推、已有 upstream、nothing-to-push、无/歧义远端和 detached HEAD，见 `desktop-app/src/main/localGit/LocalPushService.test.ts:12-113`，没有覆盖优先级、non-fast-forward、超时和输出截断。
- 当前本地发布 E2E 在推送成功后再次点击已经按设计禁用的入口，再检查弹窗中的 push 按钮，见 `desktop-app/tests/e2e/local-git-review.e2e.ts:670-739`；正确断言应是同步后工具栏入口禁用。
- SSH E2E 只验证分支、审阅、暂存和提交，没有调用 push，见 `desktop-app/tests/e2e/local-git-review.e2e.ts:1002-1098`。测试用 remote app-server 已能透传任意固定 command 执行，可承载真实 `git push`，见 `desktop-app/tests/e2e/support/remote-git-app-server.mjs:59-93`。
- `test-plan-coverage.json` 当前登记 `P004-E2E-01..18` 和 `P004-E2E-20`，没有发布场景 19，见 `desktop-app/tests/test-plan-coverage.json:4-101`；validator 也显式排除了 19，见 `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:39-42` 和 `desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs:118-121`。

### 2.2 采用的参考项目方案

- 参考弹窗分别计算 commit、commit-and-push、push 的可用性，并把共享 workflow 是否存在计入 pending，见 `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:35290-35393`。
- 三条动作保持可见但独立 disabled，并由命令列表循环导航，见同文件 `:35666-35785`；底层 `Command.Item` 明确接收 `disabled`，见同文件 `:35845-35900`。本项目应等价实现“只在可执行动作间选择”，不要求复制 bundle 的组件实现。
- 参考工作流开始前按仓库键检查锁，随后依次切换 `creating-branch`、`committing`、`pushing`，并在 `finally` 清理，见同文件 `:34783-34920`。
- 参考 push 失败保留执行输出，成功后按 commit/push 类型显示反馈并刷新相关 Git 数据，见同文件 `:34675-34699,34907-34920`。

## 3. 需求摘要

### 必须完成

1. 工具栏入口能覆盖“有可提交更改”“当前分支有待推送提交”“detached HEAD 有 HEAD 且可选择远端，可通过新分支发布”三类场景。
2. 弹窗始终选中一个可执行动作；方向键跳过禁用动作；状态变化后当前动作失效时自动迁移到首个可执行动作。
3. 提交/推送工作流与分支切换共用同一个仓库级互斥锁，阶段可见且任何退出路径都会释放。
4. Renderer 对每种结构化 push 结果提供非程序员可读的中文反馈，保留 `push-failed` 的限长 Git 细节和“提交成功但推送失败”的部分成功语义。
5. Main 的远端优先级、普通 push 拒绝、超时和输出限制都由自动化测试证明。
6. 本地和 SSH remote host 都有真实仓库推送 E2E；发布场景进入 P004 覆盖合同。

### 明确不做

- 不修改 `codex/codex-rs/app-server/`、AI SDK provider fork、admin backend 或聊天推理链路。
- 不新增任意 Git 命令 IPC，不让 Renderer 传 remote、refspec、force、args 或 shell；现有 `{ target }` strict 合同保持不变，见 `desktop-app/src/shared/localGitApi.ts:715-748`。
- 不实现 force push、自动 rebase、reset 或失败回滚。
- 不新增依赖，不重做已经完成的统一弹窗、shared schema、preload 和 Main IPC 装配。
- 不因测试偶发超时而提高全局 Vitest/E2E 超时；只允许给真实 Git 集成用例设置与 45 秒 push 上限一致的局部预算。

## 4. 可测试验收标准

### AC-FIX-1：入口和动作选择状态正确

- `ReviewCommitControl` 在以下任一条件成立时启用：选择范围有更改；`commitsAhead > 0`；或 `branch === null && hasHead && selectedPushRemote !== null`。无仓库、状态不可用、无更改且无可发布 HEAD 时禁用。
- 干净 detached HEAD + `origin` 的组件测试能打开弹窗、选择“新分支”，并执行 push-only；未选择新分支时 current-branch push 仍禁用。
- 只有待推送提交时，弹窗打开后 `push` 是高亮项；`Cmd/Ctrl+Enter` 只调用 `pushChanges`，不会调用 `commitChanges`。
- commit 可用、push 禁用时初始选择 commit；三条动作都禁用时没有快捷键提示，快捷键不触发动作。
- 上下方向键只在可执行动作中循环；切换 `includeUnstaged`、分支模式或收到新 status 导致当前动作禁用时，选择自动迁移到显示顺序中的首个可执行动作。
- 推送完成且 working tree 干净、`commitsAhead === 0` 后，工具栏入口禁用；测试不得再点击禁用入口检查内部状态。

### AC-FIX-2：仓库级工作流互斥和阶段反馈完整

- `LocalGitWorkflow` 扩展为判别联合：保留 `commit-and-switch`，新增 `commit-or-push` 的 `creating-branch | committing | pushing` 阶段；仓库键仍为 `hostId + cwd`，见 `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewProvider.tsx:34-50,232-234`。
- `ReviewCommitControl` 执行动作前必须先取得共享锁；同一仓库已有切分支或发布工作流时，不创建分支、不提交、不推送，并显示“当前仓库已有 Git 操作进行中”的 info 反馈。
- 不同仓库可同时开始工作流；同一仓库只允许一个工作流。
- 新分支发布阶段顺序为 `creating-branch -> committing -> pushing`；commit-only 不进入 pushing；push-only 不进入 committing。
- 工具栏入口、本地分支切换项和新建分支入口在同仓库 workflow 存在时全部禁用；现有分支切换禁用点见 `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.tsx:304-307,394-405,448-469`。
- 反馈使用稳定 ID `publish-operation:{hostId}:{cwd}`（或等价键），阶段 info、最终 success/error 替换同一条反馈，不叠加多条 toast；现有按 ID 替换能力见 `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewProvider.tsx:109-123`。
- 创建分支失败、commit 失败、push 失败、抛异常和成功路径都在 `finally` 释放锁，并刷新 Review/publish 状态。

### AC-FIX-3：结构化推送反馈不丢失

- `branch-missing` 显示“当前不在可推送的分支上，请先创建或切换分支”。
- `remote-missing` 显示“未配置可用的远端”。
- `remote-ambiguous` 显示“无法确定要推送到哪个远端”。
- `nothing-to-push` 显示“没有待推送的提交”。
- `status-unavailable` 显示“无法读取推送状态”，有 Main 限长详情时附加详情。
- `push-failed` 显示“推送失败”，并附加 Main 返回的最长 2000 字符 Git 详情；不得显示成功反馈。
- commit-and-push 中 commit 已成功而后续 push 返回任一失败状态时，统一显示“提交成功，但推送失败：{具体原因}”，保留本地 commit/新分支，不回滚；刷新后可用 push-only 重试。

### AC-FIX-4：Main 推送策略和失败边界有证据

- 自动化测试证明已有 upstream 总是优先于其他配置，并保持非标准远端 ref。
- 无 upstream 时，自动化测试按顺序证明 `branch.<name>.pushRemote` > `remote.pushDefault` > 合法 `branch.<name>.remote` > `origin` > 唯一 remote；候选配置指向不存在 remote 时继续尝试下一项，最终无唯一解才返回 missing/ambiguous。当前实现位置见 `desktop-app/src/main/localGit/LocalPushService.ts:287-304`。
- 真实 bare remote 制造远端领先/本地分叉后，普通 push 返回 `push-failed`，详情包含 Git 拒绝信息；远端 ref、本地 HEAD、当前分支和 working tree 均不被重写。
- 通过 `WorktreeRepository.git` 测试替身模拟 timeout 与超量输出：确认 push 仍传入 `timeoutMs: 45_000`、`maxOutputBytes: 64 * 1024`、`GIT_TERMINAL_PROMPT=0`，并分别映射为限长 `push-failed`；不为测试新增生产命令接口。
- 首推真实仓库测试的局部测试预算大于 45 秒但不超过 60 秒；该测试连续运行三次不超时。若仍不稳定，必须先定位 fixture/命令耗时，不能继续扩大预算。

### AC-FIX-5：本地首次发布和新分支发布 E2E 完整

- 把现有本地发布 E2E 标记为 `P004-E2E-19`，在同一个真实仓库中依次验证：
  1. 有更改时 commit-only 成功；
  2. working tree 已干净但本地 ahead 时入口仍启用；
  3. 再开弹窗时 commit 禁用、push 自动选中且可执行；
  4. 首推设置 `origin/{branch}` upstream，bare remote ref 指向该提交；
  5. 同步后入口禁用；
  6. 再产生更改，选择新分支执行 commit-and-push；
  7. 新分支、upstream 和 bare remote 日志均正确，最终入口再次禁用。
- 所有状态等待使用 `expect.poll` 或 UI 可见状态，不使用固定 sleep；失败时沿用现有 diagnostics 附件。

### AC-FIX-6：SSH remote host push 真实可用

- 扩展 `P004-E2E-15`：测试初始化本地 bare remote，并给 remote project 工作区配置 `origin`；通过 Review 弹窗执行 commit-and-push。
- 断言 fake SSH 被调用、working tree 当前分支获得 upstream、bare remote 对应 ref 的最后一条提交消息正确。
- 测试不得绕过 UI 直接调用 `pushChanges`；push 必须经过 Renderer -> preload -> Main -> `GitHostRegistry` -> fake SSH app-server。Main 只对 push 开启 remote network capability 的边界保持不变，见 `desktop-app/src/main/localGit/GitHostRegistry.ts:194-201`。
- 测试只使用本机临时 bare remote，不依赖互联网、凭据或用户 SSH 配置。

### AC-FIX-7：覆盖合同与完成门槛一致

- `desktop-app/tests/test-plan-coverage.json` 新增 `P004-E2E-19`，evidence 指向声明该 ID 的 `tests/e2e/local-git-review.e2e.ts`。
- `expectedP004Ids` 改为完整的 `P004-E2E-01..20`；validator 测试同时断言 19 和 20 存在，不再保留“unused case 19”规则。
- `npm --prefix desktop-app run test:plan-coverage` 完整结束且退出码为 0；不能只以 validator 前半段通过代替整条命令通过。
- TypeScript、lint、目标单测、全量桌面测试、本地发布 E2E 和 SSH E2E 全部通过；任何一项未运行或失败，都不能宣称上游计划完成。

### AC-FIX-8：架构边界保持

- Renderer 仍只调用 `window.desktopApp.git`，不新增 Node/Electron/child_process 使用。
- push request 继续只接受 `{ target }`，现有拒绝 remote/refspec/force/args/shell 的 schema/IPC 测试继续通过。
- 本地和 SSH remote host 都继续通过 `WorktreeRepository.git()`；不在 desktop Main 复制 app-server/provider 协议。
- `codex/codex-rs/app-server/`、`desktop-app/vendors/ai-sdk-provider-codex-asp/` 和 admin backend 的 diff 必须为空。

## 5. 实施步骤

### Step 0：先补回归测试，锁定审查缺口

修改测试：

- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.test.tsx:33-112`
- `desktop-app/src/renderer/src/components/right-workspace/review/CommitOrPushDialog.test.tsx:33-173`
- `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewProvider.test.tsx:55-129`
- `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.test.tsx`
- `desktop-app/src/main/localGit/LocalPushService.test.ts:12-113`

操作：

1. 在 `ReviewCommitControl.test.tsx` 先加入 clean detached HEAD 入口、结构化 push 文案、部分成功、重复工作流被拒绝、阶段顺序和 finally 解锁测试。
2. 在 `CommitOrPushDialog.test.tsx` 加入 push-only 自动选中、方向键跳过禁用动作、status/checkbox/branch mode 变化后重新选择、全部禁用时快捷键无动作测试。
3. 在 Provider/BranchSwitcher 测试中锁定“同仓库互斥、不同仓库独立、任意 publish 阶段都会禁用分支写操作”。
4. 在 `LocalPushService.test.ts` 加入远端优先级表、non-fast-forward、timeout/options 和超量输出截断测试；保留真实 bare remote 的首推/upstream 测试。

停止条件：新增测试在现有代码上只因本计划列出的缺口失败，不因测试装配或不相关模块失败。

### Step 1：修复弹窗入口和动作选择状态机

修改：

- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:145-169`
- `desktop-app/src/renderer/src/components/right-workspace/review/CommitOrPushDialog.tsx:58-129,300-340,377-432`

操作：

1. 把入口可用性抽成有名称的纯判断，加入 `branch === null && hasHead && selectedPushRemote` 的“可通过新分支发布”条件；`status-unavailable` 仍不可用。
2. 从 `visibleActions` 和 `actionState` 派生 `enabledActions`；打开或状态变化时，仅当当前选择不可执行才切换到首个可执行动作，避免覆盖用户仍然有效的选择。
3. 方向键只循环 `enabledActions`；没有可执行动作时不改变选择也不执行快捷键。
4. disabled 行继续可见并保留 reason/tooltip；快捷键提示只出现在当前可执行行。

停止条件：AC-FIX-1 的 Renderer 测试全部通过，commit-before-switch 模式原测试不回归。

### Step 2：接入仓库级 workflow lock 和统一反馈

修改：

- `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewProvider.tsx:28-50,109-163`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitControl.tsx:13-143`
- `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.tsx:247-307,394-469`
- 如测试 mock 需要同步：`desktop-app/src/renderer/src/components/right-workspace/review/ReviewWorkspace.test.tsx:72-80`

操作：

1. 把 `LocalGitWorkflow` 改为判别联合，新增 `commit-or-push` 三阶段；不建立第二套 registry。
2. `ReviewCommitControl` 从现有 Provider 取得 `start/update/finish/getGitWorkflow`，先抢锁再关闭弹窗；抢锁失败时不调用任何写 API。
3. 每进入建分支、提交、推送前更新 phase，并用稳定 feedback ID 替换阶段提示。
4. 用 `LocalPushResult.status` 的穷尽 switch 生成中文原因；`push-failed/status-unavailable` 附加 Main 限长详情，部分成功统一加前缀。
5. 在一个 `finally` 中完成 `finishGitWorkflow`、`controller.refresh()` 和 publish status 刷新，避免分散清理路径。
6. `pending` 由本地请求状态和共享 workflow 共同决定，使 Review 工具栏与 BranchSwitcher 对同仓库操作互相可见。

停止条件：AC-FIX-2/3 全部通过，任一错误路径后能再次执行 Git 操作。

### Step 3：补齐 Main 推送安全矩阵并处理测试超时

优先修改测试，仅测试暴露真实缺陷时再修改生产代码：

- `desktop-app/src/main/localGit/LocalPushService.test.ts:12-122`
- 必要时 `desktop-app/src/main/localGit/LocalPushService.ts:38-93,287-356`

操作：

1. 用表驱动配置覆盖 upstream、pushRemote、pushDefault、branch remote、origin、唯一 remote 和歧义场景；断言 `selectedPushRemote` 和实际 bare remote ref。
2. 用第二个 clone 或独立 worktree 先推进 bare remote，再让本地分支产生不同提交，断言普通 push 返回 `push-failed` 且双方 ref/working tree 不被改写。
3. 在已解析的真实 `WorktreeRepository` 上 spy `git()`：只拦截 `push`，其余状态命令走真实实现；以此断言 options，并模拟 timeout/超量输出，无需给生产服务增加测试专用执行接口。
4. 把真实 push 集成用例的局部 timeout 从 30 秒校准为 60 秒，因为生产 push 上限本身为 45 秒；记录单测独跑和目标测试并跑的耗时。
5. 连续运行首推测试三次。若仍超时，记录最慢 Git 子命令并优化 fixture 或状态读取；不得继续提高 timeout。

停止条件：AC-FIX-4 全部通过，`LocalPushService.test.ts` 无偶发超时。

### Step 4：修复本地 E2E 并补 SSH push

修改：

- `desktop-app/tests/e2e/local-git-review.e2e.ts:670-746,1002-1105`
- 仅在需要增加可诊断 command trace 时修改 `desktop-app/tests/e2e/support/remote-git-app-server.mjs:59-93,193-197`；默认不改 fixture。

操作：

1. 将本地发布用例命名为 `P004-E2E-19 ...`，按 AC-FIX-5 重排为 commit-only -> push-only -> 新分支 commit-and-push，并把最后断言改为工具栏入口禁用。
2. 扩展 `P004-E2E-15` 的临时目录清理范围，创建 bare remote、配置 origin，在现有 SSH review/stage 流程后从弹窗执行 commit-and-push。
3. 同时断言 UI 反馈、upstream、remote ref 和 SSH 日志；不以“按钮点击成功”替代 Git 结果断言。
4. 若 SSH 用例失败且现有日志不能区分 push 命令，只给 test fixture 增加 `command/exec` 测试 trace；不得把生产 Git 参数暴露给 Renderer。

停止条件：本地 P004-E2E-19 和 SSH P004-E2E-15 可分别独立通过，再在同一 E2E 运行中共同通过。

### Step 5：登记覆盖合同

修改：

- `desktop-app/tests/test-plan-coverage.json:4-101`
- `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:39-42`
- `desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs:106-121,754-760`

操作：

1. 新增 `P004-E2E-19` manifest 项，状态为 `covered`，evidence 指向实际声明该 ID 的 E2E 文件。
2. `expectedP004Ids` 使用连续 1..20 的生成方式，删除跳过 19 的特殊规则。
3. 更新 validator 测试名称和断言，确认 19、20 都必需；保留“evidence 文件内必须存在含 ID 的 test 声明”校验，见 `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:114-164`。

停止条件：validator 单测和完整 `test:plan-coverage` 都通过，并报告 P0-04 20/20。

### Step 6：全量验证和完成判定

按以下顺序执行，前一层通过后再进入后一层：

1. Renderer/Provider 目标测试。
2. Main push/schema/IPC 目标测试。
3. P004-E2E-19 本地发布 E2E。
4. P004-E2E-15 SSH remote host E2E。
5. desktop typecheck、lint、全量 test。
6. test-plan coverage 完整命令。
7. 全量 Electron E2E。
8. `git diff --check`、旧弹窗零引用、禁止目录零 diff。

停止条件：第 7 节所有命令成功且无遗漏；否则继续修复，不能把计划标为完成。

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 弹窗 status 异步返回覆盖用户当前选择 | 快捷键执行错误动作 | 只有当前动作从可用变为不可用时才自动迁移；仍可用则保留选择，并加 rerender 测试。 |
| 本地 pending 与共享 workflow 不一致 | 重复 commit/push 或分支切换并发 | 以 Provider registry 为唯一仓库级锁，本地状态只负责即时视觉反馈，所有路径统一 finally 清理。 |
| non-fast-forward 测试误用 fetch/rebase 改写本地 | 测试掩盖普通 push 安全性 | 用第二 clone 推进远端，待测仓库只 commit 后调用 service.push；前后断言 SHA、分支和 status。 |
| 真实 Git 测试在并发环境慢 | 误判功能失败或掩盖 hang | 只把真实 push 用例预算校准到 60 秒，并连续跑三次；超时后定位子命令，不提高全局超时。 |
| SSH E2E 实际绕过 remote host | 远程能力假阳性 | 从 remote project UI 触发，联合断言 SSH 日志、upstream 和 bare remote ref。 |
| P004-19 只登记未执行 | 覆盖报告假阳性 | 保留声明名检查，同时要求 Playwright 独立运行该 ID 和完整 `test:plan-coverage` 成功。 |
| Git 详情泄露过长或不可读 | UI 噪声/内存风险 | 继续由 Main 截断到 2000 字符，Renderer 只添加中文上下文，不回显任意命令参数。 |

## 7. 验证命令

```bash
# Renderer、Provider 与分支互斥
npm --prefix desktop-app test -- \
  src/renderer/src/components/right-workspace/review/CommitOrPushDialog.test.tsx \
  src/renderer/src/components/right-workspace/review/ReviewCommitControl.test.tsx \
  src/renderer/src/components/local-git-review/LocalGitReviewProvider.test.tsx \
  src/renderer/src/components/local-git-review/LocalBranchSwitcher.test.tsx

# Main push、schema 与 IPC
npm --prefix desktop-app test -- \
  src/main/localGit/LocalPushService.test.ts \
  src/main/localGit/localGitIpc.test.ts \
  src/shared/localGitApi.test.ts

# 首推稳定性：连续三次执行同一 suite，任一次失败即失败
for run in 1 2 3; do
  npm --prefix desktop-app test -- src/main/localGit/LocalPushService.test.ts || exit 1
done

# 两条关键 E2E
npm --prefix desktop-app run test:e2e -- --reporter=line --grep 'P004-E2E-19'
npm --prefix desktop-app run test:e2e -- --reporter=line --grep 'P004-E2E-15'

# 静态与全量桌面验证
npm --prefix desktop-app run typecheck
npm --prefix desktop-app run lint
npm --prefix desktop-app test
npm --prefix desktop-app run test:plan-coverage
npm --prefix desktop-app run test:e2e -- --reporter=line

# 收尾边界
git diff --check
rg 'CommitChangesDialog|commit-changes-dialog|Commit local changes before switching branches' desktop-app
git diff --name-only -- codex/codex-rs/app-server desktop-app/vendors/ai-sdk-provider-codex-asp
```

说明：最后两条 `rg`/`git diff --name-only` 的成功证据是“无输出”；`rg` 在零匹配时返回 1，应按零匹配解释，不与功能测试失败混淆。

## 8. 完成定义

只有同时满足以下条件，才能宣告上游 `commit-or-push-dialog-reference-parity-plan.md` 已完成开发：

1. AC-FIX-1 至 AC-FIX-8 全部满足。
2. `LocalPushService` 首推 suite 连续三次通过，non-fast-forward/timeout/output-limit 均有自动化证据。
3. `P004-E2E-19` 本地发布和 `P004-E2E-15` SSH push 都通过。
4. P0-04 覆盖报告为 20/20，完整 `test:plan-coverage` 退出码为 0。
5. typecheck、lint、全量 desktop test、全量 Electron E2E 均通过或有与本改动无关且经明确记录的外部阻塞；不得把未运行写成通过。
6. 旧 `CommitChangesDialog` 仍为零引用，禁止修改的 app-server/provider 目录无 diff。

