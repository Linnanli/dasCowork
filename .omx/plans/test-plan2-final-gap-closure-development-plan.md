# `docs/test-plan2.md` 最终缺口收尾开发计划

## 1. 需求摘要

本计划只处理 2026-07-22 复核后仍未完成或证据不足的部分，不重复已经通过定向测试的 B06 Steer 竞态、G12 分层标注和既有覆盖清单重构。

最终目标是同时满足：

1. 12 路 MessagePort 故障 E2E 不再依赖不稳定的进程日志计数，而是在 renderer 回调、preload 注册表、main runtime 和 shared connection 四个层面证明每路只进入一个终态并全部清理。
2. 普通聊天附件在对话切换和页面重载后，能够按名称或路径分别确认普通文件、文件夹和图片，而不是只检查附件总数。
3. D18 使用测试专用副作用标记，在第二次审批之前直接证明新的工具调用尚未执行；批准后只执行一次。
4. 覆盖校验器回归测试补齐块注释、`it.each`、静态模板字符串、动态名称和精确边界匹配。
5. Provider、Desktop、覆盖校验、全量 Mock E2E 和无重试的 10 次稳定性门禁全部通过。
6. R01–R06 只有在 unpacked packaged artifact 上完成真实 LLM 验收后才从 `partial` 改为 `covered`。

## 2. 当前基线与范围判断

### 已有正向证据

- 覆盖校验器已从全文包含判断改为静态测试声明提取，入口位于 `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:392-401`。
- B06 已在 `desktop-app/src/main/codexChatRuntimeService.test.ts:3170-3260` 精确覆盖 terminal-first 后的 `turn-race` 与 `steer-rejected` 分类；相关 74 个 Vitest 定向测试已通过。
- G12 已分别引用 desktop-unit 与 mock-e2e 证据，见 `desktop-app/tests/test-plan-coverage.json:3512-3535`。
- 当前覆盖校验输出为 134/134 scenarios、M01–M12 全部 `covered`；R01–R06 仍为 `partial`，见 `desktop-app/tests/test-plan-coverage.json:3996-4164`。
- `git diff --check HEAD` 已通过，且 `git diff --name-only HEAD -- codex/codex-rs/app-server` 无输出。

### 仍未完成的直接证据

- 相关 Mock E2E 新鲜运行结果为 19 passed / 1 failed；失败项是 `desktop-app/tests/e2e/fault-injection.e2e.ts:192-303` 的 12 路 MessagePort 用例。
- 失败点在 `desktop-app/tests/e2e/fault-injection.e2e.ts:287-289`：provider 请求和 runtime terminal 均达到 12、资源也归零，但只采集到 7 条文本日志形式的 `turn/started`。这说明当前门禁失败，但现有诊断不支持把它直接归类为资源泄漏。
- 附件重载后的 helper 只检查 3 个附件和图片，未验证普通文件与文件夹身份，见 `desktop-app/tests/e2e/chat.e2e.ts:420-467`。
- D18 在第二个审批等待期间验证了旧 approval ID 失效和 function output 不存在，但没有直接观察命令副作用是否发生，见 `desktop-app/tests/e2e/approvals.e2e.ts:520-538`。
- 校验器 fixture 只显式覆盖行注释、普通字符串、`describe`、`test`、`it` 和 `test.each`，见 `desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs:85-138`。

### 范围纠正

- `docs/test-plan.md:367-368` 明确 A–G 覆盖矩阵不扩展普通聊天功能，因此普通聊天附件 E2E 不应伪挂到 A12 或 B08 的 coverage evidence 上。
- 普通聊天附件属于 `docs/test-plan2.md:24-29` 增加的补充回归门禁。完成证据应记录在 `docs/test-plan2.md` 的验收结果中，同时由全量 Mock E2E 和 CI 阻断；不修改 134 个 A–G 场景的语义。

## 3. 可测试验收标准

### 3.1 覆盖校验器

- 名称只存在于 `//`、`/* ... */`、普通变量字符串或 `describe(...)` 标题时，校验必须失败。
- `test(...)`、`it(...)`、`test.each(...)(...)`、`it.each(...)(...)` 均能识别单引号、双引号和无 `${...}` 的模板字符串。
- 动态模板字符串、字符串拼接、测试名多一个字符或少一个字符均不能作为覆盖证据。
- `node --test desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs` 零失败。

### 3.2 12 路 MessagePort

- 12 个不同 conversation/chat ID 都收到且只收到一次 `turn-started` lifecycle，12 个 turn ID 均存在且互不重复。
- 每路在 MessagePort 故障前至少收到一个文本 delta；故障后每路 terminal 回调总数精确等于 1，且只能是 IPC fallback 的 error。
- `activeStreamCount = 0`、`callbackRegistryCount = 0`、`activeRunCount = 0`。
- shared connection 的 `logicalChannelCount`、`pendingRequestCount`、`turnOwnerCount`、`continuationCount` 全部为 0。
- provider `/responses` 请求数精确等于 12；main runtime 恰有 12 个 terminal records，且其 conversation/turn identity 与 renderer lifecycle 一一对应。
- 没有 page error、unhandled rejection、第二终态或额外 provider 请求。
- 该用例在 `--repeat-each=10 --workers=1 --retries=0` 下连续 10 次通过。

### 3.3 普通聊天附件

- 首次发送后，provider 请求中同时包含 workspace reference、普通文件、文件夹与图片上下文。
- 切换到新对话再切回后，用户消息只出现一次，并分别通过名称或路径确认 `e2e-notes.txt`、`e2e-reference-folder`、`e2e-context.png`。
- `page.reload()` 并重新打开原对话后，仍执行相同的三类身份断言，而不是只断言附件数量。
- 切换和重载后 provider `/responses` 请求总数仍精确等于 1。

### 3.4 D18 审批隔离

- 两次 turn ID、call ID、approval ID 均存在且两两不同。
- 第二个审批卡出现后，旧 approval ID 返回 `Unknown approval request`，新 approval ID 仍 pending。
- 批准第二个审批之前，第二个命令对应的标记文件不存在或内容为空，provider 中不存在第二个 call 的 function output。
- 批准后，第二个标记文件只包含一条预期 marker，第二个 call 只产生一个 function output；工具、审批和 terminal 都不重复。

### 3.5 总体门禁

- Desktop lint、typecheck、全部 Vitest 零失败。
- Provider lint、typecheck、全部测试零失败。
- 覆盖校验报告保持 134 covered、0 missing、0 partial、0 deferred；M01–M12 全部 covered。
- 全量 Mock E2E 零失败；异常场景连续 10 次、单 worker、无 retry 全通过。
- `codex/codex-rs/app-server` 无改动。
- R01–R06 只有 packaged real-LLM suite 整套通过后才为 covered；否则最终状态必须写明“本地开发完成，发布验收阻断”。

## 4. 实施步骤

### 阶段 A：补齐校验器边界回归，不先改实现

涉及文件：

- `desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs:85-138`
- 仅当新增测试暴露缺陷时修改 `desktop-app/scripts/lib/test-plan-coverage-validator.mjs:401-570`

步骤：

1. 把“伪证据”fixture 改为表格测试，分别输入行注释、块注释、普通字符串、`describe` 标题、动态模板字符串和字符串拼接。
2. 为正向声明分别加入 `test`、`it`、`test.each`、`it.each`，并覆盖单引号、双引号、静态模板字符串及 `$phase` 占位符。
3. 将子串测试拆成两个精确用例：manifest 名称比声明多一个字符、少一个字符，二者都必须失败。
4. 先运行新增 fixture；只有实际失败时才修正 extractor。不得为了 fixture 引入 AST 依赖或新 npm 包。

阶段完成条件：新增所有边界用例通过，现有 12 个校验器测试无回归。

### 阶段 B：把 12 路 MessagePort 证据改为结构化事件证据

涉及文件：

- `desktop-app/tests/e2e/fault-injection.e2e.ts:192-303`
- `desktop-app/src/preload/chatStreamBridge.ts:38-82,100-140`
- `desktop-app/src/preload/chatStreamBridge.test.ts:246-307`
- `desktop-app/tests/e2e/support/app.ts:226-273`
- `desktop-app/tests/test-plan-coverage.json:1340-1395,3474-3509`

步骤：

1. 在 `page.evaluate` 内为每个 stream 建立独立 probe，记录：`turn-started` 次数和 turn ID、文本 delta 次数、finish/abort/error 各自次数和 terminal 总数。
2. 将 `onThreadBound`、`onTurnLifecycle`、`onChunk`、`onFinish`、`onAbort`、`onError` 都接入 probe；Promise 仍只负责等待首次 terminal，但最终断言必须读取全部计数，不能把 Promise 首次 resolve 当成“只调用一次”的证据。
3. 断言每路在终态前至少收到一个文本 delta、恰好一个 `turn-started`、恰好一个 error terminal，且 12 个 turn ID 唯一。
4. 删除 `logs.filter(...turn/started...).length === 12` 这一不稳定断言；用 renderer lifecycle 的 turn ID 与 main runtime `terminalEvents` 的 turn ID 一一对应替代。日志仍只用于 page error 和 unhandled rejection 检查。
5. 保留 provider 请求数 12、preload 两个注册表归零、main/shared connection 资源归零断言。
6. 先单独运行该测试 10 次。如果结构化事件仍少于 12，再定位实际丢事件层：
   - renderer lifecycle 少、main terminal 够：检查 preload MessagePort 关闭时序；
   - main terminal 也少：检查 desktop runtime settlement；
   - provider 请求少：检查 app-server 并发槽释放，但禁止修改 `codex/codex-rs/app-server`。
7. 只有发现真实产品竞态时才修改 `chatStreamBridge.ts`；若只是日志观测丢失，保持产品实现不动，仅修复 E2E 证据。

阶段完成条件：单测保持通过，12 路用例单独连续 10 次通过，且失败诊断能定位到具体 stream ID。

### 阶段 C：补齐附件重载后的文件与文件夹身份断言

涉及文件：

- `desktop-app/tests/e2e/chat.e2e.ts:314-475`
- `docs/test-plan2.md:24-29,53-60`

步骤：

1. 将 `expectSwitchedAttachmentNames` 与 `expectReloadedAttachments` 合并为一个接收 `page`、message locator 和三类名称的 helper。
2. 切换对话和页面重载后都调用同一个 helper，逐项检查普通文件 tooltip、文件夹 tooltip、图片 `app://fs/` URL、图片文件名与 alt。
3. 保留重载后用户消息唯一性和 provider 请求总数等于 1 的断言。
4. 将测试名中的 `B08` 移除或改为不与 Steer 场景 ID 冲突的普通聊天回归名称，避免把普通聊天附件错误解释为 B08 coverage evidence。
5. 不把该测试挂到 A12/B08 的 `test-plan-coverage.json` evidence；在 `docs/test-plan2.md` 增加“补充普通聊天回归证据”记录，引用完整测试名和执行命令。

阶段完成条件：该 E2E 单独通过，切换与重载两次都能分别识别文件、文件夹、图片，请求数仍为 1。

### 阶段 D：用真实副作用标记补强 D18

涉及文件：

- `desktop-app/tests/e2e/approvals.e2e.ts:1-22,454-570`

步骤：

1. 为 D18 创建测试专用临时目录，分别准备第一次和第二次命令的 marker 文件路径；路径只存在于 Playwright 测试进程，不进入 E2E runtime snapshot。
2. 将两次审批命令改为向各自 marker 文件追加一行唯一文本。使用安全的 shell 参数引用 helper，禁止直接拼接未经转义的路径。
3. 第一次批准后断言第一个 marker 文件恰好一行；第一次失败与第二次审批出现之间不得再次增加。
4. 第二审批 pending 时断言：第二 marker 文件不存在或为空、旧 approval ID 被拒绝、第二 approval ID 仍 pending、provider 尚无第二个 function output。
5. 尝试旧 approval ID 后再次检查第二 marker 仍为空，证明旧审批不能触发新 call。
6. 批准第二 approval 后等待第二 marker 文件内容出现，并精确断言只有一行；保留第二 call 只有一个 function output、两个 turn/call/approval ID 不同和唯一 terminal 断言。
7. 在 `finally` 中通过现有 `cleanupTempDirs` 清理测试专用目录；不得把 marker 路径或文件内容新增到 runtime snapshot。

阶段完成条件：D18 单独通过；批准前 marker 次数为 0，批准后为 1；现有 approval 测试无回归，产品 IPC 和诊断 schema 无新增字段。

### 阶段 E：重新核对覆盖与补充回归记录

涉及文件：

- `desktop-app/tests/test-plan-coverage.json:492-525,1340-1395,1936-1970,3474-3535,3996-4164`
- `desktop-app/scripts/verify-test-plan-coverage.mjs`
- `docs/test-plan2.md`

步骤：

1. 核对 B06、C22、D18、G11、G12 的 evidence 仍指向真实测试声明，layer 与 assertions 没有扩大到测试未直接证明的内容。
2. C22/G11 保留 desktop-unit 与 mock-e2e 两层；12 路 E2E 的 evidence 只声明它实际证明的“资源、并发和终态无残留”。
3. 普通聊天附件不加入 A–G manifest；将其作为 `docs/test-plan2.md` 的补充 Mock E2E 发布阻断项记录。
4. 生成并记录最终计数：134 scenarios、M01–M12、R01–R06；R01–R06 在真实发布验收前继续保持 `partial`。

阶段完成条件：覆盖校验器通过，manifest 无伪 evidence，文档明确区分 A–G coverage 与普通聊天补充回归。

### 阶段 F：本地全量验证与稳定性门禁

按失败成本从低到高执行：

```bash
node --test desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs

npm --prefix desktop-app test -- \
  src/main/codexChatRuntimeService.test.ts \
  src/preload/chatStreamBridge.test.ts \
  tests/e2e/support/app.test.ts

npm --prefix desktop-app run test:e2e -- \
  tests/e2e/fault-injection.e2e.ts \
  tests/e2e/approvals.e2e.ts \
  tests/e2e/chat.e2e.ts \
  tests/e2e/diagnostics.e2e.ts \
  --reporter=line

npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
npm --prefix desktop-app test
npm --prefix desktop-app run test:plan-coverage

npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test

npm --prefix desktop-app run test:e2e -- --reporter=line
npm --prefix desktop-app run test:e2e:stability

git diff --check HEAD
git diff --name-only HEAD -- codex/codex-rs/app-server
```

验证规则：

- `desktop-app/package.json:14-15` 已规定全量 E2E 与异常场景 `repeat-each=10 / workers=1 / retries=0`，不得通过增加 retry 掩盖失败。
- CI 保持 `.github/workflows/desktop-test-plan.yml:41-76` 的 Provider → Desktop → coverage → Mock E2E → stability → change scope 顺序。
- 任一用例失败时保留 Playwright trace、截图与脱敏 diagnostics；修复后必须从失败用例重新跑到全量与稳定性，不接受仅隔离重跑一次通过。

阶段完成条件：上述本地命令全部零退出，CI 同一 revision 全绿，禁改路径无输出。

### 阶段 G：packaged real-LLM 发布验收

前置条件：可用 admin backend、真实模型凭据、当前平台 packaged app-server binary。

执行：

```bash
DASCOWORK_RELEASE_LLM_SMOKE=1 \
DASCOWORK_RELEASE_ADMIN_BACKEND_URL=<url> \
npm --prefix desktop-app run test:e2e:release-llm
```

规则：

1. `desktop-app/scripts/run-release-llm-smoke.mjs:8-21` 必须先构建 unpacked artifact 并启动真实 packaged executable。
2. `desktop-app/scripts/run-release-llm-smoke.mjs:69-80` 必须清除开发态 app-server override，不能使用 `CODEX_APP_SERVER_BIN` 或 Rust workspace fallback。
3. R01–R06 必须整套通过；只有确认外部服务故障时允许设置 `DASCOWORK_RELEASE_EXTERNAL_RETRY=1`，且整套最多重跑一次。
4. 成功后把 `desktop-app/tests/test-plan-coverage.json:3996-4164` 的六项状态统一改为 `covered`，再运行覆盖校验器。
5. 若外部条件缺失或套件失败，R01–R06 保持 `partial`，总体结论不得写“全部完成”。

阶段完成条件：六项 packaged real-LLM 测试同一次套件执行全部通过，coverage 再校验通过，两次以内的脱敏诊断完整保留。

## 5. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 删除文本日志计数后弱化 turn 启动证据 | 用 renderer 收到的 `turn-started` lifecycle、唯一 turn ID 与 main terminal identity 三方对照，证据比 stdout 文本更直接。 |
| callback Promise 只记录首次终态，重复回调继续被隐藏 | 为每个 callback 分支维护独立计数，并在 preload 注册表归零后检查 terminal 总数精确为 1。 |
| D18 marker 命令或路径引用不安全 | 使用测试内专用 shell 参数引用 helper、系统临时目录和固定 marker 文本；不得把用户输入拼进命令。 |
| D18 重复执行发生得很快，单次文件存在检查漏报 | 命令使用追加写入，最终读取行数必须精确等于 1；重复执行会稳定产生第二行并使测试失败。 |
| 附件 tooltip 在 reload 后出现异步竞态 | 使用 Playwright locator/expect 自动等待，逐项 hover 检查，不增加固定 sleep。 |
| 普通聊天附件被错误挂到 A12/B08，造成 coverage 语义污染 | 遵守 `docs/test-plan.md:368` 的范围，在 `docs/test-plan2.md` 单独记录补充回归证据。 |
| 工作区存在大量用户未提交变更 | 实施时只修改本计划列出的文件，不 reset、不覆盖无关变更，每阶段运行 `git diff --check`。 |
| 发布环境不可用 | 明确区分“本地开发完成”和“packaged 发布验收完成”，R01–R06 保持 `partial`。 |

## 6. 完成定义与停止条件

### 可声明“本地开发完成”

- 阶段 A–F 全部满足；
- 相关、全量和 10 次稳定性测试全部通过；
- 134 scenarios 与 M01–M12 coverage 准确；
- app-server 禁改路径无输出。

### 可声明“`docs/test-plan2.md` 全部完成”

- 除上述本地条件外，阶段 G 的 R01–R06 packaged real-LLM suite 同批全部通过；
- 六项 coverage 状态已更新为 `covered` 并重新校验成功。

### 必须停止并报告阻断

- admin backend、真实凭据或 packaged app-server binary 缺失；
- R01–R06 整套执行两次后仍失败；
- 修复需要修改 `codex/codex-rs/app-server` 或新增模型请求路径。

上述阻断出现时，不扩大范围；报告现有通过项、失败证据和仍为 `partial` 的发布项。
