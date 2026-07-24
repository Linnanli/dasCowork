# RELEASE_HISTORY_mru2plup

| # | 编号清单条目 |
|---|-------------|
| 1 | v0.1.0 — Electron 窗口骨架搭建，renderer 初始化 React |
| 2 | v0.1.1 — 添加 preload contextBridge，暴露安全 API |
| 3 | v0.1.2 — 集成 assistant-ui 聊天界面组件 |
| 4 | v0.1.3 — IPC 通道 `codex:list-models` 打通 |
| 5 | v0.1.4 — 模型列表页面渲染，支持下拉选择 |
| 6 | v0.1.5 — `CodexChatRuntimeService` 基础结构创建 |
| 7 | v0.1.6 — Provider fork 目录引入，开始映射实验 |
| 8 | v0.1.7 — AI SDK `streamText()` 初步接入 main process |
| 9 | v0.1.8 — MessageChannel 双向通信链路建立 |
| 10 | v0.1.9 — Preload `desktopCodexChat.startChatStream()` 实现 |
| 11 | v0.2.0 — 审批面板 UI 开发启动 |
| 12 | v0.2.1 — `CodexApprovalBroker` 消息队列框架搭建 |
| 13 | v0.2.2 — app-server `approval-request` IPC 转发逻辑 |
| 14 | v0.2.3 — 审批响应 `codex:respond-approval` 回调闭环 |
| 15 | v0.2.4 — Zod schema 校验在 preload payload 中启用 |
| 16 | v0.2.5 — 外链点击拦截与安全白名单机制 |
| 17 | v0.2.6 — Windows 兼容路径处理修复 |
| 18 | v0.2.7 — macOS MenuBar 快捷键绑定 |
| 19 | v0.2.8 — 聊天历史 localStorage 持久化 |
| 20 | v0.2.9 — 错误边界组件包裹 renderer 根节点 |
| 21 | v0.3.0 — thread/start RPC 请求格式确认 |
| 22 | v0.3.1 — turn/stream chunk 解析与流式渲染 |
| 23 | v0.3.2 — tool_call 事件映射到审批流程 |
| 24 | v0.3.3 — sandbox cwd 配置从 preload 注入 |
| 25 | v0.3.4 — MCP server list 获取接口对接 |
| 26 | v0.3.5 — 多模型 provider 并行测试分支 |
| 27 | v0.3.6 — custom model provider SSL 证书容错 |
| 28 | v0.3.7 — renderer 端 input 防抖优化 |
| 29 | v0.3.8 — 大段 Markdown 代码块截断展示 |
| 30 | v0.3.9 — 崩溃日志上报到 main process |
| 31 | v0.4.0 — electron-updater 自动更新集成 |
| 32 | v0.4.1 — 灰度发布开关配置 |
| 33 | v0.4.2 — Squirrel.Mac / Squirrel.Windows 适配 |
| 34 | v0.4.3 — 安装包签名证书导入 |
| 35 | v0.4.4 — AppImage + deb 打包流水线 |
| 36 | v0.4.5 — dmg 安装包 DMGInstaller 模板定制 |
| 37 | v0.4.6 — installer.nsh 注册表项清理 |
| 38 | v0.4.7 — NSIS 安装弹窗文案汉化 |
| 39 | v0.4.8 — updater 版本对比逻辑加固 |
| 40 | v0.4.9 — 失败回滚策略：保留上一稳定版 |
| 41 | v0.5.0 — codex-app-server 子进程管理重构 |
| 42 | v0.5.1 — stdio JSON-RPC 心跳检测 |
| 43 | v0.5.2 — 异常退出时自动重启机制 |
| 44 | v0.5.3 — CODEX_APP_SERVER_BIN 环境变量优先加载 |
| 45 | v0.5.4 — packaged resources fallback 目录校验 |
| 46 | v0.5.5 — 开发模式 cargo run --bin 命令构建 |
| 47 | v0.5.6 — app-server 日志 stderr/stdout 合并 |
| 48 | v0.5.7 — 子进程 SIGTERM 优雅关闭超时 |
| 49 | v0.5.8 — IPC handler 去重保护 |
| 50 | v0.5.9 — preload 跨上下文隔离加固 |
| 51 | v0.6.0 — 文件附件上传功能 MVP |
| 52 | v0.6.1 — file attachment 拖拽区域 |
| 53 | v0.6.2 — MIME type 白名单过滤 |
| 54 | v0.6.3 — 文件大小限制 10MB 预设 |
| 55 | v0.6.4 — 附件缩略图生成（图片类） |
| 56 | v0.6.5 — PDF 文件名预览渲染 |
| 57 | v0.6.6 — 删除附件撤销操作 |
| 58 | v0.6.7 — 附件列表分页懒加载 |
| 59 | v0.6.8 — Web Worker 压缩大图片 |
| 60 | v0.6.9 — 上传进度条实时刷新 |
| 61 | v0.7.0 — 深色主题系统级跟随 |
| 62 | v0.7.1 — CSS variables 主题色映射 |
| 63 | v0.7.2 — systemPreferences.getAccentColor 读取 |
| 64 | v0.7.3 — 手动切换按钮 + localStorage 缓存 |
| 65 | v0.7.4 — transition 平滑过渡动效 |
| 66 | v0.7.5 — 暗黑模式下图标 SVG 切换 |
| 67 | v0.7.6 — colorScheme media query 监听器 |
| 68 | v0.7.7 — 字体渲染降级方案 |
| 69 | v0.7.8 — 打印样式表 @media print |
| 70 | v0.7.9 — 高对比度模式兼容性检查 |
| 71 | v0.8.0 — E2E 测试框架 Playwright 配置 |
| 72 | v0.8.1 — GitHub Actions CI pipeline 搭建 |
| 73 | v0.8.2 — chat 链路端到端用例 |
| 74 | v0.8.3 — approval 交互模拟测试 |
| 75 | v0.8.4 — model switch 回归用例 |
| 76 | v0.8.5 — playwright.config.ts reporter 配置 |
| 77 | v0.8.6 — 浏览器 mock 数据注入 |
| 78 | v0.8.7 — viewport 多分辨率适配 |
| 79 | v0.8.8 — snapshot diff 视觉测试 |
| 80 | v0.8.9 — flaky test 重试机制 |
| 81 | v0.9.0 — elicitation 弹出面板 |
| 82 | v0.9.1 — server request 类型分派路由 |
| 83 | v0.9.2 — file/tool/mcp/approval 状态机 |
| 84 | v0.9.3 — 取消审批灰色确认态 |
| 85 | v0.9.4 — timeout 超时自动拒绝 |
| 86 | v0.9.5 — 审批通知 badge 角标 |
| 87 | v0.9.6 — 批量 approve 选择框 |
| 88 | v0.9.7 — 审批日志 tab 记录 |
| 89 | v0.9.8 — keyboard shortcut Esc 关闭 |
| 90 | v0.9.9 — toast notification 全局提示 |
| 91 | v1.0.0 — **正式版发布** — 核心功能冻结 |
| 92 | v1.0.1 — 性能监控 SDK 嵌入 |
| 93 | v1.0.2 — bundle size 分析并拆分 vendor chunk |
| 94 | v1.0.3 — 首屏加载 Lighthouse 90+ |
| 95 | v1.0.4 — window preloading 预加载策略优化 |
| 96 | v1.0.5 — native addon ABI 版本锁定 |
| 97 | v1.0.6 — node_modules tree shaking 排除声明 |
| 98 | v1.0.7 — Electron binary 体积削减 |
| 99 | v1.0.8 — crash report 脱敏规则 |
| 100 | v1.0.9 — telemetry opt-in 隐私设置页 |
| 101 | v1.1.0 — 插件扩展点设计 RFC |
| 102 | v1.1.1 — extension host 沙箱环境 |
| 103 | v1.1.2 — plugin.json manifest 校验 |
| 104 | v1.1.3 — marketplace registry HTTP 端点 |
| 105 | v1.1.4 — 插件热重载 devtools |
| 106 | v1.1.5 — extension API @types 定义 |
| 107 | v1.1.6 — scoped npm publish hook |
| 108 | v1.1.7 — 插件卸载资源回收 |
| 109 | v1.1.8 — version range semver 约束 |
| 110 | v1.1.9 — plugin install progress bar |
| 111 | v1.2.0 — 自定义 prompt template 引擎 |
| 112 | v1.2.1 — YAML frontmatter 解析器 |
| 113 | v1.2.2 — template preview sidebar |
| 114 | v1.2.3 — 共享 template gallery 标签 |
| 115 | v1.2.4 — markdown-it 扩展插件链 |
| 116 | v1.2.5 — sanitize-html XSS 防护 |
| 117 | v1.2.6 — i18n 国际化骨架（en/zh） |
| 118 | v1.2.7 — format.js ICU message 格式化 |
| 119 | v1.2.8 — locale detector OS-level hook |
| 120 | v1.2.9 — CHANGELOG.md 自动生成脚本 |
