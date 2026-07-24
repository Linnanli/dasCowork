# Test Plan 2 未完成项开发计划（受影响模块范围）

## 1. 需求摘要

本计划承接对 `.omx/plans/test-plan2-remaining-gap-closure-development-plan.md` 的完成度审查，只处理截至 2026-07-23 仍缺少直接证据的本地开发项。目标是补齐 MessagePort 失败诊断的反向契约、readiness 异常分支测试、G11 三类终态竞态证据，并只回归本次修改及直接受影响的模块。

本轮约束：

- 只测试本次修改和直接受影响的测试/helper/coverage 模块，不执行 Provider、Desktop 或 Mock E2E 的全量套件。
- 跳过 packaged real-LLM R01–R06；`desktop-app/tests/test-plan-coverage.json:3994-4160` 的六项继续保持 `partial`，不得用 Mock E2E 替代发布证据。
- 不要求同 revision CI 作为本轮完成条件；未提交工作区不能宣称已经取得同 SHA CI 证据。
- 禁止修改 `codex/codex-rs/app-server/`，不新增依赖，不扩大模型调用路径。
- 本计划完成后只能声明“剩余本地证据缺口已按受影响模块闭环”，不能声明原计划的全量门禁或发布验收已经完成。

## 2. 当前基线与未完成清单

### 2.1 已完成且不重复开发

- 覆盖声明 fixture 已补齐并通过，入口位于 `desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs:106-152`。
- 12 路 MessagePort 的正常成功路径已包含唯一 stream/thread/turn、单终态和资源归零断言，见 `desktop-app/tests/e2e/fault-injection.e2e.ts:232-408`；已有 10/10 定向通过记录。
- 普通附件恢复、tooltip、canonical terminal 及一次 provider 请求已经落地，见 `desktop-app/tests/e2e/chat.e2e.ts:314-454`；已有 10/10 定向通过记录。
- D18 的 marker 与 `function_call_output` 精确 `0 → 1` 计数已经落地，见 `desktop-app/tests/e2e/approvals.e2e.ts:503-577` 和 `desktop-app/tests/e2e/support/mockBackend.ts:281-291`；已有 10/10 定向通过记录。
- G11 已移除属于 G12 的脱敏声明，当前 manifest 位于 `desktop-app/tests/test-plan-coverage.json:3474-3505`。

### 2.2 本轮必须完成

| ID  | 未完成项                                                                                | 当前证据                                                                                                                                                                                                                              | 完成要求                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | MessagePort 失败诊断没有自动化反向测试                                                  | 失败标签和附件逻辑已存在于 `desktop-app/tests/e2e/fault-injection.e2e.ts:37-60,362-405`，但没有测试故意制造单路错误并验证错误文本与附件                                                                                               | 用同一生产测试 helper 注入一个坏 probe，证明异常文本包含 `index`/`streamId`，并证明断言失败后的 `finally` 仍附加脱敏 JSON                                               |
| U2  | readiness 的 RPC 拒绝、超时和 bridge 缺失分支没有单元测试，通用失败快照也缺三项关键状态 | 分支内联在 `desktop-app/tests/e2e/support/app.ts:84-173`；`captureVisibleE2eSnapshot` 在 `app.ts:411-478` 只有 Composer 四字段，没有 `bridgeReady`、`modelCatalogReady`、`probeError`；`app.test.ts:1-76` 目前只验证 G12 脱敏         | 抽出可独立调用且可被 `page.evaluate` 序列化的 readiness 采样函数，覆盖成功、bridge 缺失、RPC reject、RPC timeout；让通用诊断快照复用并保留全部七个字段                  |
| U3  | G11 只直接覆盖 error-first，缺少 finish-first/abort-first 的对称竞态证据                | `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts:341-396` 先触发 error；`desktop-app/src/preload/chatStreamBridge.test.ts:105-172` 分散覆盖 abort 与 main terminal，但未用一个 G11 契约覆盖三种首终态及全部迟到终态 | 增加静态命名的表驱动单测，分别让 finish、aborted、error 先到，再发送其余终态，逐例证明只调用首终态一次且 stream/callback registry 归零；将该测试准确登记为 G11 evidence |
| U4  | 原阶段 F 的完成定义与“只测受影响模块”约束冲突，文档仍有过期和不可复现引用               | 原计划 `test-plan2-remaining-gap-closure-development-plan.md:193-246` 要求全量本地门禁和同 SHA CI；`docs/test-plan2.md:51` 仍链接旧 manifest 行 `2258`，`:69` 只写短 SHA 加未提交改动                                                 | 以本计划第 6 节的定向门禁替代本轮验收；修正 R01–R06 引用，记录完整 HEAD、worktree 状态与受影响文件逐文件哈希，并如实列出已执行、未执行和排除项                          |

### 2.3 仍未执行，但按用户约束排除在本轮之外

以下事项仍是原计划的未完成项，必须保留为“未执行/未取得证据”，但本轮不开发、不运行：

- Provider lint、typecheck、全部测试，原入口为 `.github/workflows/desktop-test-plan.yml:41-46`。
- Desktop 全量 lint、typecheck、Vitest，原入口为 `.github/workflows/desktop-test-plan.yml:48-53`。
- 全量 Mock E2E 与完整 `test:e2e:stability`，原入口为 `.github/workflows/desktop-test-plan.yml:58-62` 和 `desktop-app/package.json:14-15`。
- 当前未提交 revision 对应的 CI 全绿证据；工作区未形成可供 CI 校验的固定 commit SHA。
- Packaged real-LLM R01–R06；当前仍为 `partial`，见 `desktop-app/tests/test-plan-coverage.json:3994-4160`。

## 3. 可测试验收标准

### U1：MessagePort 反向诊断契约

- 从 `fault-injection.e2e.ts` 抽出 probe 类型、逐流断言和附件采集到 `desktop-app/tests/e2e/support/messagePortStreamProbes.ts`，E2E 本身调用该 helper，避免测试副本与实际路径分叉。
- 新增 `desktop-app/tests/e2e/support/messagePortStreamProbes.test.ts`，构造 `index=7`、`streamId=stream-7` 且终态计数错误的 probe；断言抛错文本同时包含 `stream index=7`、`streamId=stream-7` 和失败字段语义。
- 反向测试用 `try/finally` 模拟 E2E 失败路径；即使逐流断言抛错，伪 `testInfo.attach` 仍恰好收到一次 `message-port-stream-probes.json`。
- 附件 body 能解析为 JSON，包含坏 probe 或明确的 `unavailable` 原因，并通过 `serializeDiagnosticData` 脱敏。
- 真实 12 路 E2E 的成功路径仍为 12 个非空唯一 stream ID、每路唯一 thread/turn、至少一个 delta、恰好一个 error terminal、provider 请求数 12、全部资源归零。

### U2：readiness 异常分支

- 在 `desktop-app/tests/e2e/support/app.ts:84-173` 抽出无模块闭包依赖的 `collectAppReadinessSnapshot`；`expectAppReady` 通过 `page.evaluate` 调用该函数，ready 判定仍严格要求 bridge、model、mount、editable、send 为真且 stop 为假。
- `app.test.ts` 使用 `jsdom`，分别构造 Composer DOM 与 `window.desktopApp.codex` stub。
- 成功分支逐项返回 `bridgeReady=true`、`modelCatalogReady=true`、Composer 三字段正确、`stopButtonPresent=false`、`probeError=null`。
- bridge 缺失返回固定可读错误；RPC reject 保留原始错误消息；never-settling RPC 在可注入的短 deadline 后返回 `E2E readiness probe timed out`。
- timeout 测试结束后不存在遗留 fake timer 或未处理 Promise；生产默认 deadline 保持 3 秒，总体 poll timeout 保持 20 秒，不增加全局 timeout/retry。
- `captureVisibleE2eSnapshot` 复用同一采样函数，输出 `bridgeReady`、`modelCatalogReady`、Composer 四字段和 `probeError`；RPC 失败时诊断附件保留错误原因，而不是只显示 DOM 布尔值。

### U3：G11 首终态胜出

- 在 `desktop-app/src/preload/chatStreamBridge.test.ts:105-172` 附近新增静态测试名 `G11 dispatches only the first finish, aborted, or error terminal`。
- 使用三个独立 bridge/stream case：finish-first、aborted-first、error-first；每例首终态后再投递另外两种终态及首终态重复事件。
- 每例只有对应 callback 被调用一次，另外两个 terminal callback 为 0；`activeStreamCount=0`、`callbackRegistryCount=0`。
- 如 renderer transport 还缺对应 side-effect 断言，则只在 `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts:341-396` 扩展同一表格，确保 `onStreamFinished`、`onStreamAborted`、`onStreamError` 只有胜出者执行一次。
- `desktop-app/tests/test-plan-coverage.json:3481-3504` 只登记测试直接证明的断言；不得把错误路径 E2E 写成 finish/abort 路径 evidence。

### U4：证据与范围真实性

- 修正 `docs/test-plan2.md:51` 的 R01–R06 链接；在 G11 manifest 修改完成后，用 `rg -n '"id": "R01"' desktop-app/tests/test-plan-coverage.json` 获取最终实际行号，禁止继续保留旧行 `2258` 或预先锁定可能再次漂移的行号。
- `docs/test-plan2.md:67-89` 新增 2026-07-23 验证记录，包含完整 `HEAD` SHA、`git status --short`、所有受影响文件的逐文件 SHA-256、完整命令、退出码、通过数、A–G/M/R 分组计数和两个定向 E2E 独立产物目录。
- 文档明确列出未运行的 Provider/Desktop 全量、全量 Mock E2E、完整 stability、同 SHA CI 和 R01–R06。
- 本轮不修改 R01–R06 的 `status`，不将本轮结论写成“原计划全部完成”。
- 附件身份口径写实：文件/文件夹用 `data-attachment-name` 与 tooltip；图片用 provider path、恢复后的 `app://fs/` 文件名后缀和 alt。除非产品明确把图片 `data-attachment-name` 定义为原始文件名，否则不得添加已知不稳定的等值断言。
- `git diff --check HEAD` 为零退出，`git diff --name-only HEAD -- codex/codex-rs/app-server` 无输出。
- 文件指纹必须显式包含两个新增且可能仍 untracked 的 MessagePort support 文件；不得用会遗漏 untracked 文件的 `git diff HEAD` 单一哈希冒充完整 worktree 指纹。

## 4. 实施步骤

### 阶段 1：抽取并反向验证 MessagePort probe 契约

涉及文件：

- 新增 `desktop-app/tests/e2e/support/messagePortStreamProbes.ts`
- 新增 `desktop-app/tests/e2e/support/messagePortStreamProbes.test.ts`
- 修改 `desktop-app/tests/e2e/fault-injection.e2e.ts:24-60,232-408`

步骤：

1. 移动 `MessagePortStreamProbe` 类型、stream label、逐流断言和附件采集；保留 `serializeDiagnosticData` 作为唯一序列化入口。
2. 将附件采集结果定义为“streams 数组”或“unavailable 原因”的显式 union，page 未创建、evaluate reject 都不能变成空数组假成功。
3. 让真实 12 路 E2E 在 `try` 中调用共享逐流断言，并在现有 `finally` 中调用共享附件 helper。
4. 写反向单测：故意破坏第 7 路终态计数，捕获断言错误，同时在 `finally` 附加 probe；逐项检查错误文本、附件名、content type 和 JSON body。
5. 写 evaluate 失败单测，确认附件记录 `unavailable` 且不覆盖原始断言异常。

完成条件：反向测试能稳定证明“错误可定位、附件不丢失”，真实 12 路 E2E 10/10 通过。

### 阶段 2：提取并测试 readiness 采样器

涉及文件：

- `desktop-app/tests/e2e/support/app.ts:84-173`
- `desktop-app/tests/e2e/support/app.test.ts:1-76`

步骤：

1. 定义 `AppReadinessSnapshot`，固定七个字段：`bridgeReady`、`modelCatalogReady`、`composerMounted`、`composerEditable`、`sendButtonPresent`、`stopButtonPresent`、`probeError`。
2. 将浏览器侧采样逻辑抽成 closure-free 导出函数，deadline 作为参数传入；`expectAppReady` 继续用生产默认值调用，`captureVisibleE2eSnapshot` 也复用同一函数并合并七个 readiness 字段。
3. 在 `app.test.ts` 标注 `jsdom`，每例恢复 DOM、timer 和 `window.desktopApp`，避免污染现有 G12 用例。
4. 补成功、bridge 缺失、runtime/catalog reject、timeout 四组测试；错误分支仍保留 Composer DOM 的真实子状态。
5. 运行附件 E2E 10 次，验证抽取没有改变 reload 后 ready 门禁语义。

完成条件：异常原因有直接单测，通用诊断附件保留完整 readiness 状态，附件 E2E 10/10 通过且不依赖新增 retry/timeout。

### 阶段 3：补齐 G11 三类终态次序

涉及文件：

- `desktop-app/src/preload/chatStreamBridge.test.ts:105-172,227-275,311-380`
- 必要时修改 `desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts:341-396`
- `desktop-app/tests/test-plan-coverage.json:3474-3505`

步骤：

1. 用一个静态命名、内部表驱动的测试创建三条独立 stream，覆盖 finish-first、aborted-first、error-first。
2. 每条 stream 发送首终态、两种迟到终态和一次首终态重复事件，断言只触发胜出 callback 一次。
3. 开启 E2E diagnostics 计数，逐例检查 active stream 与 callback registry 清零。
4. 若 preload 层已完整证明终态仲裁，不为凑数量修改产品代码；只有 renderer side effect 仍有实际缺口时才扩展 transport test。
5. 在 coverage manifest 新增/替换为准确 evidence，并运行 validator，确保静态测试名可解析且 G11 仍为 `covered`。

完成条件：三种首终态均有对称直接证据，manifest 不再依赖对 error-first 用例的语义外推。

### 阶段 4：执行受影响模块门禁并更新证据

只顺序执行第 6 节命令；不并行启动多个 Electron/Playwright 进程。任何失败先保留 trace、截图、`desktop-chat-diagnostics.json` 和 `message-port-stream-probes.json`，修复后从失败命令起重跑受影响链路。

完成条件：所有定向命令零退出，文档准确记录已运行与未运行项，禁改路径无差异。

## 5. 风险与缓解

| 风险                                                                  | 缓解措施                                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 提取的 readiness 函数依赖模块闭包，`page.evaluate` 在真实浏览器中失败 | 函数体只引用参数、局部函数和 `window`/`document`；单元测试之外必须跑附件真实 E2E 10 次  |
| 反向诊断测试只测了副本，没有覆盖真实 E2E helper                       | 类型、断言和附件逻辑全部移入共享 support 文件，真实 E2E 与反向单测导入同一实现          |
| G11 新测试仍只覆盖一种首终态                                          | 验收固定要求 finish-first、aborted-first、error-first 三行 case，且每行发送全部迟到终态 |
| coverage 文案超过直接断言                                             | manifest 只认领“首终态唯一”和“资源归零”，错误路径 E2E 不认领未执行的 finish/abort 行为  |
| 定向测试通过被误写成全量计划完成                                      | 文档单列排除项；完成结论限定为“受影响模块闭环”                                          |
| E2E 再次因独立进程争用失败                                            | 两个重型 E2E 命令单 worker、无 retry、顺序执行；不通过提高全局 timeout 掩盖问题         |

## 6. 验证步骤

先在 `desktop-app/` 目录执行格式与定向单元测试：

```bash
npx eslint \
  tests/e2e/support/messagePortStreamProbes.ts \
  tests/e2e/support/messagePortStreamProbes.test.ts \
  tests/e2e/support/app.ts \
  tests/e2e/support/app.test.ts \
  tests/e2e/fault-injection.e2e.ts \
  src/preload/chatStreamBridge.test.ts \
  src/renderer/src/lib/ElectronIpcChatTransport.test.ts

npx prettier --check \
  tests/e2e/support/messagePortStreamProbes.ts \
  tests/e2e/support/messagePortStreamProbes.test.ts \
  tests/e2e/support/app.ts \
  tests/e2e/support/app.test.ts \
  tests/e2e/fault-injection.e2e.ts \
  src/preload/chatStreamBridge.test.ts \
  src/renderer/src/lib/ElectronIpcChatTransport.test.ts \
  tests/test-plan-coverage.json \
  ../docs/test-plan2.md

npx vitest run \
  tests/e2e/support/messagePortStreamProbes.test.ts \
  tests/e2e/support/app.test.ts \
  src/preload/chatStreamBridge.test.ts \
  src/renderer/src/lib/ElectronIpcChatTransport.test.ts
```

再从仓库根目录执行 coverage：

```bash
node --test desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs
npm --prefix desktop-app run test:plan-coverage
```

然后将命令工作目录设为 `desktop-app/`，顺序执行两个受影响的真实 E2E：

```bash
npx playwright test tests/e2e/fault-injection.e2e.ts \
  --grep 'cleans twelve real MessagePort streams' \
  --repeat-each=10 --workers=1 --retries=0 --reporter=line \
  --output test-results/message-port-probes

npx playwright test tests/e2e/chat.e2e.ts \
  --grep 'preserves a workspace reference, local file, folder and image after conversation switch and reload' \
  --repeat-each=10 --workers=1 --retries=0 --reporter=line \
  --output test-results/chat-attachments
```

不得通过切换测试范围或增加 retry 获得通过。两个命令使用不同 `--output`，因此第二次执行不能清理第一次的 `message-port-stream-probes.json`；文档分别记录 `desktop-app/test-results/message-port-probes` 和 `desktop-app/test-results/chat-attachments`。

在仓库根目录用只读统计命令生成 A–G/M/R 分组计数：

```bash
node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync("desktop-app/tests/test-plan-coverage.json","utf8"));for(const [label,rows] of [["scenarios",m.scenarios],["mockE2E",m.mockE2E],["releaseE2E",m.releaseE2E]]){const counts=rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});console.log(label,rows.length,counts)}'
```

预期至少包含：`scenarios 134` 且 `covered: 134`、`mockE2E 12` 且 `covered: 12`、`releaseE2E 6` 且 `partial: 6`。

最后回到仓库根目录执行证据与边界检查：

```bash
git rev-parse HEAD
git status --short
shasum -a 256 \
  .omx/plans/test-plan2-unfinished-items-development-plan.md \
  desktop-app/tests/e2e/support/messagePortStreamProbes.ts \
  desktop-app/tests/e2e/support/messagePortStreamProbes.test.ts \
  desktop-app/tests/e2e/support/app.ts \
  desktop-app/tests/e2e/support/app.test.ts \
  desktop-app/tests/e2e/fault-injection.e2e.ts \
  desktop-app/src/preload/chatStreamBridge.test.ts \
  desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts \
  desktop-app/tests/test-plan-coverage.json \
  docs/test-plan2.md
git diff --check HEAD
git diff --name-only HEAD -- codex/codex-rs/app-server
```

本轮明确不执行：

```text
Provider 全量 lint/typecheck/test
Desktop 全量 lint/typecheck/Vitest
全量 Mock E2E
完整 test:e2e:stability
同 revision CI
test:e2e:release-llm（R01–R06）
```

## 7. 完成定义与停止条件

满足以下全部条件后，可声明本计划完成：

- U1–U3 的测试和 evidence 均已落地；反向诊断、readiness 异常、三类首终态都有直接断言。
- 第 6 节所有定向命令零退出，两个 E2E 各 10/10 通过。
- Coverage 保持 A–G 134/134、M01–M12 `covered`；R01–R06 保持 `partial`。
- `docs/test-plan2.md` 明确记录受影响模块验证及排除项。
- `codex/codex-rs/app-server` 无改动。

遇到以下情况必须停止扩大范围并保留未完成状态：

- 需要修改 `codex/codex-rs/app-server/` 才能通过。
- 反向测试证明附件 helper 在原异常下仍会丢失，且不能在测试 support 层闭环。
- readiness 抽取改变了产品可发送语义，或必须增加全局 retry/timeout 才能稳定。
- 三种终态的首事件胜出规则在产品实现中不一致；此时先记录失败 case，再单独评估最小产品修复及其直接受影响模块。
- 定向 E2E 10 次中任意一次失败；单独重跑一次通过不能替代 10/10。

本计划完成后，原计划仍保留第 2.3 节的全量/CI/发布未完成项；只有用户另行授权执行这些门禁并取得证据后，才能更新更高层完成结论。
