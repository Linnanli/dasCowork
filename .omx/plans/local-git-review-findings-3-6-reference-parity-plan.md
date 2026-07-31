# 本地 Git 审核第 3、4、5、6 项参考一致性修复计划

## 1. 结论与执行边界

本计划修复当前未提交改动审查中编号 3、4、5、6 的四个问题，并以
`reference-projects/codex-electron-26.707.72221-beautified/` 的可观察行为为准：

1. section 级 stage / unstage / revert 必须作用于当前审核 section 的完整文件集合，而不是当前选中的单个文件。
2. 缓存失效后，失效前仍在执行的 Promise 不能被新读取复用，也不能在完成后重新成为有效缓存。
3. turn patch 的 Undo / Reapply 必须由会话历史中的持久 `patchBatches` 驱动，应用重启后仍可执行，不能依赖 Main 进程内存注册表。
4. Codex Review 必须作为一条独立的纯文本消息直接发送；不得改写 Composer 草稿、夹带附件或借普通 Send 间接提交。

本轮实施禁止修改 `codex/codex-rs/app-server/`，禁止绕过 Codex app server，禁止新增依赖。Renderer 新增或变更的桌面能力仍必须经过 shared schema、preload 和 Main IPC；已有 IPC 能表达参考行为时不创建同义接口。

本计划是针对第 3—6 项的收口计划。若它与既有
`.omx/plans/p0-04-local-git-review-and-recovery-reference-parity.md`
中“section 可 partial-success”或“turn patch 依赖进程内注册表”等旧表述冲突，以本计划的参考行为和验收条件为准。

完成条件：第 3—6 项的单元、集成和 E2E 验收全部通过；lint、typecheck、测试计划覆盖门禁通过；没有残留 `TurnPatchRegistry` 运行时依赖；没有修改 app-server。

## 2. 参考项目行为与当前差距

| 项目 | 参考项目行为 | 当前实现 | 修复决策 |
| --- | --- | --- | --- |
| 3. section 操作 | Renderer 将当前 section 的完整 `files[]`（含 revision）发送到专用写操作；worker 清缓存、重读并逐文件校验后一次应用完整 patch。参考：`webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:30750,31036`、`.vite/build/worker.js:67604` | `LocalGitReviewPanel.tsx:227-251` 无论 scope 都只发送 `selectedFile`；Main 虽可处理多文件，却未证明 section 集合与签发快照完全一致。 | 保留现有 `applyReviewAction` IPC 和 `scope: 'section'`，但把 section 定义为“签发快照的完整且精确文件集合”；file/hunk 仍是严格单文件。 |
| 4. 缓存失效竞态 | 缓存和审核快照带 generation；失效后的新读取不接受旧 generation 的 pending 结果；旧结果不能回写；stale snapshot 触发刷新/重试。参考：`.vite/build/worker.js:62157,64980,71427`、`webview/assets/app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-CrA1-JEm.js:90419-90429` | `GitReadCache.ts:62` 在检查 `invalidated` 前直接复用 pending Promise。`WorktreeRepository` 的 all-untracked 已有独立 generation，不应重写。 | 给通用 `GitReadCache` 增加 entry 身份/generation 护栏；保留并回归验证现有 untracked generation。 |
| 5. 历史 Undo / Reapply | completed turn 的 `{cwd,diff}` batches 保存在 turn diff；历史 UI 直接取出 batches，Undo 逆序、Reapply 原序执行，不依赖 worker 内存。参考：`webview/assets/app-initial~artifact-tab-content.electron~app-main~new-thread-panel-page~onboarding-page~pr~hoz4f1hh-Cy_DxrPd.js:57503`、`webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:61172-61282` | Provider 和历史 mapper 已产出 `patchBatches`，Renderer 也能解析；但 IPC 仅发送 `turnId`，Main 从 `TurnPatchRegistry` 查进程内数据，重启后返回 `turn-patch-unavailable`。 | 把严格受限的 `batches` 放入 shared 请求；Main 将 Renderer 请求视为不可信输入并重新验证；删除内存注册表及捕获旁路。 |
| 6. Review 发送 | Review action 标记 `requiresEmptyComposer: true`；inline 直接向当前 host 启动一条仅含 review prompt 的 turn，detached 创建新会话后发送相同纯文本。参考：`webview/assets/app-initial~app-main~page-DRgkI91I.js:42887-42890`、`webview/assets/review-mode-content-CRO4r5jd.js:181` | `App.tsx:2797-2801` 先 `composer.setText(prompt)` 再调用普通 `send()`，会覆盖草稿并携带 Composer 附件。 | inline 和 detached 都调用 conversation controller 的 `sendMessage()`，只传一个 text part；Review mode 强制空 Composer，并在提交时再次校验。 |

## 3. Requirements Summary

### 3.1 功能要求

- section stage / unstage / revert 对快照中该 source 的全部文件生效，不能受当前选中文件影响。
- section 请求必须防止缺文件、多文件、重复文件、偷换路径、旧 revision 和旧 generation。
- 同一代的并发 Git read 继续去重；失效后的读取必须进入新一代，旧请求不能污染新一代。
- completed turn 的完整 patch batches 继续由 provider 构造并通过历史消息恢复；刷新或重启应用后 Undo / Reapply 仍可用。
- Undo 按 batch 逆序、Reapply 按原序；首个失败后停止，保持现有结果语义。
- Review 入口仅在 Composer 文本和附件均为空时可用；inline 和 detached 都只发送生成的 review prompt。
- Review 失败时保留选择界面、错误信息、原草稿和原附件，不产生半提交状态。

### 3.2 安全与架构要求

- Main 不信任 Renderer 传入的 `files`、`cwd`、`gitRoot` 或 `diff`。
- 每个 review 文件必须属于 Main 签发的 snapshot record；每个 turn patch cwd 必须位于 conversation 绑定的可信 Git root 内。
- `gitRoot` 只作为一致性断言，不能用来选择执行目录；Main 必须用 `rev-parse --show-toplevel` 再确认 cwd 没有落入嵌套仓库或工作区外。
- patch 必须经过现有 `validateGitPatch()`；拒绝绝对路径、`..`、NUL、越界路径和超限内容。
- 保持 `assistant-ui -> ElectronIpcChatTransport -> Main -> provider -> Codex app-server` 链路，不新增独立 LLM client 或 review 专用模型旁路。

### 3.3 非目标

- 不重写 GitManager、WorktreeRepository 或现有 review snapshot 架构。
- 不把参考项目的混淆类名、内部 transport 名称或 UI 样式逐字复制到本项目。
- 不修改 branch、commit、watcher 等与第 3—6 项无直接关系的行为。
- 不以“Renderer 已经从可信 provider 收到数据”为由放宽 Main 的输入验证。

## 4. Testable Acceptance Criteria

### AC-03：section 是完整快照集合

- AC-03-01：当 unstaged/staged 快照含至少 2 个文件，点击任一文件后执行 `Stage section`、`Unstage section` 或 `Revert section`，Renderer 请求中的 `files` 与当前 snapshot 的 `files` 在 path、previousPath、revision 上完全一致，且不依赖 `selectedFile`。
- AC-03-02：`scope: 'file'` 和 `scope: 'hunk'` 只允许一个文件；hunk 必须有 `hunkIndex`；非 hunk 请求不得携带 `hunkIndex`。
- AC-03-03：Main 对所有 scope 先确认请求文件存在于 snapshot record 且签发信息一致；section 还必须确认路径集合精确相等。子集、超集、重复路径、被篡改的 previousPath/revision 均返回 `stale-snapshot` 或明确的 schema 错误，并且不执行 Git 写入。
- AC-03-04：section 中任一文件在写前 revision 已变化时，整个操作拒绝；其他文件不得部分写入。
- AC-03-05：2 个以上文件的真实仓库集成测试证明一次 section stage / unstage / revert 的所有目标均发生预期变化。

### AC-04：失效中的 Promise 不会陈旧回流

- AC-04-01：同 key、同有效 entry 的两个并发 `fetch()` 仍只调用一次 loader。
- AC-04-02：第一个 loader pending 时调用 `invalidate()`，随后同 key 的 `fetch()` 必须创建/复用新 entry，不能返回旧 Promise。
- AC-04-03：旧 loader 在新 loader 之后成功、失败或更晚结束，都不能覆盖、清空或重新验证新 entry。
- AC-04-04：失效前已经等待旧 Promise 的调用方最终得到当前 generation 的新结果，或得到可识别的 stale 后自动重读；不能把失效前结果当作操作后的当前状态交给上层。
- AC-04-05：`invalidateWhere()` 具有相同语义；定向 invalidation 不影响其他 key。
- AC-04-06：`WorktreeRepository.listUntrackedPaths()` 现有独立 generation 测试继续通过，且旧 all-untracked 结果不能在 working-tree invalidation 后重新写回。

### AC-05：历史 turn patch 不依赖进程内存

- AC-05-01：`TurnPatchRequest` 携带 `turnId`、`action` 和至少一个 `batch`；batch 包含绝对 `cwd`、可选绝对 `gitRoot`、未截断 `diff`。
- AC-05-02：Renderer 从当前或历史 `turnDiff.patchBatches` 生成请求；不能用 preview/truncated diff 执行恢复。
- AC-05-03：关闭并重启 Electron Main、重新加载历史会话后，已完成 turn 的 Undo 仍成功；随后 Reapply 也成功，证明流程不依赖 `TurnPatchRegistry`。
- AC-05-04：Main 逐 batch 验证可信 target、cwd 边界、git root、patch 路径、单 batch 大小、batch 数量和总字节数；任一验证失败时不执行该请求的任何 Git 写入。
- AC-05-05：Undo 逆序、Reapply 原序；应用阶段首个失败后停止后续 batch，并准确返回 applied/skipped/conflicted。
- AC-05-06：进程代码中不再创建、注入、读取或写入 `TurnPatchRegistry`，也不再从 live stream 额外捕获 completed turn patch。
- AC-05-07：根目录、仓库子目录、多 batch、嵌套仓库、工作区外 cwd、伪造 gitRoot、路径遍历和超限总 payload 均有测试。

### AC-06：Review 直接发送且不污染 Composer

- AC-06-01：Composer 有非空文本或任一附件时 Review 不可启动；空白文本且无附件才视为空。
- AC-06-02：进入 Review mode 后，Add context 和普通 Send 不可用于注入内容；提交瞬间再次检查 Composer 为空，避免模式打开后的竞态。
- AC-06-03：inline Review 对当前 conversation controller 调用一次 `sendMessage()`，消息只有 `{type:'text', text: prompt}`；不调用 `composer.setText()` 或 `composer.send()`。
- AC-06-04：detached Review 创建/选择新 conversation 后使用同一纯文本 prompt 合同，不携带当前 Composer 的草稿或附件。
- AC-06-05：Review prompt 仍由 `buildCodeReviewPrompt()` 生成，后端仍通过现有 transport/provider/app-server 链路收到普通 turn。
- AC-06-06：发送失败时 Review mode 保持可见并显示错误，草稿和附件保持原样；成功后才关闭 Review mode。
- AC-06-07：E2E 证明后端收到的 review 请求包含 prompt 的唯一标记，不包含预先放入 Composer 的草稿标记或附件标记。

## 5. Implementation Steps

### Step 0：先锁定四个回归，再改生产代码

目标：先让问题以最小失败测试稳定复现，防止修复过程中误改已通过行为。

1. 在 `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewPanel.test.tsx:82-130` 增加多文件 section 用例，当前实现应因只发送 selected file 而失败。
2. 在 `desktop-app/src/main/localGit/GitReadCache.test.ts:31-48` 增加 deferred loader + invalidate + second fetch 的确定性竞态用例，当前实现应因复用旧 Promise 而失败。
3. 在 `desktop-app/src/main/localGit/localGitIpc.test.ts` 增加“仅有历史 batches、无 registry”用例；在 `desktop-app/tests/e2e/local-git-review.e2e.ts:389-557` 增加 reload/relaunch 后 Undo / Reapply 用例。
4. 在 `desktop-app/src/renderer/src/App.test.tsx:1877-1920` 增加 inline review 不调用 `setText`、不携带附件、草稿不变的用例；在 `ComposerReviewMode.test.tsx` 增加空 Composer 门禁用例。
5. 只有上述测试按预期失败，才进入相应生产修改；每一项单独转绿，避免一次大改掩盖回归来源。

### Step 1：把 section 请求改为完整且精确的 snapshot 文件集

涉及文件：

- `desktop-app/src/shared/localGitApi.ts:235-274`
- `desktop-app/src/shared/localGitApi.test.ts:120-154`
- `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewPanel.tsx:227-269,620-672`
- `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewPanel.test.tsx`
- `desktop-app/src/main/localGit/LocalGitService.ts:226-280,409-428`
- `desktop-app/src/main/localGit/LocalGitService.test.ts`
- `desktop-app/src/main/localGit/localGitIpc.test.ts`

实施顺序：

1. 收紧 `localGitReviewMutationRequestSchema`：
   - section 允许 `1..500` 文件；
   - file/hunk 必须恰好 1 个文件；
   - hunk 仅在 `scope === 'hunk'` 时允许且必须携带 `hunkIndex`；
   - schema 层拒绝重复 path，降低 Main 分支复杂度。
2. 将 `LocalGitReviewPanel.applyAction()` 分成明确的 scope 分支：
   - section 从当前 `snapshot.files` 映射 `{path, previousPath, revision}`；
   - file/hunk 才依赖 `selectedFile`；
   - section 即使当前没有选中文件，只要快照非空也可执行。
3. 在 `LocalGitService.mutateReview()` 内新增 snapshot target 校验助手：
   - 所有请求文件先与 `record.files` 比较 path、previousPath、revision；
   - section 比较完整路径集合，不能只逐项验证传入子集；
   - file/hunk 验证单个目标确实属于该 snapshot；
   - 校验失败统一在清缓存/运行 Git 写命令前返回 stale。
4. 保留写前 `clearShortLivedGitReadCaches()` 和逐文件 `computeFileRevision()`；section 中任何一个 revision 漂移时整体退出。
5. `patchForMutation()` 继续为每个文件生成 patch 后合并，并一次交给现有 atomic `git apply`。不要把 section 拆成逐文件写入，避免与参考项目的全体 revision 校验语义冲突。
6. mutation 成功后沿用现有 invalidation/affected paths 处理；结果路径必须覆盖完整 section 实际改动文件。

### Step 2：修复 GitReadCache 的 generation / entry 身份语义

涉及文件：

- `desktop-app/src/main/localGit/GitReadCache.ts:26-112`
- `desktop-app/src/main/localGit/GitReadCache.test.ts`
- `desktop-app/src/main/localGit/GitManager.ts:242-330,410-439`
- `desktop-app/src/main/localGit/GitManager.test.ts:411-438`

实施顺序：

1. 为内部 entry 增加单调 generation 或唯一 token；外部 metadata 合同不需要暴露实现细节。
2. `fetch()` 只在 entry 未 invalidated 且未过期时复用 `promise` 或 `data`；把 invalidation/staleness 判断放在 pending Promise 复用之前。
3. loader resolve/reject 时先确认 `entries.get(keyId) === entry` 且 entry 未 invalidated：
   - 只有当前 entry 可以写 data/清 promise；
   - 旧 entry 的成功不能覆盖新 data；
   - 旧 entry 的失败不能删除新 entry。
4. 对失效时已经等待旧 Promise 的调用方采用“完成后检查 token，若已失效则调用/复用当前 generation 的 `fetch()`”的语义，确保上层不会收到失效后的旧状态。重读必须共用新 entry，避免 N 个旧 waiter 触发 N 次命令。
5. `invalidate()` 和 `invalidateWhere()` 只使匹配 entry 进入不可复用状态，不影响其他 key；保留 metadata 供诊断/匹配使用。
6. 不删除或重复实现 `WorktreeRepository.listUntrackedPaths()` 的专用 generation；用现有测试确认通用缓存修复不会破坏 all-untracked 的去重和失效重读。

### Step 3：让 turn patch 由历史消息持久数据驱动

涉及文件：

- `desktop-app/src/shared/localGitApi.ts:287-297`
- `desktop-app/src/shared/localGitApi.test.ts:157-180`
- `desktop-app/src/preload/index.ts` 及 preload 类型测试
- `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx:458-493,595-604`
- `desktop-app/src/main/localGit/localGitIpc.ts:21-102`
- `desktop-app/src/main/localGit/LocalGitService.ts:302-343,431-448`
- `desktop-app/src/main/localGit/LocalGitService.test.ts`
- `desktop-app/src/main/localGit/localGitIpc.test.ts`
- `desktop-app/src/main/localGit/TurnPatchRegistry.ts`
- `desktop-app/src/main/localGit/TurnPatchRegistry.test.ts`
- `desktop-app/src/main/index.ts:74,136,251,497-522`
- `desktop-app/src/main/codexChatRuntimeService.ts:208,254,291,802-813,2424-2445`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/turn-diff.ts:11-101`
- `desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-mapper.ts:224-279`
- `desktop-app/tests/e2e/local-git-review.e2e.ts:389-557`

实施顺序：

1. 在 shared 层定义 `turnPatchBatchSchema`，字段为 `cwd`、可选 `gitRoot`、`diff`；为 batches 设置明确的最大数量、单 batch 字符/字节上限和总 payload 上限（与 provider 当前 2 MiB 完整 action patch 上限一致）。用 `superRefine` 计算总量，不能只依赖单字段 max。
2. 扩展 `turnPatchRequestSchema` 为 `{target, action, turnId, batches}`。修改当前“batches 应被 strict schema 拒绝”的测试，使其改为验证合法持久 batches 可通过、非法/超限 payload 被拒绝。
3. Renderer 使用已存在的 `turnPatchBatches(item)` 结果调用 `applyTurnPatch()`；当历史 item 没有完整 batches、diff 被标记截断或解析失败时禁用按钮并显示不可恢复原因，不退回 preview。
4. IPC 只做 schema parse 和可信 target 路由，不再按 turnId 查询 registry。`turnId` 保留为 UI/日志关联标识，不作为补丁内容的权威来源。
5. `LocalGitService.applyTurnPatch()` 接收经过 schema 初筛的 batches，但仍逐个执行安全验证：
   - target 解析出的 repository 是唯一可信 root；
   - cwd 为绝对路径且在 root 内；
   - asserted gitRoot 与可信 root 一致；
   - cwd 的 `rev-parse --show-toplevel` 必须等于可信 root；
   - `validateGitPatch()` 通过；
   - 在开始任何写入前先完成全部 batch 的验证和归一化，避免第 N 批验证失败时前 N-1 批已经写入。
6. 验证全部通过后沿用现有顺序：Undo 对 batches reverse 后 reverse apply；Reapply 原序 forward apply；应用失败继续遵守首错停止。
7. 删除 `TurnPatchRegistry.ts` 及其专属测试，移除 `main/index.ts` 的创建/注入，移除 `codexChatRuntimeService.ts` 的 `recordTurnPatch`、`extractCompletedTurnPatch()` 和 live stream 捕获逻辑，移除 IPC registry 参数。
8. 保留 provider 的 `turn-diff.ts` 和 `history-mapper.ts` 作为唯一持久批次生产/历史重建路径，只补测试证明 live 与 historical 生成相同结构和完整性上限；不要新增 Main 第二份协议转换。
9. E2E 通过真实 UI 打开历史 turn，在 Electron reload 或 Main relaunch 后依次 Undo / Reapply，并校验磁盘内容；这项是删除 registry 后的必过验收，不可用同进程刷新替代。

### Step 4：让 inline Review 直接发送纯文本 turn

涉及文件：

- `desktop-app/src/renderer/src/App.tsx:234,580-595,644-823,2645-2804,3023-3057,3083-3151`
- `desktop-app/src/renderer/src/App.test.tsx:331-343,794-811,1877-1920`
- `desktop-app/src/renderer/src/components/local-git-review/ComposerReviewMode.tsx`
- `desktop-app/src/renderer/src/components/local-git-review/ComposerReviewMode.test.tsx`
- `desktop-app/src/renderer/src/lib/codeReviewPrompt.ts` 及现有测试
- `desktop-app/tests/e2e/local-git-review.e2e.ts:930-1032`

实施顺序：

1. 在当前 conversation 层新增 `onStartInlineReview(prompt)` callback，绑定当前 `entry.controller`，通过现有 `runTranscriptAction`/错误状态包装调用：
   ```ts
   entry.controller.sendMessage({
     role: 'user',
     parts: [{ type: 'text', text: prompt }]
   })
   ```
   detached callback 继续使用对应新 conversation 的 controller，并与 inline 共用消息构造助手，防止两条路径漂移。
2. 将 callback 经 `ActiveConversationPane`、`ChatThread`、`ComposerProps` 传到 Composer；不要新增 IPC，因为 controller 已经走标准 chat transport。
3. 改写 `submitCodeReview()`：
   - 提交前重新计算/读取 Composer text 和 attachments，非空则显示错误并退出；
   - 根据 delivery await inline 或 detached callback；
   - 仅成功后关闭 Review mode；
   - 删除 `aui.composer().setText(prompt)` 和延迟 `aui.composer().send()`。
4. Review 按钮在 `hasComposerContent`、editing follow-up 或 thread running 时禁用，并提供非程序员可理解的说明。
5. Review mode 打开期间隐藏/禁用 Add context 与普通 Send，避免进入模式后再添加附件；关闭模式后原 Composer 控件和状态恢复。
6. 单测使用唯一 draft/attachment marker：断言 controller 只收到一个 prompt text part，`setTextCalls`/普通 send 为零，失败与成功分支的 mode/draft 状态符合 AC-06。
7. E2E 先放入草稿与附件证明 Review 被阻止且内容保留；清空后执行 inline Review，拦截后端请求并证明只含 review prompt。保留 detached 现有用例，并增加同样的纯文本断言。

### Step 5：集成、测试计划登记和清理

涉及文件：

- `desktop-app/tests/test-plan-coverage.json`
- 上述所有新增/修改测试
- `.omx/plans/local-git-review-findings-3-6-reference-parity-plan.md`

实施顺序：

1. 给新增 E2E 场景分配稳定、唯一的 test title/tag，并登记到 `desktop-app/tests/test-plan-coverage.json`；不删除或弱化现有断言来换取门禁通过。
2. 搜索并清除 `TurnPatchRegistry`、`recordTurnPatch`、`extractCompletedTurnPatch` 的生产引用和死类型。
3. 搜索 Review 发送路径，确认不存在 `setText(prompt)`、review 专用 `composer.send()` 或附件拼接。
4. 搜索 section 操作，确认没有 `scope === 'section'` 仍构造单文件数组的路径。
5. 对所有修改文件执行格式/lint 修正；不格式化无关的用户改动。

## 6. 文件级变更清单

| 文件/模块 | 计划变更 | 必要测试 |
| --- | --- | --- |
| `desktop-app/src/shared/localGitApi.ts` | 收紧 review scope 判别；新增严格 turn patch batch/payload schema | `localGitApi.test.ts` |
| `LocalGitReviewPanel.tsx` | section 使用完整 snapshot files；file/hunk 使用 selected file | `LocalGitReviewPanel.test.tsx` 多文件请求 |
| `LocalGitService.ts` | snapshot 精确集合校验；turn batches 全量预验证后按序应用 | 单元 + 真实仓库集成 |
| `GitReadCache.ts` | invalidated pending 不复用；旧 entry 不可回写；旧 waiter 重读当前 generation | deferred 竞态矩阵 |
| `GitManager.ts` | 原则上不改生产逻辑；仅在测试暴露专用 untracked generation 缺口时做最小修正 | 已有 all-untracked race 测试 |
| `renderUnitDetails.tsx` | 将历史 item 的完整 batches 放入 IPC 请求；无完整数据时禁用 | Renderer render-unit 测试 |
| `localGitIpc.ts` | 移除 registry lookup，转发经 schema 校验的 batches | IPC 无 registry 测试 |
| `TurnPatchRegistry.ts` | 删除 | 由历史 reload E2E 替代专属内存测试 |
| `main/index.ts`、`codexChatRuntimeService.ts` | 删除 registry 注入与 live patch 捕获旁路 | Main/runtime 现有回归测试 |
| provider `turn-diff.ts`、`history-mapper.ts` | 保持持久批次唯一来源，仅补完整性/历史一致性测试 | provider unit tests |
| `App.tsx` | direct inline send、空 Composer 门禁、成功后关 mode | `App.test.tsx`、`ComposerReviewMode.test.tsx` |
| `local-git-review.e2e.ts` | 多文件 section、relaunch 后 Undo/Reapply、pure-text Review | Playwright 定向场景 |

## 7. 风险与缓解

### 风险 1：Renderer 携带原始 patch 扩大了 IPC 攻击面

缓解：参考方案依赖历史 turn item，但本项目 Main 必须继续按不可信输入处理。shared 限制结构/数量/总量；Main 在任何写入前完成所有 batches 的 repository/cwd/gitRoot/patch 路径验证；target 绑定的可信 root 始终拥有最终决定权。补伪造和越界测试，不能只测 happy path。

### 风险 2：section 大集合 patch 可能变大或包含部分不适用文件

缓解：沿用现有最多 500 文件、patch 上限、`validateGitPatch()` 和原子 `git apply`；完整 revision 校验先于 patch 应用。若 patch 超限或任一文件漂移，整次操作失败并要求刷新，不退化为逐文件 partial success。

### 风险 3：通用缓存自动重读可能递归或重复触发 loader

缓解：重读必须经同一个 key 的当前 entry 去重，使用循环/明确的 generation handoff 而不是无界递归；测试旧 waiter 数量大于 1、旧成功/旧失败和连续两次 invalidate。

### 风险 4：删除 registry 后旧历史没有 patchBatches

缓解：UI 对缺失/截断 batches 明确显示不可恢复，不猜测或重新生成 patch；只对 provider/history mapper 已持久化完整 batches 的 turn 启用 Undo。现有旧数据兼容性采用“安全禁用”，不保留不可靠的进程内 fallback。

### 风险 5：Review 空 Composer 门禁可能让入口看似失效

缓解：按钮禁用态给出“先发送或清空当前草稿/附件”的可理解提示；不会自动删除用户内容。关闭 Review mode 后普通 Composer 完整恢复。

### 风险 6：当前工作区已有大量未提交改动

缓解：按步骤小批修改；每批先读取目标 diff；不重置、不覆盖无关文件；只格式化触及文件。实现提交应按 3/4/5/6 四个可独立 review 的逻辑批次组织，即使最终不立即创建 Git commit。

## 8. Verification Steps

### 8.1 定向单元/集成测试

```bash
npm --prefix desktop-app test -- src/shared/localGitApi.test.ts
npm --prefix desktop-app test -- src/main/localGit/GitReadCache.test.ts src/main/localGit/GitManager.test.ts
npm --prefix desktop-app test -- src/main/localGit/LocalGitService.test.ts src/main/localGit/localGitIpc.test.ts
npm --prefix desktop-app test -- src/renderer/src/components/local-git-review/LocalGitReviewPanel.test.tsx
npm --prefix desktop-app test -- src/renderer/src/components/local-git-review/ComposerReviewMode.test.tsx src/renderer/src/App.test.tsx
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test -- src/protocol/turn-diff.test.ts src/history-mapper.test.ts
```

如果 provider 实际测试文件名不同，先用 `rg --files desktop-app/vendors/ai-sdk-provider-codex-asp/src | rg '(turn-diff|history-mapper).*test'` 解析真实路径，再运行对应定向命令，不创建同义重复测试文件。

### 8.2 静态门禁

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
```

### 8.3 全量与测试计划门禁

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test
npm --prefix desktop-app test
npm --prefix desktop-app run test:plan-coverage
```

### 8.4 E2E

先跑三组定向场景，再跑完整 E2E：

```bash
npm --prefix desktop-app run test:e2e -- --reporter=line --grep "section|Undo.*reload|Reapply.*reload|inline review|detached review"
npm --prefix desktop-app run test:e2e -- --reporter=line
```

E2E 必须至少提供以下证据：

- 多文件 section 操作前后真实 index/worktree 状态；
- Main relaunch 或等价完整应用重启前后，历史 turn Undo / Reapply 的文件内容；
- inline/detached Review 后端收到的消息 parts，证明无草稿/附件 marker；
- stale revision、越界 cwd、恶意 patch、超限 payload 均未产生磁盘写入。

### 8.5 结构清理检查

```bash
rg -n "TurnPatchRegistry|recordTurnPatch|extractCompletedTurnPatch" desktop-app/src
rg -n "setText\(prompt\)|scope === 'section'" desktop-app/src/renderer/src
git diff --check -- desktop-app .omx/plans/local-git-review-findings-3-6-reference-parity-plan.md
```

第一条在生产代码中应无结果；第二条中的 Review `setText(prompt)` 应无结果，section 命中必须人工确认构造的是完整 snapshot files；`git diff --check` 必须无 whitespace error。

## 9. 推荐实施顺序与停点

1. 第 3 项：shared + Renderer + Main snapshot 校验 + 多文件测试。
2. 第 4 项：通用 cache generation 修复 + 竞态矩阵。
3. 第 5 项：先扩合同和安全测试，再切 Renderer/Main，最后删除 registry 并跑 relaunch E2E。
4. 第 6 项：direct send + empty composer gate + unit/E2E。
5. 全量静态门禁、测试计划覆盖和 E2E。

每一步都必须能独立回归；第 5 项不得在历史 reload E2E 通过前删除最后一个可诊断证据。最终只有在第 8 节全部通过或明确记录无法执行的环境性门禁后，才可宣称第 3、4、5、6 项修复完成。
