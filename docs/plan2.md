# `+ / @` 上下文菜单能力对齐计划

## 目标

完整对齐参考项目的本地能力，同时明确排除：

- Appshot
- 远程文件选择、上传和传输
- 远程工作区文件搜索
- Plugin/App 安装、授权和市场管理

协议边界：`codex/codex-rs` 和 Codex app-server 协议保持不变。参考项目的本地文件能力由桌面端和 Provider 复用现有 `Text`、`LocalImage`、`Image`、`Skill` 和 `Mention` 输入完成，不新增 app-server 方法或 `UserInput` 类型。

最终菜单顺序：

1. Add
2. Files
3. Chats
4. Agents
5. Skills
6. Plugins
7. Apps
8. Tools

## 1. 统一 `+` 和 `@` 输入体验

- 删除当前独立的 `+` Radix Popover；`+` 和输入 `@` 共用同一个建议面板、查询、分组、高亮和键盘状态。
- 实现项目自有的 Lexical 输入插件：
  - 输入 `@query` 时记录真实文本范围。
  - 点击 `+` 时记录当前光标处的虚拟范围，不插入 `@` 或 `+`。
  - 用户继续输入时，虚拟范围随查询内容扩展。
  - 选择项目后，直接通过 Lexical 公开 API 将范围替换成 directive chip。
- 不使用 DOM Range 操作光标，也不修改 `node_modules`。
- 使用公开的 `DirectiveNode` 和 `$createDirectiveNodeWithFormatter`；将当前 `@assistant-ui/react-lexical` 版本锁定，避免内部行为升级后漂移。
- 面板位于输入框上方、与输入框等宽、最大高度 320px；鼠标点击 `+` 不丢失输入框焦点。
- 支持上下键、Enter、Escape、鼠标选择、点击外部关闭、IME 输入、撤销重做，并保持 `/` 命令入口不受影响。

## 2. 建立统一的上下文目录

新增带版本的统一引用模型，至少包含：

- `kind`
- `canonicalId`
- `label`
- `presentation: "attachment" | "mention"`
- 对应的 `path`、URI、状态和辅助显示信息

各目录来源如下：

- Files：扩展现有工作区搜索，返回文件和文件夹；保留模糊匹配结果，移除 renderer 中多余的二次 `includes` 过滤。
- Chats：复用现有会话服务；排除当前会话，按当前项目、无项目、其他项目和最近使用排序。
- Live Agents：由当前聊天流使用的同一个 app-server 实例上报生命周期事件，main 维护投影；不得另启进程猜测运行状态。
- Configured Agents：Electron Main 使用 `smol-toml` 扫描全局 `CODEX_HOME` 与当前本地项目的 `config.toml`、`agents/**/*.toml`，提取 `roleName`、`description` 和 `nicknameCandidates`；不返回 developer instructions、模型配置或文件路径，也不新增 app-server 接口。
- Skills：调用 `skills/list`，按当前 cwd/thread 配置加载。
- Plugins：调用适合 mention 场景的 `plugin/installed`，只显示已安装且启用的本地插件。
- Apps：调用 `app/list`，只保留 `isEnabled && isAccessible`。
- Tools：继续使用 renderer 当前模型实际可用的 Tools，不重复维护协议目录。

Main 新增目录聚合服务，并通过 shared schema、preload 白名单暴露给 renderer。目录按 `{cwd, threadId}` 缓存 30 秒；切换项目、会话或配置变化时失效。某个分类加载失败时只显示该分类的重试状态，不能清空整个面板。

## 3. 明确两种文件语义

### 本地附件

通过 Add → “Files and folders”选择：

- 图片继续使用现有图片附件。
- 普通文件和文件夹显示为可移除的附件卡片。
- 不复制文件内容、不读取成 Base64、不上传；Provider 将已验证的本地路径写入现有 `Text` 输入的 `# Files mentioned by the user` 上下文。
- 发送前由 main 再次验证路径是否为绝对路径、是否存在以及类型是否一致；失效附件显示错误并阻止发送。

附件卡片身份由桌面端草稿和当前消息状态保留。app-server 持久化历史只包含现有文本路径上下文，因此从服务端历史重建时安全降级为文件路径引用，不伪造附件卡片。

### 工作区代码引用

通过 Files 搜索选择：

- 插入输入框内的文件或文件夹 chip。
- 发送时与普通附件一样合并到 `# Files mentioned by the user` 文本上下文，但 UI 仍保留行内 chip 形态。
- 不创建附件卡片，也不上传内容。
- 同一路径可以分别作为“附件”和“代码引用”存在于 UI；发送给模型时按路径去重，避免重复上下文。

远程执行目标下隐藏本地附件入口和本地 Files 搜索，避免再次把桌面路径错误传给云端 Agent。

## 4. 引用序列化和历史恢复

建立双向 codec，保证发送、继续会话和重新打开历史时不丢失类型：

- 文件/文件夹引用：现有 `Text` 输入的 `# Files mentioned by the user` 路径上下文。
- Chat：`thread://<threadId>`。
- 当前会话 Agent：`agent://<childThreadId>`。
- 配置 Agent：`subagent://<roleName>`。
- Skill：结构化 `UserInput::Skill`。
- App：规范化为 `$slug` 文本和 `app://` Mention 配对。
- Plugin：规范化为 `@name` 文本和 `plugin://` Mention 配对。
- Tool：保留现有 formatter 行为。
- 本地附件：发送时复用上述文本路径上下文；当前桌面消息保留附件卡片，仅有 app-server 历史时恢复为通用文件引用。

历史 mapper 必须按 URI scheme 识别并消费相邻的规范文本 token，避免 App、Plugin、Skill 在恢复后出现两个 `$name` 或 `@name`。同时修复现有文件夹恢复成普通文件的问题。

将草稿存储升级到 v2，保存文本、directive identity 和本地路径附件；兼容迁移现有仅文本草稿。

## 5. 验证与验收

测试覆盖：

- `+` 和 `@` 是否真正使用同一状态机，且点击 `+` 不改变草稿文本。
- 光标位于开头、中间、chip 前后和多段文本时的精确插入。
- IME、Escape、点击外部、撤销重做、键盘选择及 `/` 命令共存。
- Files/Chats/Agents/Skills/Plugins/Apps/Tools 的排序、搜索、分页和局部失败。
- cwd/thread 配置隔离、Apps 权限过滤、缓存失效。
- Live Agents 来自当前聊天流事件，completed Agent 可引用，closed/not-found Agent 被移除。
- 每种引用经过 fresh、resume、history 后只恢复一个 chip。
- 文件与文件夹、本地附件与工作区引用在桌面端草稿和当前消息中保持各自展示；app-server 历史回放按通用文件引用恢复。
- 真实 renderer → IPC → main → provider → app-server 端到端链路。
- 远程执行模式不出现本地文件能力，且不存在远程上传接口。
- UI 中不存在 Appshot 入口。

完成标准：

- `+` 和 `@` 的面板、查询、选择、焦点和光标行为一致。
- 本地附件显示为附件卡片，工作区代码文件显示为行内引用。
- 所有非远程分类可用，单分类故障不影响发送和其他分类。
- 历史重新打开后所有可由现有协议识别的引用不重复；附件身份按上述边界降级为通用文件引用。
- Provider lint/typecheck/tests/build 和 Desktop lint/typecheck/tests/e2e 全部通过；`codex/codex-rs` 无未提交改动。

## 当前实施记录（2026-07-15）

- `codex/codex-rs` 保持零改动；实现只使用现有 app-server 接口和输入类型。
- Provider lint、typecheck、build 和 170 个测试通过；Desktop typecheck、build 和 574 个测试通过。
- `+ / @` 菜单、本地附件、工作区引用和草稿恢复的目标 E2E 通过。
- 全量 E2E 为 24 通过、1 跳过、0 失败；此前推理文案、工具分组和 turn diff 的 5 个失败场景均已通过。
- Configured Agents 不再依赖 `config/read`：桌面端 Main 进程独立扫描本地角色配置，远程项目不读取本机角色目录；Codex App Server 和协议保持不变。
