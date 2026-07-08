# Render-Unit Reference Parity Phase 2 Completion Note

日期：2026-07-07

## 完成结论

- Phase 2 开发已完成。P0/P1 Phase 2 render unit 不再有 `fallback` 或 `temporary` completion blocker；P2 `exploration` 也已从 temporary fallback 升级为 custom renderer。
- `endResources` 和 `reviewComments` 已按参考项目对齐为客户端派生 render-unit：renderer 保留安全资源卡片和评论导航渲染，但 app-server 协议不再定义这两个 `ThreadItem`。
- 旧的 `review-comments` kebab-case 形状保留为本地会话兼容渲染；canonical app-server/provider 协议不承载 final resources 或 review comments。
- `worked-for` 与 `realtime-transcript` 保持 P3 intentional/known-null：当前桌面文本线程没有稳定 `ThreadItem` 来源，`realtime-transcript` 仅存在于实验性 realtime 通知。

## 已完成内容

- 新增 `desktop-app/src/renderer/src/lib/renderUnitCapabilityMatrix.ts`，把 entry render mode 从散列表升级为带 renderer、优先级、fallback 原因和 test owner 的 capability matrix；测试会阻止 P0/P1 Phase 2 项以 fallback/temporary 状态被算作完成。
- 抽出 Render-Unit 专用组件与 helper：
  - `desktop-app/src/renderer/src/components/render-units/renderUnitDetails.tsx`
  - `desktop-app/src/renderer/src/components/render-units/renderUnitAttributes.ts`
  - `desktop-app/src/renderer/src/lib/renderUnitNavigation.ts`
- MCP 单次和分组调用现在走 rich renderer，覆盖 source badge、参数、content blocks、structured/raw output、error/empty 状态；普通 server MCP 不再必须落回 generic fallback。
- Web search group 展开后显示 query、action、running/completed 状态和可选 favicon。
- Exploration 会把 reference `exec.parsedCmd` 和当前 `commandExecution.commandActions` 中的 read/list/search 归一为 custom render-unit，显示“正在探索/已探索”、文件数、搜索数、目录数和内部活动明细。
- Collapsed activity summary 增加 active summary、detail rows、MCP named source、web-search query、loaded tool name、diff line counts 和 stopped creating detail。
- `automaticApprovalReview`、permission/model/worktree/automation/context/error 等 entry 有 custom renderer 或 matrix 说明。
- `todoList` 和 `turnDiff` 已从 app-server `turn/plan/updated`、`turn/diff/updated` 通知经 provider 映射为 AI SDK dynamic tool parts，并进入 custom render unit；large diff 有确定性截断。
- `generated-image` 不再按 temporary 计入 Phase 2 blocker；provider image file part 到 renderer generated-image gallery 的链路已有单测覆盖。
- `endResources`、`reviewComments`、`review-comments` 保留 renderer shell 和安全打开/导航行为；这些形状按参考项目作为客户端派生 UI 数据处理，不进入 app-server/provider ThreadItem 契约。
- Generated image 支持 item-driven gallery 和 provider image file part gallery；缺 preview 时显示 pending/placeholder。
- Timeline navigation helper 支持 item id/callId/target id 定位、展开折叠父 group、scroll/focus 和 1s retry false-return，并已接入 renderer 内部 `codex:scroll-render-target` 事件入口。
- http(s) final resource rows 继续通过 `desktopCodex.openExternalHttpUrl` 安全打开；本地 file resource 和 review comment file/line 现在通过新增的 `desktopCodex.openLocalPath` preload/main IPC 打开，renderer 不直接访问 Node/Electron。
- Web search pending 输入态和 final item 被拆开：运行中的 input-only `codex_web_search` 可显示 pending，完成后的 input-only tool part 不再被当成 final web search 支持。
- MCP content block 支持 canonical `resource`、`resource_link` 和兼容 `embedded_resource`，web search favicon 使用独立 sanitizer 允许 `https:`/`data:` 并拒绝不安全协议。
- Running turn 中的 active TODO/diff 会进入 live footer，完成态恢复为普通 transcript render units，避免重复展示。
- `codex/codex-rs/app-server-protocol/src/protocol/v2/item.rs` 不包含 `EndResource`、`ReviewComment`、`ThreadItem::EndResources` 或 `ThreadItem::ReviewComments`；JSON/TypeScript schema fixtures 已验证与该协议源一致。
- `desktop-app/vendors/ai-sdk-provider-codex-asp` 不再把 `endResources`、`reviewComments` 当作 app-server ThreadItem 映射；实时 event mapper 与 history mapper 覆盖范围回到参考项目式基础协议。
- Renderer matrix 已把 `endResources`、`reviewComments` 标记为 client-derived `fallbackLevel: 'none'`，并用测试固定“app-server protocol does not define this ThreadItem”的边界。
- Renderer matrix 已把 `exploration` 标记为 `custom`/`fallbackLevel: 'none'`，并把 `worked-for`、`realtime-transcript` 固定为 P3 intentional non-text-thread gaps。

## 验证

- `RUSTUP_TOOLCHAIN=stable cargo fmt -p codex-app-server-protocol`
  - passed.
- `RUSTUP_TOOLCHAIN=stable cargo run -p codex-app-server-protocol --bin write_schema_fixtures -- --schema-root app-server-protocol/schema`
  - passed; JSON 和 TypeScript schema fixtures 已更新。
- `RUSTUP_TOOLCHAIN=stable cargo test -p codex-app-server-protocol schema_fixtures_match_generated --test schema_fixtures`
  - 2 tests passed.
- `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint`
  - passed.
- `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck`
  - passed.
- `npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run test`
  - 15 files passed, 134 tests passed.
- `npm --prefix desktop-app run typecheck`
  - passed.
- `npm --prefix desktop-app test`
  - 34 files passed, 264 tests passed.
- `npm --prefix desktop-app run test:e2e -- --reporter=line`
  - 10 tests passed.
- `npm --prefix desktop-app run lint`
  - passed.
- `npm --prefix desktop-app test -- assistantRenderUnits.test.ts renderUnitCapabilityMatrix.test.ts App.test.tsx`
  - 3 files passed, 81 tests passed after the exploration renderer follow-up.

## 后续注意事项

- Final resources 和 review comments 现在不是 app-server/provider 协议项；如果后续要继续对齐参考项目，应该在本地 conversation adapter 从 completed turn artifacts、助手消息链接和用户评论附件中派生，而不是重新扩展 app-server ThreadItem。
- 大 diff 由 provider 截断到 50,000 字符并保留 `originalLength`/`truncated` metadata；UI 仍只展示摘要和文件行数。
- 已执行 Playwright e2e 覆盖真实桌面聊天流和 web search render unit；资源/评论作为客户端派生 render-unit，由 app-server schema fixture 的“不存在协议项”验证、provider mapper tests 和 renderer tests 共同锁定。
- `exploration` 是 renderer 侧聚合能力，不扩展 app-server/provider 协议；若未来要纳入 live footer，需要另行证明 reference 行为和用户价值。
