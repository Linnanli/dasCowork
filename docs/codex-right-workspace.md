# Codex 右侧工作区

右侧工作区为每个本地对话提供统一的标签式工具区：Review、Files、Terminal 和 Browser。它只使用 Electron 的 renderer、preload 和 main 层能力；聊天推理仍通过 Codex app server，未改变 `codex/codex-rs/app-server`。

## 结构与生命周期

- `desktop-app/src/renderer/src/components/right-workspace/` 提供标签状态、入口页、可调整宽度的壳和四类内容组件。
- `desktop-app/src/shared/*WorkspaceApi.ts` 是跨进程请求、返回值和事件的唯一类型契约。
- `desktop-app/src/preload/index.ts` 只在 `window.desktopApp.workspace` 暴露白名单 API；renderer 不直接访问 Node 或 Electron。
- `desktop-app/src/main/rightWorkspace/` 负责文件根、PTY 和原生浏览器 view。

工作区以 `workspaceId + 本地会话目标` 分区。关闭 tab 会销毁对应的 PTY 或 Browser view；对话切换、renderer 导航/崩溃和窗口销毁会调用同一份清理逻辑，停止终端、销毁浏览器 view、关闭文件监听器并移除项目根引用。

## 文件工作区

文件 API 使用 Main 持有的受限根 ID，而不是把任意绝对路径交给 renderer。目录、搜索、元数据、读取和“在系统中打开”均会重新校验相对路径、拒绝 `..` 与越界 symlink，并限制目录结果、搜索结果和读取大小。

- 文件树按目录展开时才读取，搜索结果可展开祖先目录并定位文件。
- Main 使用带去抖的文件监听，仅刷新当前已加载目录和正在预览的文件；工具栏提供手动刷新作为回退。
- 代码、文本和 JSON 由只读 CodeMirror 显示，Markdown 使用现有 Streamdown。
- 图片和 PDF 返回受控的 `app://fs/@fs/…` 本地媒体 URL，不返回 `file://` 或 data URL；其他二进制、超大文件和 Office 文件说明原因，并可用系统应用打开。

## 终端工作区

每个终端标签在 Main 创建独立 `node-pty` 会话，cwd 是当前本地项目根。Renderer 使用 `@xterm/xterm` 和 Fit addon，经类型化的 `create/write/resize/kill/list` IPC 与 Main 通讯；输出与退出通过订阅事件回传。关闭终端、关闭工作区或窗口都将 kill 进程。

`node-pty` 已锁定为桌面端依赖，并在 `electron-builder.yml` 的 `asarUnpack` 中显式保留，避免打包后原生模块无法加载。仍需在发布流水线分别验证 macOS、Windows 和 Linux 的 packaged-app PTY smoke test。

## 浏览器工作区

Browser tab 在 Main 使用隔离的 `WebContentsView` 和非默认 session。远程页面始终启用 `sandbox`、`contextIsolation`、`webSecurity`，关闭 Node integration，且不注入产品 preload。

- 只接受 `http:` 和 `https:`，拒绝 `file:`、`javascript:`、`data:` 等危险协议。
- 权限默认拒绝；导航、重定向、弹窗、下载和证书异常均在 Main 拦截。
- Renderer 维护地址草稿、历史按钮、reload/stop、加载、标题、favicon 和错误状态；Main 在标签非活动、面板收起或菜单覆盖层出现时将原生 view 隐藏，恢复后使用 renderer 上报的精确 bounds。

首期不提供 Chrome 数据导入或持久 Cookie 管理。

## Review 与可访问性

现有 Git Review 迁入统一工作区，仍支持来源切换、刷新、diff、暂存、取消暂存、恢复和 turn patch。Diff 保持在左、变更文件树在右；文件树带搜索、`tree/treeitem` 语义和选中状态。统一标签栏使用 `tablist/tab/tabpanel`，支持方向键、Home/End 和 Escape 关闭 `+` 菜单。

## 验证

日常验证可按改动范围运行：

```bash
npm --prefix desktop-app run typecheck:node
npm --prefix desktop-app run typecheck:web
npx --prefix desktop-app vitest run src/main/rightWorkspace src/renderer/src/components/right-workspace
npx --prefix desktop-app playwright test tests/e2e/right-workspace.e2e.ts --reporter=line
npm --prefix desktop-app exec electron-vite build
```

端到端用例创建临时本地 Git 项目，从真实会话依次打开 Files、Browser、Terminal 和 Review，并保存桌面与窄宽度截图作为回归证据。
