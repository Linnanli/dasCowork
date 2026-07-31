# Local Git 问题 1、2 参考项目对齐修复计划

## 目标与决策边界

本计划只覆盖原始评审中的两项：

1. **提交语义**：提交动作以执行提交时的最新工作区/暂存区为准，不再把此前读取到的 review snapshot 当作授权边界。
2. **Turn 改动撤回/重做语义**：按参考项目的顺序模型，从完整、有序的 `turn.items` 推进当前 cwd，并把每个成功的 `fileChange` 固化为独立批次；Undo 逆序应用，Reapply 原序应用。

明确不做：

- 不修改 `codex/codex-rs/app-server/`，也不扩展 Codex App Server Protocol。
- 不把问题 2 改写成普通 Review 面板的文件/区块 Revert。
- 不改动问题 3、4、5、6 的既有方案；其执行仍以
  `.omx/plans/local-git-review-findings-3-6-reference-parity-plan.md` 为准。
- 不移除 review、watch、文件级 mutation 仍需使用的 snapshot/revision 机制；只解除“提交”对 snapshot generation 的依赖。

## Requirements Summary

### 问题 1：提交当前最新工作区状态

- 当前提交请求携带 `snapshotGeneration`，提交服务在生成提交说明前后两次校验该 generation，见
  `desktop-app/src/shared/localGitApi.ts:442-460` 和
  `desktop-app/src/main/localGit/LocalCommitService.ts:18-50`。
- 当前 UI 在真正提交前重新读取 summary，只为取得一个 generation，再把它随请求发送，见
  `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.tsx:191-215`；对话框文案也把将要提交的内容描述成固定 snapshot，见
  `desktop-app/src/renderer/src/components/local-git-review/CommitChangesDialog.tsx:16-30,71-73`。
- 参考项目提交接口只传 cwd、message、`includeUnstaged` 等提交参数，不传 snapshot generation，见
  `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:34315-34335`。
- 参考项目在 `includeUnstaged=true` 时于 commit 前执行等价于 `git add -A` 的操作，然后提交并读取 HEAD，见
  `reference-projects/codex-electron-26.707.72221-beautified/.vite/build/worker.js:71931-72000`。
- 因此本项目应把提交说明生成视为辅助步骤，而不是冻结工作区；真正的提交集合由 commit 时刻的 index 决定：
  - `includeUnstaged=true`：在说明生成完成后，对最新工作区执行 `git add --all`，再提交。
  - `includeUnstaged=false`：不改工作区，只提交执行 commit 时的当前 index。

### 问题 2：按参考项目处理 Turn 撤回/重做坐标

- 当前历史恢复已经按 `turn.items` 顺序扫描：以 thread cwd 为初值，遇到 command 更新 cwd，遇到成功且非空的 fileChange 记录批次，见
  `desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-mapper.ts:224-279`。
- 当前实时映射则依赖通知到达顺序维护 `currentCwdByTurnId` 和
  `fileChangeBatchesByTurnId`，见
  `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:593-613,733-750,997-1012`；Turn 完成时直接消费这份可变状态，见
  `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:1296-1351`。
- `turn/completed` 自带 `Turn.items` 和 `itemsView`，其中 `itemsView` 明确区分
  `notLoaded | summary | full`，见
  `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/app-server-protocol/v2/Turn.ts:9-21`
  和
  `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/app-server-protocol/v2/TurnItemsView.ts:1-5`。
- 参考项目从稳定的 turn item 数组推导批次：command 的非空 cwd 推进当前 cwd，成功且非空的 patch 绑定当时 cwd，见
  `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~artifact-tab-content.electron~app-main~new-thread-panel-page~onboarding-page~pr~hoz4f1hh-Cy_DxrPd.js:57502-57522`。
- 参考项目在执行操作时把 Undo 批次逆序、Reapply 保持原序，并在首个失败处停止，见
  `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:61255-61279`。
- 当前 Main 已具备逐批次校验、Undo 逆序、Reapply 原序、逐批应用并遇错停止的主体行为，见
  `desktop-app/src/main/localGit/LocalGitService.ts:306-356`；每个 cwd 也会重新验证仍在受信仓库内，见
  `desktop-app/src/main/localGit/LocalGitService.ts:449-465`。本轮主要修复 provider 生成批次的来源与一致性，不复制 Main 逻辑。

## 方案概览

| 范围 | 当前行为 | 目标行为 | 主要落点 |
| --- | --- | --- | --- |
| Commit IPC | 请求绑定 `snapshotGeneration`，结果包含 `stale-snapshot` | 请求只表达 target/message/includeUnstaged；提交时读取最新状态 | `desktop-app/src/shared/localGitApi.ts`、IPC/preload 类型透传 |
| Commit service | 生成说明前后检查 snapshot；之后才 stage | 不检查 snapshot；说明完成后 stage 最新工作区并提交 | `desktop-app/src/main/localGit/LocalCommitService.ts` |
| Commit UI | 提交前刷新 summary 以铸造 generation；文案声称固定 snapshot | summary 只用于展示；明确提交时以最新状态为准 | `LocalBranchSwitcher.tsx`、`CommitChangesDialog.tsx` |
| Turn batch 构建 | 历史按 item 顺序；实时按通知时序 | 共用一个有序 item 扫描 helper | provider `protocol/turn-diff.ts`、`history-mapper.ts` |
| Turn 完成 | 始终使用通知累计批次 | `itemsView=full` 时完整 items 权威；非 full 时才兼容回退 | provider `protocol/event-mapper.ts` |
| Undo/Reapply | Main 已按批次方向和 cwd 执行 | 保持实现，补跨 cwd 回归证据 | `LocalGitService` tests / e2e |

## Acceptance Criteria

### AC-1：提交协议不再把 snapshot 当作提交前置条件

- `localCommitRequestSchema` 不再接受或要求 `snapshotGeneration`。
- `localCommitResultSchema` 不再暴露 commit 专属的 `stale-snapshot` 结果。
- preload、Main IPC handler 和 renderer 类型仍通过同一个 shared schema 校验，现有边界
  `desktop-app/src/main/localGit/localGitIpc.ts:115-119`、
  `desktop-app/src/preload/index.ts:349-353` 和
  `desktop-app/src/shared/codexIpcApi.ts:610-622` 不被绕过。
- review mutation、file revision、watch state 等其他 `snapshotGeneration` 使用点保持不变。

### AC-2：`includeUnstaged=true` 提交执行时的最新全部改动

- 打开 Commit 对话框后，再修改同一路径的文件内容，提交成功后 HEAD 中必须是修改后的最新字节。
- 提交说明由异步 generator 生成期间再次修改 tracked 文件或新增 untracked 文件，generator resolve 后执行的 `git add --all` 必须把这些最新变化一并提交。
- staging 失败返回结构化 `commit-failed`（包含可读错误），不得变成未处理的 IPC rejection。
- commit 成功后仍读取并返回 HEAD SHA，并维持 head/index/working-tree/untracked 缓存失效，现有位置为
  `desktop-app/src/main/localGit/LocalCommitService.ts:52-75`。

### AC-3：`includeUnstaged=false` 只提交执行时的当前 index

- 对同一文件先 stage 版本 A，再把工作区改成版本 B；提交后 HEAD 必须是 A，工作区仍保留未提交的 B。
- 在异步说明生成期间对 index 进行新的合法 stage，最终 commit 以生成完成后执行 commit 时的 index 为准。
- index 为空时返回 `nothing-to-commit`；`generation-failed`、`commit-failed` 和提交说明最大长度限制保持。

### AC-4：提交 UI 不再承诺固定 snapshot

- `LocalBranchSwitcher` 不再为了提交请求额外调用 `getSummary()` 生成 generation；summary 刷新只服务于变更数量展示。
- `CommitChangesDialog` 删除 `snapshotGeneration` prop。
- 对话框文案明确表达“提交时会使用最新状态”；变更数量只能作为当前展示值，不得描述为固定选择集。
- commit 成功后继续重试被阻塞的 branch continuation，原有
  `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.tsx:202-225`
  流程保持。

### AC-5：实时与历史 Turn 使用同一个顺序批次算法

- 在 provider 内只有一个纯函数负责从 ordered items 构造
  `FileChangeDiffBatch[]`；`history-mapper.ts` 和 `event-mapper.ts` 都调用它。
- helper 以 thread/turn 初始 cwd 为起点；command 只有在 cwd 非空时才更新当前 cwd。
- 只有状态非 `failed`、非 `declined` 且 `changes.length > 0` 的 fileChange 才生成批次。
- 同一组 ordered items 和初始 cwd，经实时完成路径和历史恢复路径得到的 `patchBatches` 必须逐项、逐字节相同。

### AC-6：完整 completed items 覆盖通知时序

- 当 `completed.turn.itemsView === "full"` 时，`completed.turn.items` 是最终权威来源，必须覆盖通知累计状态。
- 即使 `item/completed` 通知乱序、重复或曾出现但最终 full items 中不存在的 fileChange，最终批次仍严格按 full items 的数组顺序且不重复、不出现 ghost batch。
- full items 中没有 fileChange 时，即使通知缓存中有 fileChange，最终 completed turn diff 也不得携带 action patch batches。
- 当 `itemsView` 为 `summary`、`notLoaded` 或缺失（兼容旧 fixture/旧 server payload）时，才允许使用当前通知累计结果；该回退必须有独立测试。
- Turn 结束后两种路径都清理 `currentCwdByTurnId`、`fileChangeBatchesByTurnId` 和 item patch 暂存，避免跨 Turn 污染；当前清理点为
  `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:1342-1353`。

### AC-7：Undo/Reapply 的批次方向和受信边界不回退

- 两个 cwd 批次的 Reapply 按 `[A, B]` 执行，Undo 按 `[B, A]` 执行。
- 每批都重新验证 cwd 位于选定仓库且 `rev-parse --show-toplevel` 匹配；越界或 git root 不匹配时不应用任何未执行批次。
- 任一批次失败后停止后续批次，并保留已执行批次的聚合结果。
- 不新增 renderer 直连 Git、provider 复制 Main Git 安全逻辑或 app-server 改动。

## Implementation Steps

### 1. 先补问题 1 的回归测试，锁定“最新状态”语义

涉及：

- `desktop-app/src/main/localGit/LocalCommitService.test.ts:10-68`
- `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.test.tsx`
- `desktop-app/src/shared/localGitApi.test.ts`
- `desktop-app/tests/e2e/local-git-review.e2e.ts`

操作：

1. 把现有 “fresh snapshot generation” 用例改为“不需要 generation 即可提交当前 index”。
2. 新增同一路径在对话框打开后被再次修改的用例，分别覆盖
   `includeUnstaged=true` 和 `false`。
3. 用可控 Promise 阻塞 `generateMessage`，在 Promise resolve 前修改工作区/index，验证提交时刻语义。
4. 新增 `git add --all` 失败映射为 `commit-failed` 的单测。
5. 更新 renderer 测试，断言 commit 请求不包含 generation，且 commit 前不再为了 generation 强制刷新 summary。
6. 在 E2E 中打开分支切换 Commit 对话框后修改 fixture 文件，再提交并校验 HEAD 内容和分支重试成功。

停止条件：新测试能在旧实现上稳定暴露 snapshot 依赖或旧内容提交问题。

### 2. 收窄 commit IPC 合同，但保留其他 snapshot 合同

涉及：

- `desktop-app/src/shared/localGitApi.ts:442-461`
- `desktop-app/src/shared/localGitApi.test.ts`
- `desktop-app/src/main/localGit/localGitIpc.ts:115-119`
- `desktop-app/src/preload/index.ts:349-353`
- `desktop-app/src/shared/codexIpcApi.ts:610-622`
- 受类型影响的 renderer/Main tests

操作：

1. 从 `localCommitRequestSchema` 删除 `snapshotGeneration`。
2. 从 `localCommitResultSchema` 的 commit 状态集合删除 `stale-snapshot`。
3. 让 shared 类型自动向 Main/preload/renderer 传播；不另建重复 DTO。
4. 全仓检索 `snapshotGeneration`，只删除 commit callsite/test fixture 上的字段；保留 review snapshot、watch 和 file mutation 使用点。

停止条件：提交请求的类型和运行时 Zod 校验都拒绝额外 generation 字段，其他 Local Git API 的 snapshot 测试不变。

### 3. 对齐参考项目的 commit 执行顺序和 UI 语义

涉及：

- `desktop-app/src/main/localGit/LocalCommitService.ts:18-95`
- `desktop-app/src/main/localGit/LocalGitService.ts:359-368`
- `desktop-app/src/renderer/src/components/local-git-review/LocalBranchSwitcher.tsx:191-215,395-404`
- `desktop-app/src/renderer/src/components/local-git-review/CommitChangesDialog.tsx:16-73`

操作：

1. 删除 `LocalCommitService.commit()` 生成说明前后的
   `currentGenerationIsFresh()` 分支。
2. 说明为空时先生成并规范化 message；生成阶段不冻结提交集合。
3. `includeUnstaged=true` 时在 generator 完成后执行 `git add --all`，捕获 staging 错误并返回 `commit-failed`，然后检查 index、commit、读取 HEAD。
4. `includeUnstaged=false` 时跳过 staging，直接检查并提交当前 index。
5. `currentGenerationIsFresh()` 若全仓已无调用则删除；保留
   `computeWorkspaceStateHash()`，因为 review/watch 仍依赖它，现有实现位于
   `desktop-app/src/main/localGit/reviewSnapshot.ts:96-111`。
6. `LocalBranchSwitcher` 移除 commit 前为 generation 服务的 summary 请求和请求字段；保留打开对话框时的展示刷新。
7. `CommitChangesDialog` 移除 generation prop，改为“数量是当前展示值，提交时以最新状态为准”的用户文案。

停止条件：AC-1 至 AC-4 的单测和 E2E 通过，且 branch retry 行为未改变。

### 4. 提取参考项目式 ordered-item 批次 helper

涉及：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/turn-diff.ts:32-101`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-mapper.ts:224-279`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/history-mapper.test.ts:301-405`

操作：

1. 在 `protocol/turn-diff.ts`（或无循环依赖的同级小模块）导出纯函数，例如
   `fileChangeDiffBatchesForOrderedItems(items, initialCwd)`。
2. 按参考项目规则实现：初始 cwd → command 的非空 cwd 推进 → 成功且非空 fileChange 绑定当前 cwd。
3. 用该 helper 替换 `history-mapper.ts` 内部私有扫描实现，避免实时/历史各自维护一套规则。
4. 给 helper 补表驱动测试：初始 cwd、多个 cwd、command 无 cwd、failed、declined、empty changes。

停止条件：历史映射现有用例保持通过，且不再有第二份 ordered scan 实现。

### 5. 在 Turn 完成时优先使用 full items，保留受控兼容回退

涉及：

- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:593-613,733-750,997-1012,1296-1353`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/event-mapper.test.ts:2140-2339`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/history-mapper.test.ts:301-405`

操作：

1. `handleTurnCompleted()` 检查 `completed.turn.itemsView`：
   - `full`：调用 ordered-item helper，完全忽略通知累计批次。
   - `summary` / `notLoaded` / 缺失：使用现有通知累计批次作为兼容回退。
2. 不删除通知阶段的 patchUpdated 合并能力，因为非 full payload 仍需它；但将其明确限制为 fallback 数据源。
3. 新增乱序通知、重复 completion、ghost notification、full empty items 和 partial view fallback 测试。
4. 对同一 turn fixture 同时跑 live completed 与 historical mapper，直接断言最终
   `patchBatches` 深度相等。
5. 保留 Turn 完成后的所有 map 清理逻辑，并补连续两个 Turn 的污染回归测试。

停止条件：AC-5、AC-6 全部通过；full payload 结果不再受通知时序影响。

### 6. 验证 Main 的批次执行方向和仓库信任边界

涉及：

- `desktop-app/src/main/localGit/LocalGitService.ts:306-356,449-465`
- `desktop-app/src/main/localGit/LocalGitService.test.ts`
- `desktop-app/src/main/localGit/LocalGitService.integration.test.ts`
- `desktop-app/tests/e2e/local-git-review.e2e.ts`

操作：

1. 不重写已有生产逻辑；补/收紧测试记录两个批次的实际调用顺序。
2. Reapply 断言原序，Undo 断言逆序。
3. 覆盖第二批失败后停止、cwd 越界、asserted git root 不匹配。
4. 用 provider 生成的真实 `patchBatches` 形状贯通 renderer IPC 到 Main，避免只测手写 DTO。

停止条件：AC-7 有单元或集成级证据，且与问题 3—6 计划没有重复的生产改造。

### 7. 运行分层验证并检查计划覆盖

先运行最小集合，再运行全量：

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint

npm --prefix desktop-app run test
npm --prefix desktop-app run typecheck
npm --prefix desktop-app run lint
npm --prefix desktop-app run test:plan-coverage
npm --prefix desktop-app run test:e2e -- --reporter=line
```

补充静态检查：

```bash
rg -n "snapshotGeneration|stale-snapshot|currentGenerationIsFresh" \
  desktop-app/src desktop-app/tests
git diff --check
```

判定规则：

- provider 和 desktop 的 test/typecheck/lint 全绿。
- `test:plan-coverage` 能关联新增回归用例。
- E2E 证明对话框打开后的最新文件内容被按选项正确提交，并证明 Turn Undo/Reapply 的批次顺序。
- 最终检索只留下非 commit 场景的 snapshot/stale-snapshot 使用。

## Risks and Mitigations

### 风险 1：用户看到的数量与最终提交集合不同

原因：采用“提交时最新状态”后，对话框展示期间工作区仍可能变化。

缓解：

- 文案明确数量只是当前展示值，最终按 commit 时刻处理。
- 不用后台 summary 重新引入隐式锁定语义。
- E2E 覆盖对话框打开后的变更。

### 风险 2：生成提交说明期间工作区变化，说明与内容不完全匹配

原因：生成说明是异步操作，而需求明确选择提交最新状态。

缓解：

- 把生成说明定义为建议文本，不作为内容授权边界。
- 明确 stage 必须发生在 generator 完成之后。
- 用阻塞 generator 的测试固定该时序。
- 不为“说明严格对应内容”重新引入 snapshot gate；若未来产品要该能力，应设计显式预览/确认流程，而不是复用旧 generation。

### 风险 3：completed Turn 不是 full view

原因：恢复、旧服务或精简 payload 可能只给 summary/notLoaded。

缓解：

- 只有 `itemsView=full` 才覆盖通知缓存。
- 非 full/缺失保留当前通知累计回退，并独立测试。
- 不修改 app-server 协议，也不假定所有环境立刻提供 full view。

### 风险 4：共享 helper 引入 provider 模块循环依赖

原因：`history-mapper`、`event-mapper` 和 item 类型当前分散。

缓解：

- helper 放在 `protocol/turn-diff.ts` 或无副作用的同级模块，只依赖 type-only item 定义。
- typecheck 和 provider test 作为合并门禁。

### 风险 5：与问题 3—6 的 patch/root 改造冲突

原因：两个计划都触及 Turn patch 链路。

缓解：

- 本计划只决定 provider 如何构建 ordered `patchBatches`，Main 只补回归测试。
- 问题 3—6 继续拥有签名快照、历史持久化、原子/受信执行等更广范围。
- 执行时先落本计划 provider 批次语义，再让 3—6 方案复用该批次合同。

## Definition of Done

- 问题 1 的 commit 请求、服务和 UI 都不再依赖 snapshot generation。
- `includeUnstaged` 两种模式都由自动化测试证明采用执行提交时的最新 index/worktree 语义。
- 问题 2 的实时和历史路径共用一套参考项目式 ordered-item 批次算法。
- `itemsView=full` 的 completed Turn 对通知乱序、重复和 ghost item 稳定。
- 非 full payload 的兼容回退有明确测试。
- Undo/Reapply 的批次方向、失败停止和仓库信任边界有新鲜验证证据。
- 不修改 app-server，不越过 preload/shared schema/Main 分层，不改变问题 3—6 的既有范围。
