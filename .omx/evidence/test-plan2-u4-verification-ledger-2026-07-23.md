# Test Plan 2 U4 验证账本（2026-07-23）

## 结论与范围

本账本证明 `.omx/plans/test-plan2-unfinished-items-development-plan.md` 的 U4“证据与范围真实性”已按“只测试修改和直接受影响模块”的范围闭环。它不证明 Provider/Desktop 全量门禁、全量 Mock E2E、完整稳定性测试、同 SHA CI 或 packaged real-LLM R01–R06 已通过。

验证根目录：`/Users/nallylin/Documents/code/dasCowork`
验证基准 HEAD：`6b216e3cf4d92be6c47b5a0a476b9f8027b7a1b3`
账本写入时间：`2026-07-23T05:48:43Z`（UTC）

## 唯一自排除规则

本文件是本轮唯一的验证记录容器，因此不记录自己的 SHA-256。任何文件都不能在自身最终内容中稳定保存自己的加密哈希。账本本身仍出现在下方完整 `git status --short --untracked-files=all` 快照中。

除本文件外，账本逐文件记录本轮受影响的计划、文档、source、test 和 manifest 的最终 SHA-256。`docs/test-plan2.md`、原 U1–U4 计划和本 U4 补齐计划均已纳入哈希集合；写入本账本后未再修改它们。

## 完整工作树状态

命令：`git status --short --untracked-files=all`
工作目录：仓库根目录
开始：`2026-07-23T05:48:31.938Z`
结束：`2026-07-23T05:48:33.321Z`
退出码：`0`

```text
A  .github/workflows/desktop-test-plan.yml
A  .omx/plans/reference-aligned-persistent-channel-canonical-terminal-plan.md
A  .omx/plans/test-plan-coverage-and-acceptance-remediation.md
A  .omx/plans/test-plan2-final-gap-closure-development-plan.md
A  .omx/plans/test-plan2-remaining-development-plan.md
A  .omx/plans/test-plan2-remaining-gap-closure-development-plan.md
A  .omx/plans/test-plan2-unfinished-items-development-plan.md
A  desktop-app/docs/RELEASE_HISTORY_mru2plup.md
M  desktop-app/package.json
M  desktop-app/playwright.config.ts
A  desktop-app/scripts/lib/test-plan-coverage-validator.mjs
A  desktop-app/scripts/run-dev-llm-smoke.mjs
A  desktop-app/scripts/run-release-llm-smoke.mjs
A  desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs
A  desktop-app/scripts/verify-test-plan-coverage.mjs
M  desktop-app/src/main/codexApprovalBroker.test.ts
M  desktop-app/src/main/codexApprovalBroker.ts
M  desktop-app/src/main/codexAspProvider.test.ts
M  desktop-app/src/main/codexAspProvider.ts
M  desktop-app/src/main/codexChatRuntimeService.test.ts
M  desktop-app/src/main/codexChatRuntimeService.ts
A  desktop-app/src/main/e2eCheckpointGate.test.ts
A  desktop-app/src/main/e2eCheckpointGate.ts
M  desktop-app/src/main/followUps/ConversationFollowUpQueueService.test.ts
M  desktop-app/src/main/followUps/ConversationFollowUpQueueService.ts
M  desktop-app/src/main/followUps/ConversationFollowUpQueueStore.test.ts
M  desktop-app/src/main/followUps/ConversationFollowUpQueueStore.ts
M  desktop-app/src/main/followUps/FollowUpAssetStore.test.ts
M  desktop-app/src/main/followUps/steerQueuedFollowUp.test.ts
M  desktop-app/src/main/followUps/steerQueuedFollowUp.ts
M  desktop-app/src/main/followUps/validateQueuedLocalAttachments.test.ts
M  desktop-app/src/main/index.ts
M  desktop-app/src/main/localPathCapabilityStore.test.ts
MM desktop-app/src/preload/chatStreamBridge.test.ts
M  desktop-app/src/preload/chatStreamBridge.ts
M  desktop-app/src/preload/index.ts
M  desktop-app/src/renderer/src/App.test.tsx
M  desktop-app/src/renderer/src/App.tsx
M  desktop-app/src/renderer/src/components/assistant-ui/attachment.tsx
M  desktop-app/src/renderer/src/components/assistant-ui/server-request-panel.test.tsx
M  desktop-app/src/renderer/src/components/assistant-ui/server-request-panel.tsx
M  desktop-app/src/renderer/src/components/queued-follow-ups/QueuedFollowUpList.test.tsx
M  desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.navigation.test.ts
M  desktop-app/src/renderer/src/hooks/useCodexIpcAssistantRuntime.ts
M  desktop-app/src/renderer/src/hooks/useConversationFollowUpCoordinator.test.ts
M  desktop-app/src/renderer/src/hooks/useConversationFollowUpCoordinator.ts
M  desktop-app/src/renderer/src/hooks/useConversationFollowUps.test.tsx
M  desktop-app/src/renderer/src/hooks/useConversationFollowUps.ts
M  desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts
M  desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts
M  desktop-app/src/renderer/src/lib/assistantRenderUnits.test.ts
M  desktop-app/src/renderer/src/lib/assistantRenderUnits.ts
M  desktop-app/src/renderer/src/runtime/ConversationChatRegistry.test.ts
M  desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts
A  desktop-app/src/renderer/src/runtime/ConversationTranscriptController.test.ts
A  desktop-app/src/renderer/src/runtime/ConversationTranscriptController.ts
A  desktop-app/src/renderer/src/runtime/ConversationTranscriptRecoveryStore.test.ts
A  desktop-app/src/renderer/src/runtime/ConversationTranscriptRecoveryStore.ts
M  desktop-app/src/shared/codexFollowUpApi.test.ts
M  desktop-app/src/shared/codexFollowUpApi.ts
M  desktop-app/src/shared/codexIpcApi.ts
A  desktop-app/src/shared/uniqueLegacyCandidate.test.ts
A  desktop-app/src/shared/uniqueLegacyCandidate.ts
M  desktop-app/tests/e2e/approvals.e2e.ts
M  desktop-app/tests/e2e/chat.e2e.ts
A  desktop-app/tests/e2e/checkpoint-restart.e2e.ts
M  desktop-app/tests/e2e/conversation-state.e2e.ts
A  desktop-app/tests/e2e/diagnostics.e2e.ts
AM desktop-app/tests/e2e/fault-injection.e2e.ts
A  desktop-app/tests/e2e/follow-up-failures.e2e.ts
M  desktop-app/tests/e2e/follow-up-queue-steer.e2e.ts
A  desktop-app/tests/e2e/release-llm.e2e.ts
AM desktop-app/tests/e2e/support/app.test.ts
MM desktop-app/tests/e2e/support/app.ts
M  desktop-app/tests/e2e/support/chatActions.ts
M  desktop-app/tests/e2e/support/mockBackend.ts
A  desktop-app/tests/e2e/support/terminalScenario.ts
AM desktop-app/tests/test-plan-coverage.json
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-client.ts
A  desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/app-server-connection.ts
A  desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/connection-broker.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/transport-persistent.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/worker-pool.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/client/worker.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/context-catalog-client.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/dynamic-tools.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-client.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/history-mapper.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/index.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/model.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/shared-item-extractors.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/src/provider-settings.ts
A  desktop-app/vendors/ai-sdk-provider-codex-asp/src/turn-error.ts
A  desktop-app/vendors/ai-sdk-provider-codex-asp/src/turn-lifecycle.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/app-server-client.test.ts
A  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/app-server-connection.test.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/context-catalog-client.test.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/cross-call-tools.test.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/dynamic-tools.test.ts
A  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/event-mapper-source-metadata.test.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/event-mapper.test.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/helpers/mock-transport.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/history-client.test.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/history-mapper.test.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/model.stream.test.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/persistent-transport.test.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/provider.test.ts
A  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/turn-lifecycle.test.ts
M  desktop-app/vendors/ai-sdk-provider-codex-asp/tests/worker-pool-affinity.test.ts
M  docs/ai-sdk-provider-codex-asp-api.md
A  docs/test-plan.md
AM docs/test-plan2.md
?? .omx/evidence/test-plan2-u4-verification-ledger-2026-07-23.md
?? .omx/plans/test-plan2-u4-evidence-record-closure-plan.md
?? desktop-app/tests/e2e/support/messagePortStreamProbes.test.ts
?? desktop-app/tests/e2e/support/messagePortStreamProbes.ts
```

该快照是非净工作树的完整记录；因此不声称同 revision CI 已通过。

## 受影响文件 SHA-256

命令：

```bash
shasum -a 256 .omx/plans/test-plan2-unfinished-items-development-plan.md .omx/plans/test-plan2-u4-evidence-record-closure-plan.md docs/test-plan2.md desktop-app/tests/e2e/support/messagePortStreamProbes.ts desktop-app/tests/e2e/support/messagePortStreamProbes.test.ts desktop-app/tests/e2e/support/app.ts desktop-app/tests/e2e/support/app.test.ts desktop-app/tests/e2e/fault-injection.e2e.ts desktop-app/src/preload/chatStreamBridge.test.ts desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts desktop-app/tests/test-plan-coverage.json
```

工作目录：仓库根目录
开始：`2026-07-23T05:48:33.321Z`
结束：`2026-07-23T05:48:34.846Z`
退出码：`0`

```text
6b6998cbfb5acd8c4b5ba7c3b57b83bd5f3d71b9e09df34192fa38262c255030  .omx/plans/test-plan2-unfinished-items-development-plan.md
66d74d94bb87e1c7b37404d247d326ff440f63f4fa287828c07b3633a4439246  .omx/plans/test-plan2-u4-evidence-record-closure-plan.md
3ce30fbc0bb702c5969324031d737bab0d726f6559acad12b5d70b036800fbd7  docs/test-plan2.md
bb08f417a533db9ba2a3cf88373b620e0c41a1b63b8523ffa454a04235a1265a  desktop-app/tests/e2e/support/messagePortStreamProbes.ts
ee9d620897db436a04f4fc7aadccfece2a361cb16b8cbbcc8a236d8c1fdf9cea  desktop-app/tests/e2e/support/messagePortStreamProbes.test.ts
57d8bff83c758840aaa8edc7442f28205b776887367159a888c7b629f2b50d08  desktop-app/tests/e2e/support/app.ts
03ed1fec4f72473d53713e34a68689674a2962c2d045a1f4e598670096a33614  desktop-app/tests/e2e/support/app.test.ts
83e4f6b41f689d6afeaeb5780c4eb6600fd561142604762f03125b3f620e5f07  desktop-app/tests/e2e/fault-injection.e2e.ts
c8fab87723f1ff949b5b16bda7d27186dc43a7179e21673090fed8b5dec4e53f  desktop-app/src/preload/chatStreamBridge.test.ts
b2819d391334e6e1c075df90b6e59d4cc48a66d32f8df7e0692e13d6140174f9  desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts
b386f0f9458d7460db7072a3a6306a6fdc05347f220e4336f83b7c1d4bf71af1  desktop-app/tests/test-plan-coverage.json
```

## 定向验证命令记录

### ESLint

命令：

```bash
npx eslint tests/e2e/support/messagePortStreamProbes.ts tests/e2e/support/messagePortStreamProbes.test.ts tests/e2e/support/app.ts tests/e2e/support/app.test.ts tests/e2e/fault-injection.e2e.ts src/preload/chatStreamBridge.test.ts src/renderer/src/lib/ElectronIpcChatTransport.test.ts
```

工作目录：`desktop-app/`
开始：`2026-07-23T05:39:33.644Z`；结束：`2026-07-23T05:39:42.104Z`；退出码：`0`。
结果：无 lint 输出，命令成功。

### Prettier

命令：

```bash
npx prettier --check tests/e2e/support/messagePortStreamProbes.ts tests/e2e/support/messagePortStreamProbes.test.ts tests/e2e/support/app.ts tests/e2e/support/app.test.ts tests/e2e/fault-injection.e2e.ts src/preload/chatStreamBridge.test.ts src/renderer/src/lib/ElectronIpcChatTransport.test.ts tests/test-plan-coverage.json ../docs/test-plan2.md ../.omx/plans/test-plan2-unfinished-items-development-plan.md ../.omx/plans/test-plan2-u4-evidence-record-closure-plan.md ../.omx/evidence/test-plan2-u4-verification-ledger-2026-07-23.md
```

工作目录：`desktop-app/`
开始：`2026-07-23T05:39:42.104Z`；结束：`2026-07-23T05:39:45.261Z`；退出码：`0`。
结果：`All matched files use Prettier code style!`

### 定向 Vitest

命令：

```bash
npx vitest run tests/e2e/support/messagePortStreamProbes.test.ts tests/e2e/support/app.test.ts src/preload/chatStreamBridge.test.ts src/renderer/src/lib/ElectronIpcChatTransport.test.ts
```

工作目录：`desktop-app/`
开始：`2026-07-23T05:39:45.262Z`；结束：`2026-07-23T05:39:51.690Z`；退出码：`0`。
结果：`Test Files 4 passed (4)`；`Tests 34 passed (34)`。Vite 发出 CommonJS 加载 ES Module 的实验性 Node 警告，但没有测试失败。

### Coverage validator

命令：

```bash
node --test desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs
```

工作目录：仓库根目录
开始：`2026-07-23T05:39:51.690Z`；结束：`2026-07-23T05:39:54.651Z`；退出码：`0`。
结果：`14/14` 通过，`fail=0`。

### Test-plan coverage

命令：

```bash
npm --prefix desktop-app run test:plan-coverage
```

工作目录：仓库根目录
开始：`2026-07-23T05:39:54.651Z`；结束：`2026-07-23T05:39:58.404Z`；退出码：`0`。
结果：内部 validator `14/14` 通过；`Test-plan coverage: 134/134 scenarios; missing=0, partial=0, covered=134, deferred=0, not-applicable=0`。

### Manifest 分组统计

命令：

```bash
node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync("desktop-app/tests/test-plan-coverage.json","utf8"));for(const [label,rows] of [["scenarios",m.scenarios],["mockE2E",m.mockE2E],["releaseE2E",m.releaseE2E]]){const counts=rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});console.log(label,rows.length,counts)}'
```

工作目录：仓库根目录
开始：`2026-07-23T05:39:58.404Z`；结束：`2026-07-23T05:39:59.662Z`；退出码：`0`。

```text
scenarios 134 { covered: 134 }
mockE2E 12 { covered: 12 }
releaseE2E 6 { partial: 6 }
```

### MessagePort 12 路清理 E2E

命令：

```bash
npx playwright test tests/e2e/fault-injection.e2e.ts --grep 'cleans twelve real MessagePort streams' --repeat-each=10 --workers=1 --retries=0 --reporter=line --output test-results/message-port-probes
```

工作目录：`desktop-app/`
开始：`2026-07-23T05:43:49.505Z`；结束：`2026-07-23T05:46:21.782Z`；退出码：`0`。
结果：`10 passed (2.5m)`；无 retry。产物目录：`desktop-app/test-results/message-port-probes`。

### 附件跨会话恢复 E2E

命令：

```bash
npx playwright test tests/e2e/chat.e2e.ts --grep 'preserves a workspace reference, local file, folder and image after conversation switch and reload' --repeat-each=10 --workers=1 --retries=0 --reporter=line --output test-results/chat-attachments
```

工作目录：`desktop-app/`
开始：`2026-07-23T05:46:33.126Z`；结束：`2026-07-23T05:47:56.021Z`；退出码：`0`。
结果：`10 passed (1.3m)`；无 retry。产物目录：`desktop-app/test-results/chat-attachments`。

### E2E 产物状态与数量

命令：

```bash
node -e 'const fs=require("node:fs");for(const file of ["desktop-app/test-results/message-port-probes/.last-run.json","desktop-app/test-results/chat-attachments/.last-run.json"]){const run=JSON.parse(fs.readFileSync(file,"utf8"));if(run.status!=="passed"||run.failedTests.length!==0)throw new Error(`${file} is not a clean pass`);console.log(`${file}: passed, failedTests=0`)}'
find desktop-app/test-results/message-port-probes -mindepth 1 -maxdepth 1 -type d | wc -l
find desktop-app/test-results/chat-attachments -mindepth 1 -maxdepth 1 -type d | wc -l
```

工作目录：仓库根目录
开始：`2026-07-23T05:48:34.846Z`；结束：`2026-07-23T05:48:38.581Z`；三个命令退出码均为 `0`。

```text
desktop-app/test-results/message-port-probes/.last-run.json: passed, failedTests=0
desktop-app/test-results/chat-attachments/.last-run.json: passed, failedTests=0
message-port-probes run directories: 10
chat-attachments run directories: 10
```

## 边界与格式检查

### Diff 检查

命令：`git diff --check HEAD`
工作目录：仓库根目录
开始：`2026-07-23T05:48:38.581Z`；结束：`2026-07-23T05:48:39.962Z`；退出码：`0`。
结果：无输出。

### 禁改 app-server 路径

命令：

```bash
git diff --name-only HEAD -- codex/codex-rs/app-server
git status --short --untracked-files=all -- codex/codex-rs/app-server
```

工作目录：仓库根目录
开始：`2026-07-23T05:48:39.962Z`；结束：`2026-07-23T05:48:42.490Z`；两个命令退出码均为 `0`。
结果：两个命令均无输出；`codex/codex-rs/app-server/` 没有 tracked 或 untracked 改动。

## 明确未执行项

以下项目按用户和原 U1–U4 计划的范围约束未执行，也不以本账本的通过结果替代：

- Provider 全量 lint、typecheck、测试；
- Desktop 全量 lint、typecheck、Vitest；
- 全量 Mock E2E 与 `test:e2e:stability`；
- 同 revision CI；
- packaged real-LLM R01–R06。

R01–R06 在 manifest 中仍为 `partial`（`releaseE2E 6 { partial: 6 }`），没有被修改为 `covered`。
