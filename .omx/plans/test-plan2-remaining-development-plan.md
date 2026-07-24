# `docs/test-plan2.md` 未完成项开发计划

## 1. 目标与完成定义

本计划只处理静态审计确认仍未完成或证据不足的部分，不重复已经具备实现和测试的工作。

最终完成必须同时满足：

1. Steer 在“turn 已终止、RPC 随后明确拒绝”的竞态下，保存正确的队列状态，不再误记为“结果不确定”。
2. 覆盖校验器只能接受真实测试声明，测试名只出现在注释或普通字符串中时必须失败。
3. G12 的单元测试与完整桌面链路测试被标记为正确的测试层级。
4. D18 明确证明手动重试创建了新的 turn、call ID 和 approval ID，旧审批不能复用，批准前工具没有执行。
5. MessagePort 的 12 路并发清理在真实 renderer → preload → IPC → main 链路上有证据，而不是只依赖假 MessagePort 单元测试。
6. 普通聊天的文件、文件夹和图片在发送、切换对话、页面重载后仍可恢复，并且重载不会再次请求模型。
7. Provider、Desktop、Mock E2E、10 次稳定性门禁全部通过；R01–R06 只有在 packaged artifact 真实执行成功后才能改为 `covered`。

## 2. 当前状态

| 分类 | 当前判断 | 主要证据 |
| --- | --- | --- |
| 明确代码缺陷 | B06 的 terminal 先到时会提前按 `recovery-uncertain` 结算，随后 RPC 的明确拒绝无法改正状态 | `desktop-app/src/main/codexChatRuntimeService.ts:913`、`:1352`；测试 `desktop-app/src/main/codexChatRuntimeService.test.ts:3170` 只断言结算次数 |
| 明确校验缺陷 | 覆盖校验只做全文包含判断，注释和普通字符串也能伪装成测试 | `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:360`；fixture 在 `desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs:207` 只写注释 |
| 明确覆盖标注错误 | G12 把 Vitest 单元测试标成 `mock-e2e`，且没有引用已有的真实桌面 E2E | `desktop-app/tests/test-plan-coverage.json:3500`；真实 E2E 在 `desktop-app/tests/e2e/diagnostics.e2e.ts:14` |
| 关键证据不足 | D18 比较了 call ID 和 approval ID，但没有抽取并比较两次 turn ID，也没有主动验证旧审批响应失效 | `desktop-app/tests/e2e/approvals.e2e.ts:454` |
| 跨层证据不足 | 12 路并发清理只在假 MessagePort 单测中证明；真实 E2E 只覆盖单流 port close | `desktop-app/src/preload/chatStreamBridge.test.ts:246`、`desktop-app/tests/e2e/fault-injection.e2e.ts:129` |
| 历史证据不足 | 附件测试覆盖发送和切换对话，没有页面重载后的恢复断言 | `desktop-app/tests/e2e/chat.e2e.ts:307` |
| 外部验收未完成 | R01–R06 均为 `partial` | `desktop-app/tests/test-plan-coverage.json:3978` |

## 3. 范围与约束

- 允许修改：`desktop-app/`、`desktop-app/tests/`、覆盖清单、验证脚本和必要的 E2E 专用诊断接口。
- 禁止修改：`codex/codex-rs/app-server/`。
- 不新增模型请求路径，不绕过 Provider 和 Codex App Server。
- 不新增依赖；覆盖校验器使用 Node 内置能力实现。
- E2E 专用状态只在 `DASCOWORK_E2E_USER_DATA_DIR` 存在时暴露，且只包含计数、终态和不透明 ID，不包含 prompt、工具参数、模型配置或凭据。
- 每个行为修复先补能失败的回归测试，再修改实现。
- 本计划不把“测试文件存在”或“测试名存在”视为完成，必须核对测试层级和断言内容。

## 4. 开发顺序

### 阶段 A：修复覆盖校验器和 G12 标注

涉及文件：

- `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:360`
- `desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs:23`
- `desktop-app/tests/test-plan-coverage.json:3500`
- `desktop-app/tests/e2e/support/app.test.ts:5`
- `desktop-app/tests/e2e/diagnostics.e2e.ts:14`

实施步骤：

1. 在校验器中增加 `extractDeclaredTestNames(source)`，从真实 `test(...)`、`it(...)`、`test.each(...)(...)`、`it.each(...)(...)` 声明中提取静态测试名。
2. 提取过程必须忽略行注释、块注释、普通变量字符串和 `describe(...)` 标题；支持单引号、双引号和无动态表达式的模板字符串。
3. 表格测试允许保留 `$phase` 等 Vitest 模板占位符；无法静态确定名称的动态表达式不得作为覆盖证据。
4. 将 fixture 从“把所有名称写进注释”改成真正的空测试声明，使正常样例仍能通过。
5. 增加以下校验器回归样例：
   - 名称只在 `//` 注释中时失败。
   - 名称只在 `/* */` 注释中时失败。
   - 名称只在 `const evidence = '...'` 中时失败。
   - 名称只在 `describe(...)` 中时失败。
   - 真实 `test(...)`、`it(...)` 和 `.each(...)` 声明通过。
   - 只有子串匹配、测试名多一个或少一个字符时失败。
6. 修正 G12：
   - `requiredLayer` 改为 `desktop-unit` 与 `mock-e2e`。
   - `tests/e2e/support/app.test.ts` 作为 `desktop-unit`，只负责凭据脱敏和关联 ID 保留。
   - `tests/e2e/diagnostics.e2e.ts` 作为 `mock-e2e`，负责完整桌面链路、资源归零、thread/turn/conversation 关联以及 prompt 不进入诊断快照。
   - 每条 evidence 只声明自己真正验证的 assertions，不再让单个单测承包全部跨层断言。

阶段验收：

- 在注释或普通字符串里伪造测试名，覆盖校验必定失败。
- 现有真实测试声明能被识别，表格测试不被误伤。
- G12 同时拥有正确的单元层与 Mock E2E 层证据。

### 阶段 B：修复 B06 Steer 拒绝与 terminal 竞态

涉及文件：

- `desktop-app/src/main/codexChatRuntimeService.ts:137`
- `desktop-app/src/main/codexChatRuntimeService.ts:872`
- `desktop-app/src/main/codexChatRuntimeService.ts:1328`
- `desktop-app/src/main/codexChatRuntimeService.ts:1352`
- `desktop-app/src/main/codexChatRuntimeService.ts:2055`
- `desktop-app/src/main/codexChatRuntimeService.test.ts:2559`
- `desktop-app/src/main/codexChatRuntimeService.test.ts:3170`

实施步骤：

1. 先把 B06 改成 terminal 先完成、RPC 后拒绝的可控回归测试，并断言完整 disposition，而不只断言 `failClaim` 调用次数。
2. `PendingSteerClaim` 记录 terminal 已到及其结果，但在 RPC 仍 pending 时不立即写入最终队列状态。
3. `settlePendingSteerClaims` 遇到未完成 RPC 时只标记 terminal，不调用 `failPendingSteerClaim`；RPC 结果到达后再进行唯一结算。
4. RPC 明确拒绝时按错误码分类：
   - `session_inactive`、`expected_turn_mismatch`、`unsupported_active_turn_kind` → `queued / turn-race`。
   - `app_server_rejected` → `paused-failed / steer-rejected`。
   - `attachment_resolution_failed` → `paused-failed / attachment-unavailable`。
5. RPC 成功但 terminal 已到，或返回 `steer_result_unknown` 时，保持 `paused-recovery-uncertain / recovery-uncertain`，禁止自动重发。
6. 保留 `pending.settlement` 的单次结算保护；无论 terminal、canonical、RPC、30 秒确认计时器以何种顺序到达，claim 只能 commit 或 fail 一次。
7. 增加表格化回归用例：
   - terminal → `session_inactive`，精确断言 `queued / turn-race`。
   - terminal → `app_server_rejected`，精确断言 `paused-failed / steer-rejected`。
   - terminal → RPC 成功，精确断言 `paused-recovery-uncertain / recovery-uncertain`。
   - terminal → `steer_result_unknown`，精确断言不确定状态。
   - completed、failed、interrupted 三种 terminal 均只结算一次。
   - 迟到 canonical 和重复 terminal 不得覆盖已完成结算。

阶段验收：

- B06 覆盖清单中“正确的恢复、暂停或拒绝状态”有精确断言支持。
- 明确拒绝与未知结果的状态互不混淆。
- `commitClaim` 与 `failClaim` 的调用总数对每个 claim 不超过一次。

### 阶段 C：补强 D18 审批重试身份隔离

涉及文件：

- `desktop-app/tests/e2e/approvals.e2e.ts:454`
- `desktop-app/tests/e2e/support/app.ts:226`
- `desktop-app/src/shared/codexIpcApi.ts:40`
- `desktop-app/tests/test-plan-coverage.json:1930`

实施步骤：

1. 第一次失败后，从 E2E runtime snapshot 记录第一个 terminal 的 `turnId`；第二次完成后记录第二个 `turnId`。
2. 明确断言两个 turn ID 均存在且不同；保留现有 call ID 和 approval ID 不同断言。
3. 第二个审批卡出现后、批准之前：
   - provider 尚未收到第二个 call 的 function output。
   - 对第一个 approval ID 再次调用 `respondApproval` 必须被拒绝或报告不存在。
   - 第二个审批仍保持 pending，工具执行次数仍为零。
4. 批准第二个审批后，只允许第二个 call 执行一次；最终 provider 请求数、tool result 数、approval 数和唯一 terminal 与预期一致。
5. 如果现有 `respondApproval` 返回 `void` 无法区分过期 ID，只在 main/preload 现有审批 IPC 边界补充明确错误，不把审批状态暴露到 renderer 之外。

阶段验收：

- 测试直接比较两次 `turnId`、`callId`、`approvalId`，三组都不同。
- 旧 approval ID 无法批准新 call。
- 第二次批准前没有副作用输出，批准后只执行一次。

### 阶段 D：补齐 MessagePort 12 路真实跨层清理

涉及文件：

- `desktop-app/src/preload/chatStreamBridge.ts:29`
- `desktop-app/src/preload/index.ts:38`
- `desktop-app/src/shared/codexIpcApi.ts:465`
- `desktop-app/src/main/index.ts:698`
- `desktop-app/tests/e2e/fault-injection.e2e.ts:129`
- `desktop-app/tests/e2e/support/app.ts:226`
- `desktop-app/tests/test-plan-coverage.json:1340`
- `desktop-app/tests/test-plan-coverage.json:3468`

实施步骤：

1. 保留当前 preload 假 MessagePort 单测，继续覆盖 messageerror、fallback 先后顺序和无 fallback 的 1 秒超时；这些是确定性的状态机测试。
2. 增加仅 E2E 环境可见的 chat bridge 诊断，返回 `activeStreamCount` 和 `callbackRegistryCount`。生产环境不暴露该方法。
3. 在 `fault-injection.e2e.ts` 新增一个测试，通过页面中的 `window.desktopApp.chat.startChatStream` 启动 12 个不同 conversation/chat ID 的真实流，使它们走 renderer → contextBridge → MessageChannel → main → provider → app-server mock backend。
4. 使用现有故障注入在每个流出现可见输出后关闭真实 MessagePort；每个流只能由 IPC fallback 收到一个 error terminal。
5. 全部完成后断言：
   - 12 个回调各收到且只收到一个 terminal。
   - `activeStreamCount = 0`、`callbackRegistryCount = 0`。
   - main runtime `activeRunCount = 0`。
   - shared connection 的 logical channel、pending request、turn owner、continuation 均为 0。
   - provider 请求数等于 12，没有自动重试。
   - 没有 page error、未处理 Promise 或迟到 terminal。
6. 将该 E2E 证据补到 C22/G11 的 `mock-e2e` evidence；不要用它替代已有的 preload 单元证据。

阶段验收：

- 12 路并发资源归零由真实跨层 E2E 证明。
- 单流 port close、messageerror、fallback 顺序和无 fallback 超时均仍有确定性测试。

### 阶段 E：补齐附件页面重载证据

涉及文件：

- `desktop-app/tests/e2e/chat.e2e.ts:307`
- `desktop-app/tests/test-plan-coverage.json` 中普通聊天附件对应场景 evidence

实施步骤：

1. 在现有“workspace reference + file + folder + image”测试中保留发送和切换对话断言。
2. 切回原对话后执行 `page.reload()`，等待统一应用就绪检查，再重新打开原对话。
3. 重载后断言用户消息仍只出现一次，两个文件类附件和一个图片附件均恢复；同时通过显示名称或路径分别确认普通文件和文件夹，避免只靠数量误判。
4. 断言 provider `/responses` 请求数仍为 1，证明历史重载没有再次调用模型或重复上传上下文。
5. 如果当前可访问名称无法区分文件和文件夹，只增加稳定的附件类型/名称测试属性，不改变用户界面行为。

阶段验收：

- 发送、对话切换、页面重载三个边界均恢复文件、文件夹和图片。
- 重载不产生新的 provider 请求。

### 阶段 F：重新校准覆盖清单

涉及文件：

- `desktop-app/tests/test-plan-coverage.json`
- `desktop-app/scripts/verify-test-plan-coverage.mjs`

实施步骤：

1. 完成阶段 A–E 后，重新逐项核对 B06、C22、D18、G11、G12 和附件场景的 `requiredLayer`、`requiredAssertions`、`status` 与 evidence。
2. 每条 evidence 必须指向真实测试声明，并且断言内容必须能从测试代码直接看到。
3. 不改变未涉及场景的状态，除非复核发现同类假证据；发现后应在同一修复分支补测试或降级状态，不能继续保留假 `covered`。
4. 生成并记录最终计数：134 个场景的 covered/deferred/not-applicable 数量、M01–M12 状态、R01–R06 状态。
5. R01–R06 在真实 packaged release suite 未成功前保持 `partial`，代码和测试文件已经存在不等于发布验收完成。

阶段验收：

- 覆盖清单通过强化后的校验器。
- P0/P1 和 M01–M12 不存在缺层、缺断言或伪证据。
- R01–R06 的状态与真实执行结果一致。

### 阶段 G：验证与 CI 门禁

按失败成本从低到高执行：

1. 覆盖校验器定向测试：

   ```bash
   node --test desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs
   ```

2. Steer 与 preload 定向单测：

   ```bash
   npm --prefix desktop-app test -- src/main/codexChatRuntimeService.test.ts src/preload/chatStreamBridge.test.ts tests/e2e/support/app.test.ts
   ```

3. Desktop 静态检查与全量单测：

   ```bash
   npm --prefix desktop-app run lint
   npm --prefix desktop-app run typecheck
   npm --prefix desktop-app test
   npm --prefix desktop-app run test:plan-coverage
   ```

4. Provider 回归：

   ```bash
   npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
   npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
   npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test
   ```

5. 相关 Mock E2E：

   ```bash
   npm --prefix desktop-app run test:e2e -- tests/e2e/diagnostics.e2e.ts tests/e2e/fault-injection.e2e.ts tests/e2e/approvals.e2e.ts tests/e2e/chat.e2e.ts --reporter=line
   ```

6. 全量与稳定性：

   ```bash
   npm --prefix desktop-app run test:e2e -- --reporter=line
   npm --prefix desktop-app run test:e2e:stability
   ```

7. 变更边界：

   ```bash
   git diff --check HEAD
   git diff --name-only HEAD -- codex/codex-rs/app-server
   ```

第二条命令必须无输出。CI 中保持 `.github/workflows/desktop-test-plan.yml:41` 的 Provider → Desktop → coverage → Mock E2E → 10 次稳定性 → 禁改路径顺序。

### 阶段 H：packaged real-LLM 发布验收

前置条件：可用的 admin backend、真实模型凭据、当前平台 packaged app-server binary。

执行：

```bash
DASCOWORK_RELEASE_LLM_SMOKE=1 \
DASCOWORK_RELEASE_ADMIN_BACKEND_URL=<url> \
npm --prefix desktop-app run test:e2e:release-llm
```

验收规则：

1. 必须由 `desktop-app/scripts/run-release-llm-smoke.mjs:8` 构建并运行 unpacked packaged artifact。
2. 不允许 `CODEX_APP_SERVER_BIN`、Rust workspace 或开发态 app-server fallback 影响结果。
3. R01–R06 必须整套通过；外部服务故障只允许整套重跑一次。
4. 两次尝试的脱敏诊断都必须保留。
5. 只有成功后才把六项状态从 `partial` 改为 `covered`，并再次执行覆盖校验器。
6. 缺少外部条件时，报告“代码补完，但发布验收仍阻断”，不得宣称 `docs/test-plan2.md` 全部完成。

## 5. 可测试验收标准

- [ ] B06 的 terminal-first + RPC rejection 两类状态精确匹配，且只结算一次。
- [ ] `steer_result_unknown` 和迟到成功保持 `paused-recovery-uncertain`，不自动重发。
- [ ] 覆盖校验器拒绝注释、普通字符串、describe 标题和子串伪造的测试名。
- [ ] 覆盖校验器接受真实 `test`、`it` 与表格测试声明。
- [ ] G12 同时引用脱敏单测和 `diagnostics.e2e.ts`，层级准确。
- [ ] D18 的两次 turn ID、call ID、approval ID 均不同。
- [ ] D18 的旧 approval ID 不能复用，第二次批准前工具执行次数为零。
- [ ] 12 路真实 MessagePort 故障后，preload、main 和 shared connection 的资源计数全部归零。
- [ ] 附件在发送、切换对话、页面重载后均恢复，provider 请求仍为一次。
- [ ] Provider 与 Desktop 的 lint、typecheck、单测全通过。
- [ ] 全量 Mock E2E 零失败，异常场景单 worker、无 retry、连续 10 次通过。
- [ ] `codex/codex-rs/app-server` 无改动。
- [ ] R01–R06 使用 packaged artifact 全部通过后才标为 `covered`。

## 6. 风险与缓解

| 风险 | 缓解办法 |
| --- | --- |
| 延迟 Steer 结算后，RPC 永不返回导致 claim 长时间占用 | 继续依赖 Provider 现有请求终止/超时；把 transport 无法确认归为 `recovery-uncertain`，不自动重发。测试覆盖 RPC rejection、unknown 和成功三类结果。 |
| 静态测试名提取误伤 `.each` 或模板测试 | 用仓库现有声明形式建立 fixture；只支持可静态确定的名称，动态拼接名称不允许进入覆盖清单。 |
| 12 路 Electron E2E 变慢或偶发 | 使用确定性 mock backend、唯一 conversation ID、单 worker、事件门闩，不使用固定 sleep；失败时附带每路 terminal 计数和资源快照。 |
| E2E 诊断为了可测性泄露业务信息 | 诊断只暴露计数和不透明 ID，受 E2E 环境变量保护，并由 G12 单测扫描凭据。 |
| 旧审批复用检查改变现有 IPC 行为 | 只让无效 request ID 返回明确错误，不扩大审批能力，不缓存或恢复审批决定。 |
| 发布环境不可用 | 代码阶段可以结束，但 R01–R06 保持 `partial`；最终报告明确区分“开发完成”和“发布验收完成”。 |

## 7. 交付物

1. Steer 竞态修复及精确回归测试。
2. 强化后的覆盖校验器与防伪 fixture。
3. 修正后的 G12、B06、C22/G11、D18 和附件场景 coverage evidence。
4. D18 新 turn/新审批/新 call 的完整 E2E 证据。
5. MessagePort 12 路真实跨层清理 E2E。
6. 附件页面重载恢复 E2E。
7. 全量验证、稳定性与禁改路径结果。
8. packaged R01–R06 结果；若外部条件缺失，则保留明确阻断说明。
