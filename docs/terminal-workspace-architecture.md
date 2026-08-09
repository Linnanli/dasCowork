# 终端工作区架构

终端是任务资源，而不是某个 React 组件的临时子进程。实现位于 `desktop-app`，不会修改 `codex/codex-rs/app-server`。

## 边界与数据流

```text
terminal:<sessionId> tab / xterm
  -> preload 白名单与 Terminal API v2
  -> main TerminalSessionManager
     -> LocalPtyTerminalBackend (local host)
     -> RemoteProcessTerminalBackend (remote host)
        -> provider CodexProcessSessionClient -> remote Codex app-server process/*
```

renderer 只传稳定 session ID、任务 target、尺寸、经过 main 验证的 shell ID 和用户输入。cwd、host、环境、可执行文件、SSH 连接和远端凭据都只存在于 main 或 provider 边界内。

## 会话与生命周期

- 打开 terminal 标签时，renderer 先订阅事件，再按 `terminal:<sessionId>` attach；仅在 session 不存在时 create。
- 普通新标签只按 session ID 精确 attach，避免误占用同一任务的其他终端。fallback/rekey 只在明确的迁移请求中开启，不重复 spawn。
- `forceCwdSync` 会由 main 重新解析受信任务 target；有效 cwd 或 Shell 命令变化时替换 backend，未变化时保留原进程。
- 组件卸载、任务导航、面板移动和标签失活只 `detach`；显式关闭标签才 `close` 并终止进程。
- 对话删除或归档调用 `closeForConversation`；窗口关闭关闭其交互式 session；应用退出关闭全部 session。
- 退出或远端断线会立即释放 backend 与监听器。状态、exit metadata 和最后 16,000 个字符作为有界 tombstone 保留，单个任务最多 20 条、最多 24 小时。

## 输出、交互与动作

- `write` 和 `resize` 只返回 `{ accepted: true }`。输出经 `init`（一次 replay）和 `data`（增量）事件传递，单次 data 事件上限 64 KiB。
- renderer 在 attach 前对输入和动作使用有界 FIFO 队列；未真正 attached 不冲刷，create/attach/restart/close 失败会明确拒绝 pending promise。视图 detach 丢弃无效输入/尺寸，但保留已请求的 action。
- main 对同一 session 的 action/restart 串行化。动作命令由 main 按 shellKind 包装，AI 没有执行入口。
- xterm 仅在视图层处理复制/粘贴、键盘控制序列、安全 HTTP(S) 外链、动态主题和字体。`clear-active-terminal` 只清当前聚焦 xterm 的可视 buffer，不清 main replay 或 AI 快照。
- 终端偏好菜单通过 v2 `listShells` 枚举 main allowlist，renderer 只保存 shell ID；main 选择实际命令。字体和 8–32 字号保存在 renderer，同窗口修改立即更新已打开的 xterm 并 refit。环境继承 `process.env`，移除 `TERMINFO*`，并固定 `TERM=xterm-256color`。

## AI 与远端边界

`read_thread_terminal` 是只读 dynamic tool。它以真实 thread ID 查找同一任务的活动 terminal，清理控制序列并返回有限输出；跨任务、跨窗口和无 thread 的调用不会获得终端内容。

远端会话使用 provider fork 的 `CodexProcessSessionClient` 管理 `process/spawn`、输入、尺寸、退出和断线通知。输入按 session 串行发送；远端默认使用 POSIX `/bin/sh`，拒绝把本机 Windows Shell 路径带到远端。连接断开后状态是 `connection-lost`，保留 tail 但绝不假装恢复旧进程。重试在同一稳定逻辑 session ID 下启动全新 backend/远端进程。

## 验证边界

本地单元与 Electron E2E 覆盖会话重附着、面板移动、renderer reload、A→B→A、多终端隔离、关闭语义、ACK 传输、输出、动作队列和断线。macOS packaged smoke 已用真实打包应用启动 node-pty 并执行命令。`RW-E2E-09` 使用本机 `ssh2` 服务和生产系统 `ssh` 验证远程 create/input/resize/output，且不接触用户 SSH 配置；独立远端主机的 exit、断线与重试仍需发布环境提供受控 `DASCOWORK_E2E_REMOTE_HOST`。Windows/Linux 仍需在各自目标平台验证 node-pty Electron ABI。
