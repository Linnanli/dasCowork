# 参考项目“终端”工作区能力追踪表

实施更新：2026-08-09。状态“已闭环”表示实现和自动化测试均已存在；“有意差异”表示保留了计划明确允许的安全收敛，且不是遗漏。macOS 打包原生模块和本机 loopback 真实 SSH 已实机验证；独立远端主机、Windows/Linux 打包仍是环境型发布门禁，不能由 mock 或同机 loopback 代替。

## 会话、IPC 与生命周期

| ID | 状态 | 实现文件 | 自动化测试证据 |
| --- | --- | --- | --- |
| T01 | 已闭环 | `src/main/terminal/TerminalSessionManager.ts` | `TerminalSessionManager.test.ts` manager/map/capacity cases |
| T02 | 已闭环 | `src/shared/terminalWorkspaceApi.ts`、`src/main/rightWorkspace/registerRightWorkspaceIpc.ts`、`src/preload/index.ts` | `terminalWorkspaceApi.test.ts`；manager ACK/action cases |
| T03 | 已闭环 | `TerminalSessionManager.ts` fallback attach | manager “falls back … without another spawn” |
| T04 | 已闭环 | `TerminalSessionManager.ts` `rekey` | manager fallback/rekey case |
| T05 | 已闭环 | `TerminalSessionManager.ts` `syncCwdFromTarget` | manager 重新解析 main-owned target，cwd 或 Shell 变化时真实重启 backend 用例 |
| T06 | 已闭环 | `TerminalSessionManager.ts` `detachOwner`/`closeOwner` | manager detach vs owner-close case |
| T07 | 已闭环 | `terminalOutputBuffer.ts` | manager 10 MiB output/tail case |
| T08 | 已闭环 | `terminalSessionStore.ts`、`TerminalWorkspace.tsx` | `TerminalWorkspace.test.ts` init-once/data-increment case |
| T09 | 已闭环 | API v2 `TerminalWorkspaceAck`、manager write/resize | manager ACK-only case |
| T10 | 已闭环 | manager dimensions + renderer `lastResizeRef` | `TerminalWorkspace.test.ts` resize dedupe case |
| T11 | 已闭环 | API v2 `restart`、manager backend restart、`TerminalWorkspace.tsx` retry | manager exited/error/connection-lost restart；terminal 失败后重试用例 |
| T12 | 已闭环（有界 tombstone 增强） | `TerminalSessionManager.ts` prune/release | fast-exit、100-cycle、error/lost 容量释放、tombstone 裁剪用例 |
| T39 | 已闭环 | `ConversationApiService.ts`、`TerminalSessionManager.ts` `closeForConversation` | `ConversationApiService.test.ts`、manager archive case |

## xterm、焦点、滚动与标题

| ID | 状态 | 实现文件 | 自动化测试证据 |
| --- | --- | --- | --- |
| T13 | 已闭环 | `terminalActiveView.ts`、`App.tsx` | `terminalActiveView.test.ts` focus/no-focus/global-intent cases |
| T14 | 有意差异：不新增 addon 依赖，以 xterm LinkProvider + Clipboard API 等价实现 | `terminalKeyHandler.ts`、`TerminalWorkspace.tsx` | `terminalKeyHandler.test.ts` clipboard/link cases；FitAddon 由 terminal component 加载 |
| T15 | 已闭环 | `terminalKeyHandler.ts` | key handler shortcut/copy/paste/control-sequence cases |
| T16 | 已闭环 | `TerminalSessionManager.ts`、`workspaceReducer.ts` | manager action-title case；`workspaceReducer.test.ts` title case |
| T17 | 已闭环 | `TerminalWorkspace.tsx` `isNearBottom` | terminal “does not force viewport … scrollback” case |
| T18 | 已闭环 | `terminalKeyHandler.ts` + `workspaceFocusManager.ts` | key handler single-owner Cmd/Ctrl+T case |
| T19 | 已闭环 | `TerminalWorkspace.tsx` automatic attach/create | terminal lifecycle case；RW-E2E-01 |
| T20 | 已闭环 | stable tab ID store、`WorkspacePanelController.ts`、持久化 scope 迁移 | panel/controller/persistence tests；RW-E2E-03/06/07/08 |
| T21 | 已闭环 | `terminalSessionStore.ts` pending write/action queues | write/action FIFO、starting 不提前冲刷、detach 保留 action、create/attach/restart/close 失败拒绝 pending promise 用例 |
| T36 | 已闭环 | `terminalKeyHandler.ts` safe HTTP(S) callback | key handler link case |
| T37 | 已闭环 | `terminalTheme.ts` | `terminalTheme.test.ts` apply/refit/dispose cases |
| T38 | 已闭环 | `TerminalWorkspace.tsx` cleanup | terminal lifecycle detach-on-unmount case; theme observer dispose case |

## Shell、cwd、动作与 AI 工具

| ID | 状态 | 实现文件 | 自动化测试证据 |
| --- | --- | --- | --- |
| T22 | 已闭环 | `TerminalSessionManager.ts` action restart + `terminalCommand.ts` | manager serial action case；`terminalCommand.test.ts` |
| T23 | 有意差异：不创建独立 headless session；已提供 attached-session 动作入口 | `terminalSessionStore.ts` `runTerminalAction` | store action FIFO case |
| T24 | 已闭环 | `codexAspProvider.ts`、`readThreadTerminalTool.ts` | `codexAspProvider.test.ts` dynamic tool case |
| T25 | 有意差异：main-only snapshot，避免 renderer/window fallback 跨边界 | `readThreadTerminalTool.ts`、manager | reader sanitizer/no-thread cases；provider dynamic-tool case |
| T26 | 已闭环 | `TerminalSessionManager.ts` owner-bound `readThreadTerminal` | manager thread mapping/archive/跨 owner 拒绝用例；provider dynamic-tool case |
| T27 | 已闭环 | `terminalShellCatalog.ts`、v2 `listShells` IPC、`TerminalPreferencesMenu.tsx` | catalog 测试；preferences menu 枚举/保存 shellId 用例 |
| T28 | 已闭环 | `terminalPreferences.ts`、`terminalTheme.ts`、`TerminalPreferencesMenu.tsx` | 偏好校验、字体 8–32 限制、同窗口实时更新/refit 用例 |
| T29 | 已闭环 | `RemoteProject.terminalCommand` → `ProjectService` → manager；`runtimeConfig.ts` global command | project schema, runtime config, catalog and manager priority cases |
| T30 | 已闭环 | `terminalEnvironment.ts` | `terminalEnvironment.test.ts` |
| T34 | 已闭环 | `terminalCommand.ts` | `terminalCommand.test.ts` POSIX/PowerShell/cmd/WSL cases |
| T35 | 已闭环 | main target resolver + `syncCwdFromTarget` | manager main-only cwd-sync case |

## 本地与远程 backend

| ID | 状态 | 实现文件 | 自动化测试证据 |
| --- | --- | --- | --- |
| T31 | 已闭环（macOS 已打包实测） | `LocalPtyTerminalBackend.ts`、`TerminalBackendFactory.ts` | local Electron E2E 真实 node-pty；packaged smoke 执行 `PACKAGED_NODE_PTY_ABI_OK` |
| T32 | 已闭环；独立远端主机仍为发布门禁 | `RemoteProcessTerminalBackend.ts`、`CodexHostConnectionRegistry.ts` | mock `process/*` backend/host registry tests；RW-E2E-09 以系统 SSH + loopback `ssh2` 验证 create/input/resize/output |
| T33 | 已闭环；独立远端主机仍为发布门禁 | provider `process-session-client.ts` | mock UTF-8/串行 pending-input 用例；RW-E2E-09 真实 SSH 验证 `process/spawn`、`process/writeStdin`、`process/resizePty` |
| T40 | 实现闭环；真实断线待发布门禁 | remote backend + manager `markConnectionLost` | mock connection-lost/tail/dispose/restart/容量释放用例 |

## 发布环境门禁与实际命令

- 已运行的 Phase 0 红灯基线：`TerminalWorkspaceService` v1 的 write/resize snapshot、任务 cleanup 杀 terminal、手动启动/失败不可见；在替换 v2 前稳定失败，测试调用方式修正后不是 harness 错误。
- 已运行的定向终端验证（从 `desktop-app` 工作目录运行）：shared API、main terminal/provider/conversation、renderer terminal/workspace persistence 共 **20 files / 133 tests passed**。JSDOM 仅有 canvas 能力提示，无测试失败。
- 已运行的 provider 门禁：`npm run lint`（0 error、2 个既有 max-lines warning）、`npm run typecheck`、`npm test -- --reporter=verbose`，结果为 **27 files / 277 tests passed**。desktop `typecheck:node`、`typecheck:web` 均通过；desktop lint 为 **0 error、343 个既有/格式 warning**。
- desktop 全量 `npm test -- --reporter=verbose` 的既有记录仍是 8 个不相关 local-git 用例在默认 5 秒超时，不能记为全量通过。本次对新增验收点读取 Playwright 进程的直接输出：RW-E2E-03（右→下→右同一 session/tail）、RW-E2E-06（renderer reload 后同 session/tail 自动恢复）、RW-E2E-07（A→B→A）、RW-E2E-08（多终端隔离）最终同进程 **4 passed**。不使用 `.last-run.json` 代替实际输出。
- 真实 SSH smoke：`npm exec -- playwright test tests/e2e/remote-terminal-ssh.e2e.ts --reporter=line --workers=1` 直接输出 **1 passed (11.9s)**。它通过生产系统 `ssh` 连接本机 `ssh2` loopback 服务，验证 public-key 认证、远端 app-server 启动命令和 create/input/resize/output；仍须在配置 `DASCOWORK_E2E_REMOTE_HOST` 的独立 POSIX 主机执行 create/input/resize/exit 与断线恢复门禁。
- macOS 打包 smoke：`npm run test:e2e:packaged` 完成 build/typecheck/electron-builder 后启动 `dist/mac/desktop-app.app`，真实创建 packaged terminal 并执行 `echo PACKAGED_NODE_PTY_ABI_OK`，Playwright 直接输出 **1 passed (34.5s)**。这证明当前 macOS x64 包的 node-pty Electron ABI 可用；Windows/Linux 仍须在相应目标平台运行同一命令。
- `git diff --name-only -- codex/codex-rs/app-server` 在本次实施检查中为空，未修改 app-server。
