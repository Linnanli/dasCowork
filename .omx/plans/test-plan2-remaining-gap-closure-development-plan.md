# `docs/test-plan2.md` 剩余缺口闭环开发计划

## 1. 需求摘要

本计划承接对 `.omx/plans/test-plan2-final-gap-closure-development-plan.md` 的完成度复核，只处理截至 2026-07-22 仍未闭环的测试、证据和发布验收问题，不重复已经通过的产品行为实现。

目标分为两级：

1. **本地开发闭环**：补齐覆盖校验器边界、MessagePort 失败诊断、附件恢复诊断与 tooltip 证据、D18 精确副作用计数、G11 coverage 语义和完整串行门禁。
2. **整份计划闭环**：在当前 revision 新构建的 unpacked packaged artifact 上，用真实 admin backend 和模型凭据一次性通过 R01–R06，并将六项从 `partial` 更新为 `covered`。

## 2. 当前结论与范围

### 2.1 已完成基线

- 覆盖校验器及现有 fixture 已通过；A–G 统计为 134/134，M01–M12 为 `covered`。
- 12 路 MessagePort 用例已使用结构化 probe 验证 conversation、thread、turn、delta、单终态及 preload/main/shared connection 资源归零，见 `desktop-app/tests/e2e/fault-injection.e2e.ts:243-362`；该用例已连续 10 次通过。
- 普通聊天附件主流程已经覆盖 workspace reference、文件、文件夹、图片、切换对话和页面重载，见 `desktop-app/tests/e2e/chat.e2e.ts:314-430`；定向 10 次和完整 `chat.e2e.ts` 已通过。
- D18 已具备双 turn、双 call、双 approval、旧 approval 失效及第二 marker 批准前为空/批准后单行的主体证据，见 `desktop-app/tests/e2e/approvals.e2e.ts:454-577`。
- `git diff --check HEAD` 已通过，`codex/codex-rs/app-server` 当前无改动。

### 2.2 附件测试失败原因

此前附件用例失败在 `desktop-app/tests/e2e/chat.e2e.ts:421` 的 `expectAppReady(page)`，发生于 reload 后重新点击原对话之前，不是附件内容恢复断言失败。

可确认事实与高概率诱因分为两层：

1. `desktop-app/tests/e2e/support/app.ts:84-138` 把输入框存在、可编辑和发送按钮存在合并成一个 `composerReady`；任一条件瞬时不满足都会只显示 `false`，无法判断是 renderer 未挂载、conversation 尚在恢复、输入框被禁用，还是 send/stop 状态切换。
2. 该失败出现在多个独立 Playwright 进程同时运行时；后续串行重复 10 次、完整 chat suite，以及受控并发复测均证明附件功能本身稳定。更高并发下另一个 approvals 用例出现了 5 秒命令超时，因此“独立 E2E 进程争用本机 Electron/app-server/命令执行资源”是目前最符合证据的诱因，但聚合的 `composerReady` 没有保留当时的具体子状态，不能把它当作已被完全证明的唯一根因。

因此本计划不把该现象当作附件产品缺陷，也不通过全局增加超时或 retry 掩盖问题；先拆分 readiness 诊断、补 terminal settled 边界，并强制重型 E2E 串行验证。只有串行复测再次暴露真实状态错误时，才进入产品实现修复。

### 2.3 约束与非目标

- 禁止修改 `codex/codex-rs/app-server/`。
- 不新增模型调用路径，不绕过 Provider/Codex App Server 链路。
- 不新增依赖；优先修改测试、测试 helper、coverage manifest 和文档。
- 不通过增加 Playwright retry、全局 timeout 或并行重复跑来制造“通过”。
- 普通聊天附件是 `docs/test-plan2.md` 的补充回归项，不伪装成 A–G 场景 evidence。

## 3. 可测试验收标准

### A. 覆盖校验器边界

- `test`、`it`、`test.each`、`it.each` 的正向 fixture 明确覆盖单引号、双引号、无 `${...}` 的静态模板字符串和 `$phase` 占位符。
- 每种声明/引号组合单独构造 fixture，避免一个成功声明掩盖同 fixture 内的失败声明。
- 动态模板、注释、普通字符串、`describe` 标题和名称边界偏差仍被拒绝。
- validator 和完整 coverage 校验均零失败；A–G 保持 134/134，M01–M12 保持 `covered`。

### B. MessagePort 失败诊断

- 12 路用例继续满足：12 个非空唯一 stream ID、每路唯一 thread/turn、至少一个 delta、恰好一个 terminal、provider 请求数 12、所有资源计数归零。
- 每个 per-stream 断言的失败消息包含 `index` 和 `streamId`。
- 无论失败发生在 probe 最终断言之前或之后，Playwright 产物均包含 `message-port-stream-probes.json`，其中保留已采集的 12 路结构化 probe 或明确的采集错误。
- 该用例 `--repeat-each=10 --workers=1 --retries=0` 全通过。

### C. 普通聊天附件与 readiness

- readiness 诊断分别报告 bridge、model catalog、composer mount、输入框 editable、send button、stop button，不再用单一 `composerReady` 隐藏失败维度。
- readiness RPC 超时或异常在最后采样结果中可见，不能被无信息地折叠成全部 `false`。
- 发送结束后先证明唯一 canonical terminal、provider 请求数 1、active run/shared connection/queue/approval 全部 settled，再切换对话或 reload。
- 切换和 reload 后，文件与文件夹都通过 hover 后的可访问 tooltip 文本验证；图片继续验证名称、`app://fs/` URL、文件名后缀和 alt。
- 全流程用户消息只出现一次，provider `/responses` 请求总数始终为 1。
- 定向用例 10 次、完整 `chat.e2e.ts` 和与 approvals 的串行组合均零失败。

### D. D18 审批隔离

- 第一个 marker 在首次批准前为 0，首次执行后为 1；第二审批出现、旧 approval 被拒绝和最终结束后仍精确为 1。
- 第二个 marker 与第二个 call 的 `function_call_output` 在批准前均为 0，批准后均精确为 1。
- function output 计数按所有 `/responses` body 内的实际 item 计数，不使用 `find` 或 call ID `Set` 去重来隐藏重复输出。
- 两次 turn ID、call ID、approval ID 均存在且不同；旧 approval 不能批准新 call；terminal、approval、tool 执行均无重复。
- D18 定向用例、完整 approvals suite 及 10 次稳定性均零失败；若再次出现简单 `printf` 的 `exit 124`，该阶段保持未完成并继续定位 command settlement，不增加全局 timeout。

### E. Coverage 与文档真实性

- G11 的 `requiredAssertions` 与“错误、取消、完成竞态只进入单终态”场景本身一致；诊断脱敏由 G12 负责，不在 G11 重复或伪造证据。
- `chatStreamBridge.test.ts` 只认领 IPC fallback 单终态，`ElectronIpcChatTransport.test.ts` 只认领首终态后忽略迟到回调，12 路 E2E 只认领并发身份、唯一终态与资源归零。
- 每条 evidence 的 assertion 不超过对应测试直接断言的内容。
- `docs/test-plan2.md` 记录附件回归的完整测试名、执行命令、日期、revision、退出状态和通过数，并明确它不属于 134 项 manifest。

### F. 本地与 CI 门禁

- Provider lint、typecheck、全部测试零失败。
- Desktop lint、typecheck、全部 Vitest、coverage validator、coverage manifest 零失败。
- 全量 Mock E2E 零失败；stability 为单 worker、无 retry、重复 10 次全通过。
- 所有重型 E2E 命令顺序执行，验证期间不存在其他独立 Playwright/Electron E2E 进程。
- CI 全绿且 CI 显示的 commit SHA 与用于本地最终验证的 revision 一致。
- `git diff --check HEAD` 零退出；`git diff --name-only HEAD -- codex/codex-rs/app-server` 无输出。

### G. Packaged real-LLM 发布验收

- 从当前 revision 新构建 unpacked packaged artifact，不复用旧 `desktop-app/dist/mac` 产物。
- 开发态 `CODEX_APP_SERVER_BIN` 和 Rust workspace fallback 被清除。
- R01–R06 在同一次完整 suite 中全部通过；只有确认外部服务故障时允许整套再跑一次。
- 成功后六项统一改为 `covered` 并重新通过 coverage 校验；否则保持 `partial`，结论只能是“本地开发完成，发布验收阻断”。

## 4. 实施步骤

### 阶段 A：补齐静态模板字符串正向 fixture

涉及文件：

- `desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs:106-152`
- 仅当新增 fixture 真实失败时才考虑 `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:500-523`

步骤：

1. 将现有正向声明样例整理为独立表格项，覆盖四种声明形态和三种静态引号。
2. 至少让 `test` 保留单引号、`it` 使用双引号、`test.each` 使用静态模板字符串、`it.each` 保留 `$phase`；若按严格笛卡尔积实现，则每组单独运行 validator fixture。
3. 保留动态 `${...}` 模板为负向用例，避免静态模板支持误放宽为动态名称支持。
4. 先只改测试；当前 parser 已支持静态模板字符串，新增 fixture 通过时不得修改实现或引入 AST 依赖。

完成条件：validator 全部用例通过，完整 coverage 仍为 134/134 和 M01–M12 全 covered。

### 阶段 B：让 12 路失败产物可定位到具体 stream

涉及文件：

- `desktop-app/tests/e2e/fault-injection.e2e.ts:23-34,243-367`
- 复用 `desktop-app/tests/e2e/support/app.ts:448-452` 的脱敏序列化能力

步骤：

1. 为 per-stream 断言统一构造 `stream index=<n> streamId=<id>` 标签，并把它作为 Playwright `expect` 的失败消息。
2. 增加 stream ID 非空断言，同时保留 12 个 ID 唯一、turn ID 一一对应及终态/资源归零断言。
3. 在 `finally`、关闭 Electron 前重新读取 `window.__e2eMessagePortStreamProbes`，用脱敏序列化器附加 `message-port-stream-probes.json`。
4. probe 读取失败时也附加明确的 `unavailable` 原因，且不能覆盖原测试失败。
5. 不把私有 window probe 硬编码进通用 `captureVisibleE2eSnapshot`；通用 snapshot 的公共 contract 保持不变。
6. 只有串行 10 次重新暴露实际事件丢失时才检查 `chatStreamBridge.ts`；诊断改造本身不触碰产品代码。

完成条件：10/10 通过，任一人为制造的单路断言失败都能从错误文本和附件直接找到 index/streamId。

### 阶段 C：拆分 readiness 并闭合附件恢复边界

涉及文件：

- `desktop-app/tests/e2e/support/app.ts:84-138,376-432`
- `desktop-app/tests/e2e/chat.e2e.ts:314-454`
- `desktop-app/tests/e2e/support/terminalScenario.ts:71-108`
- `docs/test-plan2.md:62-65`

步骤：

1. 在 `expectAppReady` 和可见诊断快照中统一使用独立字段：`bridgeReady`、`modelCatalogReady`、`composerMounted`、`composerEditable`、`sendButtonPresent`、`stopButtonPresent`。
2. fresh/reload 后的“可发送”门禁仍要求 bridge、model、mount、editable、send 全部成立；stop 仅作为运行中诊断，不把正在生成错误地判为可发送。
3. 保留每次 readiness 采样的错误/超时原因，使失败信息能区分 IPC 探针失败和 DOM 状态未就绪；不扩展产品 `CodexE2eRuntimeSnapshot` schema。
4. 在附件测试收到 assistant 文本后调用现有 terminal/resource helper，证明唯一 `finish`、providerRequestCount=1、turnStartedCount=1、无审批/工具、queue 空和资源归零，再开始切换与 reload。
5. 将附件 helper 改为接收 `page` 与 message locator；文件、文件夹各自 hover 后断言 portal tooltip 文本，图片增加 `data-attachment-name` 并保留 URL/后缀/alt 断言。
6. 切换和 reload 共用同一 helper，避免两个边界的断言强度不同。
7. 在 `docs/test-plan2.md` 记录完整测试名和实际执行命令；测试结果只在真实命令通过后填写。

完成条件：附件身份、tooltip、terminal settled 和请求唯一性均有直接断言；串行定向 10 次无 false-negative readiness 失败。

### 阶段 D：补齐 D18 的精确次数证据

涉及文件：

- `desktop-app/tests/e2e/support/mockBackend.ts:266-279`
- `desktop-app/tests/e2e/approvals.e2e.ts:454-577`

步骤：

1. 在 mock backend helper 中新增按 `callId` 遍历全部 `/responses` input item 的 `functionCallOutputCount`，统计实际 `function_call_output` 条目数。
2. 第一个 approval 出现时先断言 first marker 为 0；首次 terminal 后为 1。
3. 第二个 approval 出现、旧 approval 尝试被拒绝、最终完成三个检查点都重新断言 first marker 仍为 1。
4. 第二个 approval 批准前的两个检查点同时断言 second marker=0、second output count=0；批准后断言二者均为 1，并保留输出文本包含 marker 的检查。
5. 不修改 `countProviderToolResults` 当前“唯一 call 数”的既有语义，避免影响其他 terminal scenario；D18 使用新的原始条目计数 helper。
6. 保留临时目录 `finally` 清理和已有 turn/call/approval identity、pending 状态与 terminal 唯一性断言。

完成条件：两个副作用与第二 function output 的状态变化均为可观察的 `0 → 1`，且不存在重复执行。

### 阶段 E：修正 G11 evidence 语义并记录验收结果

涉及文件：

- `desktop-app/tests/test-plan-coverage.json:3474-3508`
- `desktop-app/src/preload/chatStreamBridge.test.ts:311-342`
- `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts:341-390`
- `desktop-app/tests/e2e/fault-injection.e2e.ts:243-362`
- `docs/test-plan2.md:62-75`

步骤：

1. 以 G11 标题“错误、取消、完成竞态只进入单终态”为源语义，重写 `requiredAssertions`，删除属于 G12 的“诊断可关联而不泄露密钥”。
2. 将两个 desktop-unit evidence 的 assertion 缩减到各自直接证明的 fallback 单终态和迟到回调忽略。
3. 将单流/12 路 mock-e2e evidence 限定为实际证明的身份隔离、唯一终态和资源清理；不让任何证据认领未检查的密钥或诊断内容。
4. 运行强化后的 validator。如果 G11 某个必要 assertion 因去除伪 evidence 变为缺失，优先引用已有直接测试；没有真实测试时补最小测试，不得重新扩大文字声明。
5. 在文档新增最终验证表，记录日期、revision、完整命令、退出状态、通过数、A–G/M/R 计数和产物路径。
6. 修正文档中 R01–R06 的过期行号引用，避免链接仍指向旧 manifest 位置。

完成条件：coverage validator 全绿，G11 每条 evidence 可由对应代码逐项复核，文档结果可追溯到当前 revision。

### 阶段 F：串行执行本地全量门禁和同 revision CI

所有命令必须顺序执行；开始前确认没有其他 Playwright/Electron E2E 进程在跑。

```bash
npm --prefix desktop-app run test:plan-coverage:validator
npm --prefix desktop-app run test:plan-coverage

npm --prefix desktop-app test -- \
  src/preload/chatStreamBridge.test.ts \
  src/renderer/src/lib/ElectronIpcChatTransport.test.ts \
  tests/e2e/support/app.test.ts

npm --prefix desktop-app run test:e2e -- \
  tests/e2e/fault-injection.e2e.ts \
  --grep 'cleans twelve real MessagePort streams' \
  --repeat-each=10 --workers=1 --retries=0 --reporter=line

npm --prefix desktop-app run test:e2e -- \
  tests/e2e/chat.e2e.ts \
  --grep 'preserves a workspace reference, local file, folder and image after conversation switch and reload' \
  --repeat-each=10 --workers=1 --retries=0 --reporter=line

npm --prefix desktop-app run test:e2e -- \
  tests/e2e/approvals.e2e.ts \
  --grep 'D18 @approval-retry requires new turn, approval, and call ids before rerunning a side-effecting tool' \
  --repeat-each=10 --workers=1 --retries=0 --reporter=line

npm --prefix desktop-app run test:e2e -- \
  tests/e2e/chat.e2e.ts tests/e2e/approvals.e2e.ts \
  --workers=1 --retries=0 --reporter=line

npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test

npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
npm --prefix desktop-app test
npm --prefix desktop-app run test:plan-coverage
npm --prefix desktop-app run test:e2e -- --reporter=line
npm --prefix desktop-app run test:e2e:stability

git diff --check HEAD
git diff --name-only HEAD -- codex/codex-rs/app-server
```

执行规则：

1. 任一定向测试失败，先保留 trace、截图、`desktop-chat-diagnostics.json` 和场景专用 probe，再从该阶段修复并重新执行后续完整链路。
2. 不接受“失败后隔离重跑一次通过”作为完成证据；定向稳定性、整文件、全量和 stability 必须按顺序全部通过。
3. 全部本地门禁通过后，以同一 commit SHA 触发 `.github/workflows/desktop-test-plan.yml:41-76`；CI SHA 必须等于本地最终验证 revision。

完成条件：全部命令零退出、同 revision CI 全绿、文档已记录证据。

### 阶段 G：执行 packaged real-LLM 发布验收

前置条件：可用 admin backend、真实模型凭据、当前平台 packaged app-server binary。

```bash
DASCOWORK_RELEASE_LLM_SMOKE=1 \
DASCOWORK_RELEASE_ADMIN_BACKEND_URL=<url> \
npm --prefix desktop-app run test:e2e:release-llm
```

步骤：

1. 使用 `desktop-app/scripts/run-release-llm-smoke.mjs:8-17` 从当前 revision 构建 unpacked artifact 并启动其真实 executable。
2. 确认 `desktop-app/scripts/run-release-llm-smoke.mjs:69-80` 清除开发态 app-server override，禁止 cargo fallback。
3. 完整执行 R01–R06，不使用 `--grep` 过滤单项。外部服务故障时设置 `DASCOWORK_RELEASE_EXTERNAL_RETRY=1` 只允许整套重跑一次。
4. 保留每次 `release-llm-attempt-*` 脱敏诊断，并在文档记录 artifact、revision、执行次数和六项结果。
5. 只有六项同批全通过后，才把 `desktop-app/tests/test-plan-coverage.json:3998-4164` 的 R01–R06 统一改为 `covered`，再运行 `npm --prefix desktop-app run test:plan-coverage`。

完成条件：R01–R06 同批通过，六项状态准确更新，coverage 复验通过。

## 5. 风险与缓解

| 风险 | 缓解措施 |
| --- | --- |
| 把并发资源争用误判为附件恢复缺陷 | 重型 E2E 全程串行；先拆分 readiness 信号并等待 terminal/resources settled，再决定是否进入产品修复。 |
| readiness 放宽后把运行中状态误判为可发送 | `sendButtonPresent` 仍是 fresh/reload 可发送门禁；`stopButtonPresent` 只提供诊断信息。 |
| MessagePort 用例在早期断言失败，最终 probe 未被打印 | 在 `finally` 独立采集并附加 scenario JSON；采集错误不覆盖原始失败。 |
| D18 的 `find`/Set 统计隐藏重复 output | 新增遍历全部 body/item 的原始计数 helper，批准前/后严格断言 `0 → 1`。 |
| 为修 coverage 而弱化场景要求 | 以场景标题和原始测试计划为准校正语义；若必要 assertion 无直接证据，则补测试或降级状态，不伪造 evidence。 |
| 全量门禁与本地 staged 快照不对应 CI | 所有本地门禁通过后固定 revision，CI 必须报告相同 SHA。 |
| 复用旧 packaged artifact 产生假发布证据 | release runner 必须从当前 revision 新构建；旧 `desktop-app/dist/mac` 不计入验收。 |
| 发布环境不可用 | R01–R06 保持 `partial`，明确报告“本地开发完成，发布验收阻断”。 |

## 6. 完成定义与停止条件

### 可声明“本地开发完成”

- 阶段 A–F 全部满足；
- G11 coverage 语义和附件文档证据真实、可追溯；
- 定向 10 次、完整 suites、全量 Mock E2E、stability 和同 revision CI 全绿；
- app-server 禁改路径无输出。

### 可声明“原计划全部完成”

- 已满足“本地开发完成”；
- 阶段 G 的当前 revision packaged R01–R06 同批全部通过；
- 六项已更新为 `covered` 且 coverage 复验通过。

### 必须保留未完成状态

- 串行稳定性仍出现 readiness、命令 `exit 124`、重复 terminal/output 或资源未归零；
- 同 revision CI 尚未全绿；
- admin backend、真实凭据或 packaged binary 缺失；
- R01–R06 整套执行两次后仍失败；
- 任何修复需要越过 `codex/codex-rs/app-server` 禁改边界。

出现这些情况时，报告已通过阶段、失败证据、当前 revision 和阻断原因，不扩大范围，也不把 `partial` 改为 `covered`。
