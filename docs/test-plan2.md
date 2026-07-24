# 测试计划未完成项补完计划

## Summary

目标是严格满足原计划的完成条件：修正 Steer 状态偏差，消除覆盖清单错误标绿，补齐关键跨层测试、重启/审批证据和稳定性门禁，最后完成 packaged real-LLM 发布验收。禁止修改 `codex/codex-rs/app-server`，不新增模型调用路径。

## Implementation Changes

1. **修正 Steer 未确认状态**

   - 修改 [codexChatRuntimeService.ts](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.ts:1281)：RPC 已成功但没有 canonical 确认时，无论 `completed`、`failed` 或 `interrupted` 先到，都进入 `paused-recovery-uncertain`。
   - RPC 明确拒绝时继续使用 `steer-rejected` 或 `turn-race`，不得混入“不确定”分支。
   - 抽取共享的唯一旧版匹配函数，供 main 和 renderer 使用；多个相同 compare key 时不接受任何候选，并记录只含 turn ID、候选数量和消息 ID 的脱敏诊断。
   - 增加 completed、failed、interrupted、30 秒超时、迟到 canonical 和重复 terminal 的假时钟测试。

2. **修复覆盖清单和校验器**

   - 为每条 `evidence` 增加 `layer` 和 `assertions`；`assertions` 必须引用该场景的 `requiredAssertions`。
   - 修改 [verify-test-plan-coverage.mjs](/Users/nallylin/Documents/code/dasCowork/desktop-app/scripts/verify-test-plan-coverage.mjs:99)，要求 `covered` 场景的证据覆盖全部 `requiredLayer`，且证据的 assertion 并集覆盖全部必需断言。
   - 重新审计 134 个场景：协议映射使用 provider-unit，队列/IPC/持久化使用 desktop-unit 或 integration，只有跨 renderer→IPC→main→provider→app-server 的用户可见链路要求 mock-e2e。不得为了通过校验删除真正需要的测试层。
   - P0/P1、M01–M12 不允许 `missing`、`partial` 或 `deferred`；P2 如延期，必须记录原因、负责人和后续计划路径。
   - 增加 fixture 测试，证明校验器会拒绝缺层、缺断言、伪造测试名、重复 ID、P0/P1 延期和 release 错误标绿。

3. **补齐跨层与故障测试**

   - Provider：增加 Desktop 实际 shared connection 路径的 active-stream crash 测试，覆盖首 token 前、部分输出后、error+close 去重、1 秒内终态、worker 重建和 pending/listener 清零。
   - MessagePort：增加 main→preload→renderer 故障集成测试，覆盖 port close、messageerror、fallback 先后顺序、无 fallback 超时和 12 个并发 stream 全部清理。
   - 对仍声明 `mock-e2e` 的 P0/P1 场景补齐真实 E2E 证据，优先 B11、C22、C23、D18、E13–E17、G11。
   - 普通聊天补充文件夹附件完整链路，覆盖发送、历史重载和对话切换。

4. **强化 Mock E2E 验收设施**

   - 将 [expectTerminalScenario](/Users/nallylin/Documents/code/dasCowork/desktop-app/tests/e2e/support/terminalScenario.ts:24) 改为始终断言：唯一 terminal 及类型、UI 终态、Composer、queue 状态/顺序/revision、turn 数、provider 请求数、tool/approval 次数、active run、lease、page error 和未处理 Promise。
   - M01–M12 每组拥有独立测试名；拆分当前合并的 M02/M06，用共享 setup 减少重复。
   - `launchApp` 增加统一应用就绪检查，等待 renderer、模型目录和 E2E bridge 完成，替换仅检查页面文本的启动判断。
   - 所有测试使用唯一端口和临时目录；关闭 Electron、backend 和 app-server 后验证资源确实释放。

5. **补齐真实重启和审批安全**

   - 在测试环境增加可控 checkpoint gate：canonical 前、canonical 后 queue commit 前、工具完成后最终生成失败。
   - Playwright 等待 checkpoint 后真实关闭 Electron，再使用相同 `userDataDir` 和 `CODEX_HOME` 重启；不再通过直接修改 `queue.json` 代替崩溃边界。
   - 增加审批等待期间 app 重启、拒绝、停止和 transport failure 组合；晚到审批响应必须失效。
   - E2E 诊断快照增加脱敏后的 approval request IDs；D18 必须证明第二次 call ID、approval ID 都不同，批准前执行次数为零，旧审批不可复用。

6. **稳定性、CI 与发布门禁**

   - 修复全量 E2E 中 M11 和 M02/M06 的偶发启动/重载失败；隔离重跑通过不能作为稳定性完成证据。
   - `test:e2e:stability` 使用单 worker、`--repeat-each=10`、`--retries=0`；任意一次失败即阻断。
   - 保持 [desktop-test-plan.yml](/Users/nallylin/Documents/code/dasCowork/.github/workflows/desktop-test-plan.yml:41) 的 Provider、Desktop、coverage、Mock E2E、稳定性和禁改路径顺序，并上传脱敏诊断。
   - 使用 [run-release-llm-smoke.mjs](/Users/nallylin/Documents/code/dasCowork/desktop-app/scripts/run-release-llm-smoke.mjs:8) 构建并启动 unpacked packaged artifact，完整执行 R01–R06；禁止开发态 binary 和 cargo fallback。
   - 六项全部通过后，才将 [R01–R06](/Users/nallylin/Documents/code/dasCowork/desktop-app/tests/test-plan-coverage.json:3994) 从 `partial` 改为 `covered`。外部服务故障只允许整套重跑一次，并保留两次脱敏诊断。

## Test Plan

- Provider：lint、typecheck、全部单测；重点验证 active transport crash、worker 重建和资源归零。
- Desktop：lint、typecheck、全部单测；重点验证 Steer 未确认状态、共享旧版匹配、覆盖校验器和 MessagePort。
- Mock E2E：全量零失败；M01–M12 独立通过且共享断言覆盖所有必需字段。
- 稳定性：所有异常标签场景单 worker、无 retry、重复十次全通过。
- Release：R01–R06 针对 packaged artifact 全部通过，唯一 terminal、Composer 恢复、无错误卡、历史和工具结构正确。
- 最终执行 `git diff --check HEAD`，并确认 `codex/codex-rs/app-server` 无任何改动。

### 补充普通聊天附件回归

- 普通聊天不属于 `docs/test-plan.md` 的 A–G 覆盖矩阵，因此不将它伪装成 B08 证据，也不写入 134 项 manifest。
- [chat.e2e.ts](/Users/nallylin/Documents/code/dasCowork/desktop-app/tests/e2e/chat.e2e.ts) 单独验证工作区引用、本地文件、文件夹与图片：发送内容只传路径、不传本地文件内容；切换对话及页面重载后，三个附件的身份和图片预览均保持正确；全程只产生一次 provider 请求。

### 本轮验证记录（2026-07-22）

验证 revision：`6b216e3` 加本次未提交的测试与 coverage 修正。

- `node --test desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs`：14/14 通过。
- `npm --prefix desktop-app run test:plan-coverage`：134/134 场景 covered，`missing=0`、`partial=0`、`deferred=0`。
- `npx vitest run tests/e2e/support/app.test.ts`：2/2 通过；`npx vitest run src/preload/chatStreamBridge.test.ts src/renderer/src/lib/ElectronIpcChatTransport.test.ts`：22/22 通过。
- `npx playwright test tests/e2e/fault-injection.e2e.ts --grep 'cleans twelve real MessagePort streams' --repeat-each=10 --workers=1 --retries=0 --reporter=line`：10/10 通过。
- `npx playwright test tests/e2e/chat.e2e.ts --grep 'preserves a workspace reference, local file, folder and image after conversation switch and reload' --repeat-each=10 --workers=1 --retries=0 --reporter=line`：10/10 通过。
- `npx playwright test tests/e2e/approvals.e2e.ts --grep 'D18 @approval-retry requires new turn, approval, and call ids before rerunning a side-effecting tool' --repeat-each=10 --workers=1 --retries=0 --reporter=line`：10/10 通过。
- `npx playwright test tests/e2e/fault-injection.e2e.ts tests/e2e/chat.e2e.ts tests/e2e/approvals.e2e.ts --workers=1 --retries=0 --reporter=line`：19/19 通过。

本轮未执行 packaged real-LLM 的 R01–R06；六项继续保持 `partial`，不以本地 Mock E2E 结果替代发布验收。

### 剩余本地证据缺口闭环记录（2026-07-23）

验证基准、完整非净工作树状态、所有受影响计划/文档/source/test/manifest 的 SHA-256，以及每条验证命令的 cwd、完整参数、时间、退出码和结果摘要，统一记录在 [U4 验证账本](/Users/nallylin/Documents/code/dasCowork/.omx/evidence/test-plan2-u4-verification-ledger-2026-07-23.md:1)。账本是唯一自排除的记录容器：它本身会出现在 `git status --short --untracked-files=all` 快照中，但不记录自身 SHA-256；其余受影响文件（包括本文档与两个计划）均必须逐文件列出并二次复算。

- `npx eslint`（MessagePort probe、readiness、fault-injection、G11 preload/renderer 测试）：通过；`npx prettier --check`（相同文件、manifest 与本文档）：通过。
- `npx vitest run tests/e2e/support/messagePortStreamProbes.test.ts tests/e2e/support/app.test.ts src/preload/chatStreamBridge.test.ts src/renderer/src/lib/ElectronIpcChatTransport.test.ts`：34/34 通过。覆盖了第 7 路故意失败后仍附加 `message-port-stream-probes.json`、renderer probe 不可用、readiness bridge 缺失/RPC reject/RPC timeout，以及 finish-first、aborted-first、error-first 的唯一终态。
- `node --test desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs`：14/14 通过；`npm --prefix desktop-app run test:plan-coverage`：134/134 场景 covered，`missing=0`、`partial=0`、`deferred=0`。
- `npx playwright test tests/e2e/fault-injection.e2e.ts --grep 'cleans twelve real MessagePort streams' --repeat-each=10 --workers=1 --retries=0 --reporter=line --output test-results/message-port-probes`：10/10 通过；状态记录在 [message-port-probes/.last-run.json](/Users/nallylin/Documents/code/dasCowork/desktop-app/test-results/message-port-probes/.last-run.json:1)。
- `npx playwright test tests/e2e/chat.e2e.ts --grep 'preserves a workspace reference, local file, folder and image after conversation switch and reload' --repeat-each=10 --workers=1 --retries=0 --reporter=line --output test-results/chat-attachments`：10/10 通过；状态记录在 [chat-attachments/.last-run.json](/Users/nallylin/Documents/code/dasCowork/desktop-app/test-results/chat-attachments/.last-run.json:1)。
- 覆盖组计数：A–G `134/134 covered`，M01–M12 `12/12 covered`，R01–R06 `6/6 partial`。
- `git diff --check HEAD`：通过；`git diff --name-only HEAD -- codex/codex-rs/app-server`：无输出。

按本轮范围，未执行 Provider/Desktop 全量 lint/typecheck/Vitest、全量 Mock E2E、完整 `test:e2e:stability`、同 SHA CI，以及 packaged real-LLM R01–R06。上述排除项保持未取得证据；本记录仅证明受影响模块的本地证据缺口已经闭环。

## Acceptance Criteria

- 134 个场景状态准确；不存在 `missing` 或 `partial`，P0/P1 和 M01–M12 全部 `covered`。
- 校验器能够拒绝测试层或必需断言缺失的假 `covered`。
- RPC 成功但 canonical 缺失的所有终止竞态统一进入 `paused-recovery-uncertain`。
- 重启测试在真实 checkpoint 关闭应用后仍正确恢复错误、已消费 Steer、未消费队列和不确定状态。
- D18 精确证明新 turn、新 call ID、新 approval ID，且不存在自动执行或自动批准。
- 全量 Mock E2E、十次稳定性、PR CI 和 packaged R01–R06 全绿。
- 最终报告列出 covered/deferred/not-applicable 数量及验证命令结果；真实发布验收未通过前不得宣称计划完成。

## Assumptions

- 最终发布阶段能够提供真实 admin backend、模型凭据和 packaged app-server binary；缺少这些条件时，代码补完可以完成，但总体计划仍保持“发布验收阻断”。
- 不修改产品对完成、失败、取消的用户可见语义，只修复实现与既定规则的偏差。
- 不新增依赖，不修改 Codex app server，不绕过现有 Provider/App Server 链路。
