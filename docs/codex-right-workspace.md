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

Review 将所有变更堆叠为一条纵向 diff 流，文本差异使用 `@pierre/diffs`，变更文件树使用 `@pierre/trees`。`未提交` 只在 Renderer 并行组合 staged/unstaged 快照；每个 section 保留原始 source、generation 和 revision，所有写操作仍通过 Main 校验。

- 来源菜单支持上一轮、未提交、未暂存、已暂存、提交和分支；提交/分支列表可搜索，不能加载时可重试。
- 文件树在右侧，支持本地筛选、宽度拖动、窄屏自动折叠、右键复制路径和工作树文件能力校验后的预览/系统打开。
- 跳转到文件、树筛选、`Cmd/Ctrl+F` 内容搜索是三个独立状态。内容搜索经过带上限的 typed Git IPC，切换来源或 generation 后丢弃旧结果。
- 分支对比可将文件标为已查看；标记按仓库、来源、文件路径和完整 revision 集合隔离。
- 暂存、取消暂存、还原支持 section、file 和 hunk。还原首次要求确认；本地提交成功后刷新快照。真实 push/认证/PR 不在此范围。

### 富预览

Markdown、PNG、JPEG、GIF、WebP 和 PDF 可预览。内容经 shared schema、preload、Main 和 `LocalGitService` 校验 source、snapshot generation 和 file revision；历史来源与不支持二进制字节传输的远程 host 不会回退读取当前本地文件。工作树读取在 Main 限制为 5 MiB，并解析真实路径后拒绝仓库外目标，避免 symlink 越界读取。

PDF 固定版本为 `react-pdf` `10.4.1` 与 `pdfjs-dist` `5.4.296`。worker 从 `pdfjs-dist/build/pdf.worker.min.mjs` 经 Vite 的 `new URL(..., import.meta.url)` 打包为本地资源。生产构建必须通过 `npm --prefix desktop-app run verify:pdf-worker-bundle`；升级两者前需要重新确认 React-PDF/PDF.js 兼容性并运行 `npm --prefix desktop-app run test:e2e:packaged`，其中会启动打包应用并渲染真实的本地 PDF 审阅预览。

## 验证

日常验证可按改动范围运行：

```bash
npm --prefix desktop-app run typecheck:node
npm --prefix desktop-app run typecheck:web
npx --prefix desktop-app vitest run src/main/rightWorkspace src/renderer/src/components/right-workspace
npx --prefix desktop-app playwright test tests/e2e/right-workspace.e2e.ts --reporter=line
npm --prefix desktop-app exec electron-vite build
npm --prefix desktop-app run verify:pdf-worker-bundle
npm --prefix desktop-app run test:e2e:packaged
```

端到端用例创建临时本地 Git 项目，从真实会话依次打开 Files、Browser、Terminal 和 Review，并保存桌面与窄宽度截图作为回归证据。参考 Review 截图、裁剪信息和 SHA-256 保存在 `desktop-app/tests/e2e/fixtures/review/screenshots/`，不依赖临时剪贴板路径。
