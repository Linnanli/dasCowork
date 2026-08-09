# 终端工作区未完成事项

更新日期：2026-08-09

本文档只记录当前尚未闭环的项目。已完成的实现和证据见：

- [能力追踪表](./reference-terminal-workspace-capability-traceability.md)
- [完整实施计划](./reference-terminal-workspace-full-parity-plan.md)

已具备本机真实 SSH 基线：`RW-E2E-09` 由 `ssh2` 在 `127.0.0.1` 启动临时服务，桌面端仍通过生产路径中的系统 `ssh` 连接。该用例已验证 public-key 认证、远端 app-server 启动命令、`process/spawn`、`process/writeStdin`、`process/resizePty` 和终端输出；密钥、SSH 配置和 known-hosts 都是临时文件，不会读取或修改 `~/.ssh`。

## P0：发布前必须完成

### 真实 SSH 远端终端验收

- [x] 使用 `ssh2` + 本机系统 SSH 验证远程 create、input、resize 和输出（`RW-E2E-09`）。
- [ ] 在受控的 SSH/POSIX 测试主机上配置 `DASCOWORK_E2E_REMOTE_HOST`。
- [ ] 在独立远端主机验证 terminal create、input、resize 和 exit，排除 loopback 同机效应。
- [ ] 验证连接断开后状态变为 `connection-lost`，tail 保留且资源释放。
- [ ] 验证点击重试会创建新的远端进程，不宣称恢复已丢失的旧进程。
- [ ] 检查测试日志不包含 SSH 凭据、环境变量或完整终端历史。

完成标准：真实远端 E2E 进程直接输出通过，并将 T32、T33、T40 的“真实 SSH 待发布门禁”更新为已验证。

### Windows 打包终端验收

- [ ] 在 Windows 目标机或 CI 上执行 `npm run test:e2e:packaged`。
- [ ] 确认打包应用能启动真实 node-pty terminal。
- [ ] 确认终端能执行 `echo PACKAGED_NODE_PTY_ABI_OK` 并读回标记输出。
- [ ] 确认 PowerShell/cmd 默认 Shell 与复制、粘贴、Ctrl+C 行为无回归。

完成标准：Windows packaged smoke 直接输出通过，且没有 node-pty Electron ABI 加载错误。

### Linux 打包终端验收

- [ ] 在 Linux 目标机或 CI 上执行 `npm run test:e2e:packaged`。
- [ ] 确认打包应用能启动真实 node-pty terminal。
- [ ] 确认终端能执行 `echo PACKAGED_NODE_PTY_ABI_OK` 并读回标记输出。
- [ ] 确认 POSIX Shell 与复制、粘贴、Ctrl+C 行为无回归。

完成标准：Linux packaged smoke 直接输出通过，且没有 node-pty Electron ABI 加载错误。

## P1：测试稳定性债务

### desktop 全量单元测试

- [ ] 重现并分类 8 个 local-git 用例的默认 5 秒超时。
- [ ] 判断是固定超时太短、测试间资源争用，还是真实行为回归。
- [ ] 用定向修复消除超时，不通过删除断言或无界增加等待时间掩盖问题。
- [ ] 重跑 `npm test -- --reporter=verbose`，保存完整的直接通过输出。

完成标准：desktop 全量单元测试为 0 failed，能力追踪表不再保留该超时缺口。

## 最终收尾

- [ ] 以目标平台的直接命令输出更新能力追踪表，不使用 `.last-run.json` 代替实际证据。
- [ ] 更新完整实施计划的最终结论，只有上述 P0 项全部通过后才标记“全平台完全验收”。
- [ ] 再次确认 `codex/codex-rs/app-server/` 无变更。
