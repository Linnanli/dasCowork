# E2E 拆分与 Render-Unit 缺口补测计划

日期：2026-07-08

模式：`$plan` direct mode

## Requirements Summary

目标是把目前集中在 `desktop-app/tests/e2e/chat.e2e.ts` 的 e2e 测试拆成更清楚的领域文件，并补上 render-unit 里真实桌面聊天链路还缺少的关键覆盖。

本计划只生成实施方案，不直接修改测试代码。后续实施时应保持行为不变，先做低风险 helper 抽取，再移动现有测试，最后补新增 e2e。

核心边界：

- 继续使用 Playwright Electron e2e，入口仍由 `desktop-app/playwright.config.ts` 管理。
- e2e 只覆盖真实 renderer -> preload IPC -> main -> provider -> Codex app-server -> mock admin backend 的链路。
- 不为了凑覆盖率而把纯 fixture、纯组件、没有真实 app-server 来源的 render-unit 强行写成 e2e。
- 拆分目标是可维护性，不承诺提速，因为 `desktop-app/playwright.config.ts:10` 当前固定 `workers: 1`。

## Current Evidence

- `desktop-app/tests/e2e/chat.e2e.ts` 当前有 1021 行，包含测试、Electron 启动、mock backend、SSE 响应构造、auth fixture、项目选择、诊断收集等全部逻辑。
- Playwright 已支持多文件 e2e：`desktop-app/playwright.config.ts:4` 指向 `./tests/e2e`，`desktop-app/playwright.config.ts:5` 匹配 `**/*.e2e.ts`。
- `chat.e2e.ts` 当前测试领域混杂：
  - 基础聊天和 provider 链路：`desktop-app/tests/e2e/chat.e2e.ts:62`、`desktop-app/tests/e2e/chat.e2e.ts:105`、`desktop-app/tests/e2e/chat.e2e.ts:154`。
  - 审批面板：`desktop-app/tests/e2e/chat.e2e.ts:197`、`desktop-app/tests/e2e/chat.e2e.ts:250`。
  - render-unit 真实链路：`desktop-app/tests/e2e/chat.e2e.ts:303`。
  - sidebar、项目和 reload 历史：`desktop-app/tests/e2e/chat.e2e.ts:377`、`desktop-app/tests/e2e/chat.e2e.ts:411`、`desktop-app/tests/e2e/chat.e2e.ts:481`、`desktop-app/tests/e2e/chat.e2e.ts:527`。
- 当前 e2e 的 render-unit 覆盖只验证 web search 和 exploration：
  - web search 卡片：`desktop-app/tests/e2e/chat.e2e.ts:341`。
  - web search 详情：`desktop-app/tests/e2e/chat.e2e.ts:345` 到 `desktop-app/tests/e2e/chat.e2e.ts:347`。
  - exploration 卡片：`desktop-app/tests/e2e/chat.e2e.ts:349` 到 `desktop-app/tests/e2e/chat.e2e.ts:352`。
- 当前 helper 全部和测试同文件：
  - `launchApp`、`closeApp`、临时目录清理：`desktop-app/tests/e2e/chat.e2e.ts:572` 到 `desktop-app/tests/e2e/chat.e2e.ts:620`。
  - 消息发送、项目选择、会话断言：`desktop-app/tests/e2e/chat.e2e.ts:622` 到 `desktop-app/tests/e2e/chat.e2e.ts:670`。
  - 诊断收集：`desktop-app/tests/e2e/chat.e2e.ts:672` 到 `desktop-app/tests/e2e/chat.e2e.ts:715`。
  - mock backend 和 SSE 响应：`desktop-app/tests/e2e/chat.e2e.ts:717` 到 `desktop-app/tests/e2e/chat.e2e.ts:1021`。
- 组件/单元测试已有较完整的 render-unit 覆盖，但它们不是完整桌面链路：
  - collapsed tool activity：`desktop-app/src/renderer/src/App.test.tsx:1075` 到 `desktop-app/src/renderer/src/App.test.tsx:1115`。
  - web、dynamic MCP、pending MCP、多 agent 分组：`desktop-app/src/renderer/src/App.test.tsx:1118` 到 `desktop-app/src/renderer/src/App.test.tsx:1169`。
  - rich MCP 内容和 web search 详情：`desktop-app/src/renderer/src/App.test.tsx:1171` 到 `desktop-app/src/renderer/src/App.test.tsx:1229`。
  - custom entry units，包括 todo、turn diff、generated image、end resources、review comments、approval review：`desktop-app/src/renderer/src/App.test.tsx:1297` 到 `desktop-app/src/renderer/src/App.test.tsx:1379`。
  - turn diff 打开路径、相对路径、缺 cwd、大文件折叠、多文件展开：`desktop-app/src/renderer/src/App.test.tsx:1382` 到 `desktop-app/src/renderer/src/App.test.tsx:1515`。
  - live footer：`desktop-app/src/renderer/src/App.test.tsx:1540` 到 `desktop-app/src/renderer/src/App.test.tsx:1601`。
- turn diff 有真实协议来源，值得补 e2e：
  - app-server 定义 `turn/diff/updated`：`codex/codex-rs/app-server/README.md:1356`。
  - app-server 定义 `fileChange` item：`codex/codex-rs/app-server/README.md:1374`。
  - file change 审批生命周期：`codex/codex-rs/app-server/README.md:1460` 到 `codex/codex-rs/app-server/README.md:1468`。
  - provider 将 `turn/diff/updated` 映射为 `codex_turn_diff`：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:655` 到 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:687`。
  - provider 单测覆盖该映射并带 cwd：`desktop-app/vendors/ai-sdk-provider-codex-asp/tests/event-mapper.test.ts:1504` 到 `desktop-app/vendors/ai-sdk-provider-codex-asp/tests/event-mapper.test.ts:1545`。
- 有些 render-unit 不适合强行补真实 e2e：
  - `endResources` 是客户端派生形态，app-server 协议没有该 ThreadItem：`desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:352` 到 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:359`。
  - `reviewComments` 是客户端派生形态，app-server 协议没有该 ThreadItem：`desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:361` 到 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:368`。
  - `realtime-transcript` 是实验 realtime 通知，不是持久 text-thread ThreadItem：`desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:403` 到 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:410`，对应协议也标记为 experimental：`codex/codex-rs/app-server/README.md:1328` 到 `codex/codex-rs/app-server/README.md:1340`。

## Target Structure

建议拆成以下文件：

```text
desktop-app/tests/e2e/
  support/
    app.ts
    chatActions.ts
    mockBackend.ts
    authFixtures.ts
  chat.e2e.ts
  approvals.e2e.ts
  render-units.e2e.ts
  sidebar.e2e.ts
```

职责划分：

- `support/app.ts`：`launchApp`、`closeApp`、`cleanupTempDirs`、`collectRendererLogs`、`attachDiagnostics`，来源是 `desktop-app/tests/e2e/chat.e2e.ts:572` 到 `desktop-app/tests/e2e/chat.e2e.ts:715`。
- `support/chatActions.ts`：`sendMessage`、`sendComposerMessage`、`ensureLocalProjectSelected`、`createLocalProject`、`expectConversationInAuthoritativeList`，来源是 `desktop-app/tests/e2e/chat.e2e.ts:622` 到 `desktop-app/tests/e2e/chat.e2e.ts:670`。
- `support/mockBackend.ts`：`startMockBackend`、`assistantMessageResponse`、`shellCommandResponse`、`webSearchResponse`、`providerResponseBodies`、`functionCallOutputText`、`deferred`、SSE helpers、request/body helpers，来源是 `desktop-app/tests/e2e/chat.e2e.ts:717` 到 `desktop-app/tests/e2e/chat.e2e.ts:1021`。
- `support/authFixtures.ts`：`writeStandaloneWebSearchConfig`、`writeFakeChatGptAuth`、`fakeChatGptIdToken`、`base64UrlJson`，来源是 `desktop-app/tests/e2e/chat.e2e.ts:894` 到 `desktop-app/tests/e2e/chat.e2e.ts:947`。
- `chat.e2e.ts`：只保留基础聊天、provider 请求、quota 错误、响应未返回前创建 sidebar conversation 这类聊天主链路。
- `approvals.e2e.ts`：只放 command approval accept/reject。
- `render-units.e2e.ts`：放现有 web search + exploration，并新增真实链路能稳定产出的 render-unit 覆盖。
- `sidebar.e2e.ts`：放项目切换、打开历史会话、reload 后保持项目和会话、新会话持久化。

## Acceptance Criteria

1. `desktop-app/tests/e2e/chat.e2e.ts` 行数降到 350 行以内，并且不再定义 `launchApp`、`startMockBackend`、SSE helper、auth fixture 这类共享工具。
2. `desktop-app/tests/e2e/support/app.ts`、`desktop-app/tests/e2e/support/mockBackend.ts`、`desktop-app/tests/e2e/support/chatActions.ts`、`desktop-app/tests/e2e/support/authFixtures.ts` 都有明确导出，没有循环依赖。
3. `desktop-app/tests/e2e/chat.e2e.ts` 只保留基础聊天、provider 请求、quota、响应 pending 时 sidebar conversation 建立这 4 类测试。
4. `desktop-app/tests/e2e/approvals.e2e.ts` 包含 approve 和 reject 两条审批测试，并继续断言 provider 第二次 `/responses` 请求带有 tool output。
5. `desktop-app/tests/e2e/sidebar.e2e.ts` 包含当前 4 条 sidebar/history/reload 测试，断言仍覆盖项目名、会话标题、历史恢复和 continued prompt。
6. `desktop-app/tests/e2e/render-units.e2e.ts` 包含当前 web search + exploration 测试，并至少新增 1 条真实链路 render-unit 测试。
7. 新增 render-unit e2e 的首选目标是 turn diff。测试必须通过真实 Electron app、真实 provider/app-server 事件映射看到 `[data-slot="turn-diff-entry-unit"]`，不能直接在 renderer 注入 fixture。
8. 如果 turn diff 无法由当前 mock backend 稳定驱动，实施者必须在计划执行记录里写清楚阻塞证据，并改补一条真实 command/file activity 可稳定产出的 collapsed activity e2e。
9. 不为 `endResources`、`reviewComments`、`realtime-transcript` 新增伪 e2e，除非先新增或发现真实 app-server/provider 来源。
10. `npm --prefix desktop-app run test:e2e -- --list` 能列出拆分后的多个 `*.e2e.ts` 文件，并且现有 10 条测试名称仍存在。
11. `npm --prefix desktop-app run test:e2e -- --reporter=line` 通过；若失败，失败必须是新拆分或新增测试导致的可复现问题，不能以“原本就可能失败”结束。
12. `npm --prefix desktop-app test -- App.test.tsx assistantRenderUnits.test.ts toolGroupSummary.test.ts renderUnitCapabilityMatrix.test.ts` 通过，证明拆分和 e2e 补测没有破坏 render-unit 单元覆盖。

## Implementation Steps

1. 建立 support 目录并抽取无行为变化的 helper。

   先新增 `desktop-app/tests/e2e/support/app.ts`，移动 `launchApp`、`closeApp`、`cleanupTempDirs`、`collectRendererLogs`、`attachDiagnostics`。保留当前环境变量，包括 `ADMIN_BACKEND_URL`、`CODEX_ASP_DEBUG_PACKETS`、`CODEX_APP_SERVER_DISABLE_MANAGED_CONFIG`、`CODEX_HOME`、`DASCOWORK_E2E_USER_DATA_DIR`，来源为 `desktop-app/tests/e2e/chat.e2e.ts:587` 到 `desktop-app/tests/e2e/chat.e2e.ts:596`。

   再新增 `desktop-app/tests/e2e/support/chatActions.ts`，移动消息发送、项目选择和会话列表断言。该文件需要从 `@playwright/test` 导入 `expect`，因为 `sendMessage` 和 `expectConversationInAuthoritativeList` 直接使用 Playwright 断言。

   然后新增 `desktop-app/tests/e2e/support/mockBackend.ts`，移动 mock backend、response builder、provider body 解析和 `deferred`。所有类型如 `MockBackend`、`MockBackendOptions`、`ResponsesStreamStep` 应导出给测试文件复用。

   最后新增 `desktop-app/tests/e2e/support/authFixtures.ts`，移动 standalone web search 相关的 `CODEX_HOME` 配置和 fake ChatGPT auth。该文件依赖 `MockBackend` 类型即可，不应依赖具体 e2e spec。

2. 在不改测试行为的前提下分拆现有 spec。

   把 `desktop-app/tests/e2e/chat.e2e.ts:197` 到 `desktop-app/tests/e2e/chat.e2e.ts:301` 移到 `desktop-app/tests/e2e/approvals.e2e.ts`。

   把 `desktop-app/tests/e2e/chat.e2e.ts:303` 到 `desktop-app/tests/e2e/chat.e2e.ts:375` 移到 `desktop-app/tests/e2e/render-units.e2e.ts`。

   把 `desktop-app/tests/e2e/chat.e2e.ts:377` 到 `desktop-app/tests/e2e/chat.e2e.ts:570` 移到 `desktop-app/tests/e2e/sidebar.e2e.ts`。

   保留 `desktop-app/tests/e2e/chat.e2e.ts:62` 到 `desktop-app/tests/e2e/chat.e2e.ts:195` 的基础聊天类测试，并把共享 imports 替换成 support 模块导入。

3. 先验证纯拆分。

   运行：

   ```bash
   npm --prefix desktop-app run test:e2e -- --list
   npm --prefix desktop-app run test:e2e -- --reporter=line -g "real desktop chat|sidebar conversation|quota"
   npm --prefix desktop-app run test:e2e -- --reporter=line -g "command request"
   npm --prefix desktop-app run test:e2e -- --reporter=line -g "web search and exploration"
   npm --prefix desktop-app run test:e2e -- --reporter=line -g "sidebar|reload|conversation"
   ```

   只有这些都通过后，再补新 e2e。这样如果后面新增测试失败，可以快速判断不是拆分本身破坏了链路。

4. 补 turn diff 真实链路 e2e，作为优先新增覆盖。

   在 `desktop-app/tests/e2e/render-units.e2e.ts` 新增测试，目标名称建议：

   ```text
   renders turn diff render unit after a real file change through the desktop chat flow
   ```

   预期链路：

   - 使用 `mkdtemp` 建立一个临时项目目录，写入一个简单文件，例如 `notes.txt`。
   - 通过 `createLocalProject(page, projectName, tempProjectRoot)` 选中临时项目。
   - 使用 mock backend 返回一个能让 app-server 触发 file change 的 scripted response。
   - 如果 app-server 发送 file change approval，测试用 approval panel 接受。
   - 等待 assistant 结束后，断言 `[data-slot="turn-diff-entry-unit"]` 可见。
   - 断言卡片包含 `代码变更`、目标文件名、`+` 或 `-` 行数摘要。
   - 若 UI 暴露打开文件按钮，只断言按钮存在或可用，不在 e2e 中真的打开系统编辑器。

   实施前必须先确认当前 app-server/provider 对 mock OpenAI Responses 的 file-change 触发方式。证据入口：

   - file change 生命周期文档：`codex/codex-rs/app-server/README.md:1460` 到 `codex/codex-rs/app-server/README.md:1468`。
   - turn diff 通知文档：`codex/codex-rs/app-server/README.md:1356`。
   - provider turn diff 映射：`desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:655` 到 `desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/event-mapper.ts:687`。

   如果 current mock backend 无法稳定触发 app-server 的 fileChange，不要改成 renderer fixture。记录阻塞后改走第 5 步。

5. 准备一个 fallback 新增 e2e：collapsed activity 或 completed file activity。

   如果 turn diff 不能稳定驱动，新增一条真实 command/file activity 分组 e2e。优先用两个连续的 harmless command 或两个 file activity，断言 renderer 最终出现 `[data-slot="collapsed-tool-activity-unit"]`，并且默认闭合、展开后能看到详情。

   这条 fallback 的价值来自现有组件单测只证明 UI 行为：`desktop-app/src/renderer/src/App.test.tsx:1075` 到 `desktop-app/src/renderer/src/App.test.tsx:1115`。e2e 应证明真实 provider/app-server events 能落到同一个 render-unit 分组里。

   如果真实链路由于 app-server 事件顺序或 UI grouping 条件导致不稳定，也不要硬写。保留组件覆盖，并在实施记录里写明“未新增该 e2e”的原因。

6. 明确不补的 e2e 缺口，并保留单元测试做主覆盖。

   不新增 `endResources` 真实 e2e，原因是它是客户端派生形态且协议没有 ThreadItem，见 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:352` 到 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:359`。

   不新增 `reviewComments` 真实 e2e，原因是它是客户端派生形态且协议没有 ThreadItem，见 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:361` 到 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:368`。

   不新增 `realtime-transcript` e2e，原因是它属于 experimental realtime API，不是当前 text-thread 的持久 ThreadItem，见 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:403` 到 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts:410`。

   `live-render-unit-footer` 不作为本轮必补 e2e。它依赖 running turn 的中间态，现有组件测试已经覆盖 footer 出现、完成后回到正文、审批阻塞时不进 footer，见 `desktop-app/src/renderer/src/App.test.tsx:1540` 到 `desktop-app/src/renderer/src/App.test.tsx:1601`。除非能通过 mock backend 稳定延迟并观察 running state，否则不要把它做成容易抖的 e2e。

7. 清理命名和重复代码。

   拆分后统一命名：

   - `backend` 仍表示 mock admin/backend provider 服务。
   - `logs` 仍表示 main/renderer 日志集合。
   - response builder 继续用 `assistantMessageResponse`、`shellCommandResponse`、`webSearchResponse`。
   - 新增 file-change response builder 时应放在 `support/mockBackend.ts`，不要只写在 `render-units.e2e.ts` 里。

   避免每个 spec 重复写 `test.skip(browserName !== 'chromium', ...)` 的大段样板。如果要抽，可以新增一个小 helper，例如 `skipUnlessChromium(browserName)`，但只有在拆分后重复明显时再加，避免为了抽象而抽象。

8. 做完整验证并记录结果。

   先跑 e2e list，确认拆分被 Playwright 发现：

   ```bash
   npm --prefix desktop-app run test:e2e -- --list
   ```

   再跑分组验证：

   ```bash
   npm --prefix desktop-app run test:e2e -- --reporter=line -g "real desktop chat|sidebar conversation|quota"
   npm --prefix desktop-app run test:e2e -- --reporter=line -g "command request"
   npm --prefix desktop-app run test:e2e -- --reporter=line -g "render unit"
   npm --prefix desktop-app run test:e2e -- --reporter=line -g "sidebar|reload|conversation"
   ```

   最后跑全量 e2e 和相关单元测试：

   ```bash
   npm --prefix desktop-app run test:e2e -- --reporter=line
   npm --prefix desktop-app test -- App.test.tsx assistantRenderUnits.test.ts toolGroupSummary.test.ts renderUnitCapabilityMatrix.test.ts
   ```

   如果改动触碰 TypeScript imports 或 shared helper 类型，补跑：

   ```bash
   npm --prefix desktop-app run typecheck:node
   npm --prefix desktop-app run typecheck:web
   ```

## Render-Unit Coverage Decision Table

| Capability | Current strongest coverage | E2E action |
| --- | --- | --- |
| web search | `chat.e2e.ts:303` 到 `chat.e2e.ts:375` | 移到 `render-units.e2e.ts`，保留 |
| exploration | `chat.e2e.ts:303` 到 `chat.e2e.ts:375` | 移到 `render-units.e2e.ts`，保留 |
| turnDiff | provider 映射在 `event-mapper.ts:655` 到 `event-mapper.ts:687`，UI 在 `App.test.tsx:1382` 到 `App.test.tsx:1515` | 本轮优先新增真实链路 e2e |
| collapsed tool activity | UI 在 `App.test.tsx:1075` 到 `App.test.tsx:1115` | turn diff 不可行时作为 fallback |
| pending MCP / dynamic MCP / multi-agent | UI 在 `App.test.tsx:1118` 到 `App.test.tsx:1169` | 本轮不强行补，除非已有稳定真实 MCP/app source |
| endResources | `App.test.tsx:1297` 到 `App.test.tsx:1379`，能力矩阵说明无 app-server ThreadItem | 不补真实 e2e |
| reviewComments | `App.test.tsx:1297` 到 `App.test.tsx:1379`，能力矩阵说明无 app-server ThreadItem | 不补真实 e2e |
| live footer | `App.test.tsx:1540` 到 `App.test.tsx:1601` | 不作为必补，除非能稳定观察 running state |
| realtime-transcript | 能力矩阵 known-null，协议 experimental | 不补 |

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| helper 抽取引入循环依赖或类型导出问题 | e2e 编译失败 | support 文件按单向依赖组织：spec -> support，support 之间最多 `app.ts` 引用 `MockBackend` 类型 |
| 分拆后 imports 漏掉 `expect`、`Page`、`TestInfo` 类型 | Playwright 编译失败 | 每拆一个文件就跑 `npm --prefix desktop-app run test:e2e -- --list` |
| turn diff 真实链路难以通过 mock Responses 稳定触发 | 新 e2e 可能卡住或抖动 | 先做最小 spike，无法稳定触发就转 fallback，不写 renderer fixture e2e |
| file change approval 会弹审批面板 | 测试需要额外交互 | 复用 approvals e2e 的 panel 操作模式，必要时接受 approval 后再等 diff card |
| live footer 依赖 running 状态，时间窗口短 | e2e 容易 flaky | 本轮不作为必补，只保留组件测试覆盖 |
| 拆分后测试不会变快 | 用户误以为这是性能优化 | 明确 `workers: 1`，本轮收益是维护性和定位速度，不是并发提速 |
| 新增 e2e 太多导致 CI 时间变长 | 反馈变慢 | 本轮最多新增 1 到 2 条关键真实链路测试 |

## Verification Steps

实施完成后按顺序验证：

1. `npm --prefix desktop-app run test:e2e -- --list`

   期望：Playwright 列出 `chat.e2e.ts`、`approvals.e2e.ts`、`render-units.e2e.ts`、`sidebar.e2e.ts` 下的测试；原有 10 条测试都还在；新增 render-unit 测试也在列表里。

2. `npm --prefix desktop-app run test:e2e -- --reporter=line -g "real desktop chat|sidebar conversation|quota"`

   期望：基础聊天链路仍通过，provider 请求仍走 `/responses`，quota 错误仍只显示在 assistant 区域。

3. `npm --prefix desktop-app run test:e2e -- --reporter=line -g "command request"`

   期望：approve/reject 两条都通过，provider 第二次请求仍包含对应 tool output。

4. `npm --prefix desktop-app run test:e2e -- --reporter=line -g "render unit"`

   期望：web search + exploration 继续通过；新增 turn diff 或 fallback collapsed activity 通过。

5. `npm --prefix desktop-app run test:e2e -- --reporter=line -g "sidebar|reload|conversation"`

   期望：项目切换、历史会话、reload 后项目和会话恢复都通过。

6. `npm --prefix desktop-app run test:e2e -- --reporter=line`

   期望：全量 e2e 通过。

7. `npm --prefix desktop-app test -- App.test.tsx assistantRenderUnits.test.ts toolGroupSummary.test.ts renderUnitCapabilityMatrix.test.ts`

   期望：render-unit 相关单元测试全部通过。

8. `npm --prefix desktop-app run typecheck:node && npm --prefix desktop-app run typecheck:web`

   期望：TypeScript 类型检查通过。若只拆测试且项目没有把 e2e 纳入这些 typecheck，也仍可作为 import/type 侧面验证。

## Stop Condition

可以宣布完成的条件：

- e2e 文件已经按领域拆分，`chat.e2e.ts` 不再承担所有 helper 和全部场景。
- 现有 10 条 e2e 行为不丢失。
- 至少新增一条真实链路 render-unit e2e，优先 turn diff；如果 turn diff 不可行，已用证据说明并补了稳定 fallback。
- 不适合做真实 e2e 的 render-unit 已明确保留在单元/组件层覆盖，且原因写清楚。
- 全量 e2e 和 render-unit 单元测试通过，或任何剩余失败都有明确、可复现、非本改动引入的说明。
