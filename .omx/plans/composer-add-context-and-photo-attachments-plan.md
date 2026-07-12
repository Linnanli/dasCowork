# 对话框“添加文件和更多”能力实施计划

## 1. 目标与结论

在对话输入框左下角增加一个“添加文件和更多”按钮，参考
`reference-projects/codex-electron-26.623.101652-beautified` 的交互，首期提供：

1. 添加本地文件和文件夹；
2. 添加照片；
3. 搜索并引用当前上下文（工作区文件与当前模型工具）。

采用“混合方式”：

- 普通文件、文件夹只发送本地路径引用，不读取、不上传文件内容；
- 照片作为图片附件发送，可在输入框中预览和移除；
- 路径引用在 Renderer 中保留为可编辑的 directive chip，发送前由 Provider 汇总成普通文本上下文，不映射为 `UserInput::Mention`；
- 历史读取时优先使用客户端可用的附件元数据，缺失时从普通文本上下文反向恢复路径 chip；
- 首期不包含远程文件、截图/Appshot、历史对话、应用、插件、技能或 MCP 资源搜索，也不增加拖放上传。

参考实现的关键行为位于 beautified bundle 的 `13717-13752`（按钮）、
`204172-204210`（菜单动作）和 `204212-204254`（文件、图片分流）。当前项目已经具备
`@` 文件/工具引用和图片传输的大部分基础，不重建第二套聊天链路。

## 2. 已确认的复用点与设计决定

### 2.1 界面组件

- 复用现有 `Popover` 和 `Command`，组成带动作区、搜索框、分组结果和二级选择的面板；组件已经存在于
  `desktop-app/src/renderer/src/components/ui/popover.tsx` 和
  `desktop-app/src/renderer/src/components/ui/command.tsx`。不新增 DropdownMenu，因为同一面板需要同时承载搜索、加载、空状态和二级导航。
- 复用 assistant-ui 的 `ComposerPrimitive.AddAttachment`、`ComposerPrimitive.Attachments`、
  `AttachmentPrimitive` 和 `MessagePrimitive.Attachments`。现有封装已提供缩略图、删除、错误状态和图片预览，见
  `desktop-app/src/renderer/src/components/assistant-ui/attachment.tsx:20-235`。
- 在 `desktop-app/src/renderer/src/App.tsx:1608-1747` 的 Composer 左侧操作区加入按钮；照片预览区放在输入框上方，使用现有 `ComposerAttachments`。
- assistant-ui 官方建议由 `ComposerPrimitive.AddAttachment` 打开文件选择器、由
  `ComposerPrimitive.Attachments` 渲染待发送附件；shadcn/ui 的 Popover 适合承载由按钮触发的富内容面板，Command 适合可搜索操作列表。

### 2.2 路径引用的消息格式与协议边界

Renderer 草稿继续沿用现有 directive chip 机制，不创建一套与 assistant-ui 并行的聊天状态。内部草稿格式固定为：

```text
:file[<encodeURIComponent(label)>]{name=<encodeURIComponent(absolutePath)>}
:folder[<encodeURIComponent(label)>]{name=<encodeURIComponent(absolutePath)>}
```

规则：

- Renderer 显示时解码 label/path，用户看到正常文件名和文件夹名；空格、中文、`]`、`}` 等合法路径字符不会破坏语法。
- 只解析 `file`、`folder` 两种类型；其他 command/tool directive 保持现有行为。
- 兼容已有未编码 directive：解码失败时使用原值；不是绝对路径、格式损坏或字段为空时保留为普通文本，不抛异常。
- Provider 在发送 turn 前提取有效 file/folder directive，去重后生成一个模型可见的普通文本前缀；用户正文作为 `## My request for Codex:` 后的内容，图片输入固定追加在文本输入之后。
- 为避免标题、冒号、换行等字符破坏历史解析，每个 label/path 使用 JSON 字符串编码。线上的确定格式为：

```text
# Files mentioned by the user:

## "<label>": "<absolutePath>"

## My request for Codex:
<用户正文>
```

- App Server 收到的是一个普通 text input 和零个或多个 image/localImage input；不增加当前 `TurnStartParams` 未定义的 `attachments` 字段。
- 历史消息读取时识别上述完整前缀：恢复路径 directive/chip，并只向用户显示原始正文。若旧历史没有该前缀则按普通文本处理。
- 前缀不保存可靠的 file/folder 类型；客户端元数据仍存在时保留原类型，否则重开后恢复为通用路径引用图标，这是首期可接受的显示降级。

这条正向转换和历史反向解析应放在 provider fork，因为它拥有 AI SDK prompt 与 Codex App Server Protocol 的映射职责；当前入口是
`desktop-app/vendors/ai-sdk-provider-codex-asp/src/utils/prompt-file-resolver.ts:131-229` 和
`:235-330`。历史反向映射基于
`desktop-app/vendors/ai-sdk-provider-codex-asp/src/protocol/shared-item-extractors.ts:251-273`。

该决定与参考项目一致：参考项目也把文件路径写进 `# Files mentioned by the user:` 普通文本，并只把结构化附件数据用于客户端显示和兜底。当前 Codex Core 会在生成模型内容时过滤 `UserInput::Mention`，且其语义主要用于 App/Plugin 目标，因此任意本地路径不能依赖 Mention 传给模型，见
`codex/codex-rs/protocol/src/models.rs:1762` 和
`codex/codex-rs/protocol/src/user_input.rs:47-51`。

### 2.3 原生路径选择

在 `DesktopCodexApi` 增加：

```ts
type LocalContextPickerKind = 'files' | 'folders'

type LocalContextReference = {
  kind: 'file' | 'folder'
  path: string
  label: string
}

pickLocalContext(input: {
  kind: LocalContextPickerKind
}): Promise<LocalContextReference[]>
```

- shared 层增加 Zod 入参/返回值校验和绝对路径校验，落点是
  `desktop-app/src/shared/codexIpcApi.ts:200-217`、`:253-302`。
- preload 只暴露上述窄接口，落点是 `desktop-app/src/preload/index.ts:31-89`；Renderer 不直接使用 Electron/Node。
- main 注册 `codex:pick-local-context`，调用 `dialog.showOpenDialog`，并用 `stat` 确认返回项类型；取消返回空数组，失效路径跳过，其他错误返回可展示的错误信息。现有目录选择实现可参考
  `desktop-app/src/main/index.ts:88-93` 和 IPC 注册区 `:280-324`。
- “添加本地文件和文件夹”进入二级菜单后分别显示“选择文件”和“选择文件夹”。文件允许多选，文件夹也请求多选；这是必要的跨平台处理，因为 Electron 在 Windows/Linux 上不能让同一个原生对话框同时选择文件与目录。
- 这是对参考项目的有意增强：参考版本地原生对话框实际只有 `openFile + multiSelections`，目录主要来自拖放或其他选择入口；本项目首期不实现拖放，因此必须提供独立的 `openDirectory` 入口。
- 远程项目隐藏这两个本地路径入口；projectless 或没有可发送上下文时整个添加按钮禁用。首期不把本地路径上传到远程主机。

### 2.4 搜索并引用上下文

- 抽出 Composer 的上下文数据控制器，继续复用当前
  `unstable_useMentionAdapter`。现有工作区文件、工具分类位于
  `desktop-app/src/renderer/src/App.tsx:1624-1672`。
- 添加面板打开时加载空查询；输入搜索词后 150ms 防抖调用现有
  `useWorkspaceFileSearch.search(query)`，最大返回 40 项。该 hook 已处理“后发请求覆盖先发请求”和错误状态，见
  `desktop-app/src/renderer/files/useWorkspaceFileSearch.ts`。
- 空搜索词按“文件”“工具”分组展示；有搜索词时合并过滤结果。选择结果后在当前草稿末尾插入一个 directive chip，保留原草稿，在必要时补一个空格，然后关闭面板并把焦点交还输入框。
- 通过原生选择器加入的路径与搜索结果使用同一插入函数；同一绝对路径在一个草稿中只保留一次。
- 保留原有 `@` 入口，两种入口共享同一文件结果、工具列表、formatter 和图标；`@` 与新按钮不能产生不同格式的引用。
- 当前工作区搜索只返回本地文件且限制深度为 5，见
  `desktop-app/src/main/projects/WorkspaceFileSearchService.ts:37-115`；首期不改变索引范围，也不把任意磁盘路径纳入搜索。

### 2.5 照片附件

- 为 `useAISDKRuntime` 显式配置 image-only attachment adapter，替代当前默认 `*` adapter；入口见
  `desktop-app/src/renderer/src/App.tsx:386-390`。
- adapter 的 `accept` 为 `image/*`，允许多选；`add()` 生成 `type: "image"` 的待发送附件，`send()` 使用 FileReader 生成 data URL，并保留原始 MIME 与文件名为 AI SDK file part。不要使用会把 JPEG 固定标成 PNG 的转换路径。
- “添加照片”菜单项直接以 `ComposerPrimitive.AddAttachment asChild` 包住菜单按钮，不新增 Renderer 到 Main 的图片读取 IPC。
- Composer 顶部渲染 `ComposerAttachments`；发送后继续使用已经接入的
  `UserMessageAttachments`（`desktop-app/src/renderer/src/App.tsx:987`）。
- Main 继续通过 `convertToModelMessages` 处理 UIMessage，见
  `desktop-app/src/main/codexChatRuntimeService.ts:582-615`；Provider 已能将 image file part 写入临时文件并映射为 `localImage`，见
  `prompt-file-resolver.ts:170-229`，不增加直接模型请求。
- 选中模型的 `inputModalities` 必须包含 `image` 才允许添加和发送照片；模型目录已经提供该字段，见
  `desktop-app/src/shared/codexIpcApi.ts:34` 和
  `desktop-app/src/main/modelCatalogService.ts:112-122`。模型信息尚未加载时禁用照片入口并显示加载状态，而不是乐观发送。
- 切换模型后若草稿中已有照片且新模型不支持图片，保留附件但禁用发送，并提示“移除照片或切换模型”。
- 参考版本前端没有实际图片数量或总大小阈值。本项目首期同样不猜测一个未经协议确认的阈值；读取、临时文件写入或 App Server 拒绝时必须保留可移除的错误状态并显示原因。图片大小/数量限制另立可配置需求。
- 文件选择取消不产生附件；图片读取失败时保留错误附件状态并允许移除，不能发送处于 error/running 状态的附件。

### 2.6 输入顺序与显示顺序

- 不承诺文本、文件、文件夹、照片之间的任意交错顺序。file/folder directive 在发送前统一汇总进文本上下文；照片按用户添加顺序映射为 image/localImage，并固定排在 text input 之后。
- Composer 中图片和路径 chip 可以分组显示；同类附件内部保持添加顺序。编辑草稿时恢复正文、路径 chip 和图片附件，但再次发送仍按“文本在前、图片在后”的协议顺序生成。
- 该约束与参考项目一致，也避免为 App Server 增加不存在的通用附件排序协议。

## 3. 实施步骤

### 步骤 1：锁定路径引用协议与纯函数测试

1. 在 Renderer 附近增加 `composerContextDirectiveFormatter`，只扩展 file/folder 的序列化和解码，其他类型委托现有 `unstable_defaultDirectiveFormatter`。
2. 把该 formatter 同时传给主 Composer、EditComposer、消息 `DirectiveText` 和 `ComposerTriggerPopover`，避免编辑/历史显示不一致。
3. 增加“将引用追加到草稿”和“草稿内按绝对路径去重”的纯函数；不直接操作 DOM，不覆盖用户现有文本。
4. 增加“directive 列表 ↔ Files mentioned 文本前缀”的纯函数，并把前缀识别限制在消息开头及完整的 `## My request for Codex:` 分隔符之前，避免误解析用户正文中的相似标题。
5. 为普通路径、空格、中文、冒号、引号、括号/花括号、损坏编码、重复路径、伪造标题和混合 command/tool directive 建立单元测试。

### 步骤 2：增加安全的原生选择 IPC

1. 在 shared schema/types 中加入 picker kind、reference result 和 API 方法。
2. 在 preload 增加唯一的 invoke 映射；同步更新 `preload/index.d.ts` 和测试 mock。
3. 在 main 抽出可注入、可测试的 picker handler：按 `files` 或 `folders` 设置原生 dialog properties，返回经 `stat`、绝对路径校验和去重后的结果。
4. 不读取文件内容，不扩大 workspace roots，不把选择结果写入磁盘或偏好设置。

### 步骤 3：实现添加面板和上下文搜索

1. 新建聚焦 Composer 的 `ComposerAddContextPopover`，复用本地 Popover、Command、IconButton、Tooltip 和 lucide 图标。
2. 根视图包括“添加本地文件和文件夹”“添加照片”以及搜索框；路径动作进入文件/文件夹二级视图，支持返回和 Escape。
3. 将当前 file references、model context tools 和搜索状态作为单一数据源，同时供 `@` popover和新面板使用。
4. 选择路径或搜索结果后调用统一追加函数；取消 picker 保持草稿和面板状态不变，失败在面板中以 `role="alert"` 显示。
5. 更新 `DirectiveChip`：file、folder、tool、command 使用对应图标；发送后的 `DirectiveText` 使用同一 formatter。

### 步骤 4：接入照片附件

1. 增加 image-only adapter，并在每个 Conversation 的 `useAISDKRuntime` 上稳定复用同一个实例，避免渲染时重建。
2. 将 “添加照片”接到 `ComposerPrimitive.AddAttachment`，开启多选。
3. 在输入框上方渲染现有 `ComposerAttachments`，补齐中文 aria-label、tooltip 和错误文案；图片缩略图、预览 Dialog 和删除动作继续复用现有实现。
4. 根据当前模型 `inputModalities` 控制照片入口与发送按钮；覆盖模型目录加载中、不支持图片、添加后切换模型和恢复支持模型四种状态。
5. 确认发送产生带原始 MIME、文件名和 data URL 的 AI SDK file part；普通文件不会通过图片入口进入消息。

### 步骤 5：把路径 directive 映射为普通文本上下文并保证历史回环

1. 在 `PromptFileResolver` 增加路径上下文构建器：提取有效 file/folder directive，按绝对路径去重，生成固定的 `# Files mentioned by the user:` 前缀和 `## My request for Codex:` 分隔符；fresh 和 resume 两条路径共用同一实现。
2. 仅当类型为 file/folder、字段可解码且 path 为绝对路径时进入路径上下文；无效、相对路径或不完整 directive 原样保留在用户正文中。
3. 生成 App Server input 时固定输出一个 text item，随后按原图片数组顺序输出 image/localImage；不产生本地 `mention`，不发送非标准 `attachments` 字段，也不读取普通文件内容。
4. 更新历史文本提取：识别并移除合法路径前缀，把每个绝对路径恢复为 directive；客户端仍有附件种类时保留 file/folder，否则恢复为通用路径引用。非本地 App/MCP mention 保持现有行为。
5. 覆盖“附件元数据存在”和“只有历史普通文本”两条恢复路径，确保关闭、重启、resume、编辑后重发均能保留路径语义。
6. 确保图片、文本文件和不支持 MIME 的既有处理不回归；路径上下文不得触发 `readFile`、base64 编码或临时文件写入。

### 步骤 6：测试与验收

按下面测试计划补齐覆盖，并执行项目现有 lint、typecheck、unit 和真实链路 e2e。

## 4. 可测试验收标准

### Renderer

- 有本地项目上下文时，输入框左下角出现可聚焦的“添加文件和更多”按钮；无上下文时禁用，远程项目不显示本地路径动作。
- Enter/Space 可打开，Escape 可关闭；Command 的上下键和 Enter 可选择结果；关闭后焦点回到输入框。
- 点击“选择文件”可加入多个 file chip；点击“选择文件夹”可加入 folder chip；取消不会改变草稿；重复选择同一路径不会重复加入。
- 路径含空格、中文、`]`、`}` 时显示正常，发送文本中的 label/path 均为可解析的 JSON 字符串。
- 搜索词在 150ms 后调用 workspace search；连续查询只显示最后一次结果；加载、空结果和错误各有明确状态。
- 搜索选择和 `@` 选择产生完全相同的 directive wire format。
- 添加两张不同 MIME 的照片后显示两个缩略图；可打开大图预览并单独删除；发送后的 UIMessage 保留各自文件名和 MIME。
- 普通 `.txt`/`.pdf` 不能通过“添加照片”入口加入；图片读取失败时发送按钮不可提交该错误附件，移除后恢复。
- 当前模型不支持图片或模型目录仍在加载时，照片入口不可用；草稿已有照片后切换到不支持图片的模型，附件保留但发送按钮禁用并显示明确原因；切回支持图片的模型后恢复发送。

### IPC 与 Main

- schema 拒绝未知 picker kind 和非绝对返回路径。
- files 模式使用 `openFile + multiSelections`，folders 模式使用 `openDirectory + multiSelections`；取消返回 `[]`。
- handler 对不存在路径、重复路径、文件/目录类型不匹配有确定行为：跳过无效项并返回剩余有效项；全部无效时返回空数组。
- preload 只调用 `codex:pick-local-context`，Renderer 无法访问 Electron `dialog`、`fs` 或任意 IPC channel。

### Provider 与端到端

- fresh thread 和 resumed thread 中，有效 file/folder directive 被汇总进同一个 `# Files mentioned by the user:` 文本前缀；用户正文位于 `## My request for Codex:` 之后。
- 路径上下文中的 label/path 使用确定的 JSON 字符串编码；空格、中文、冒号、引号、`]`、`}` 不破坏解析。无效或相对路径 directive 原样保留在正文中。
- App Server input 顺序固定为一个 text item 后接零个或多个 image/localImage；图片内部保持添加顺序，不要求路径与图片任意交错。
- 有效 file/folder directive 不产生 Codex `mention`，turn/start 不增加当前协议未定义的 `attachments` 字段。
- 路径引用不会触发 `readFile`、base64 编码或临时文件写入；只有图片 data URL 使用现有临时图片 writer。
- 历史事件有客户端附件元数据时优先使用；元数据缺失时仍能从普通文本前缀恢复路径 chip，并向用户隐藏内部上下文前缀。用户正文里人为输入的相似标题不会被误解析。
- 关闭并重启应用后，路径 chip 或通用路径引用仍可见、可编辑、可再次发送；非本地 App/MCP mention 不被误改写。
- 真实 e2e 断言覆盖 Renderer → preload → Main → AI SDK → provider → Codex App Server：消息包含带一个本地路径的普通文本上下文和一张 localImage，且响应正常返回。

## 5. 风险与缓解

- **路径协议被特殊字符破坏**：草稿 directive 使用 `encodeURIComponent`，模型文本前缀使用 JSON 字符串编码；formatter 和 provider 都对损坏输入采取“原文保留”而非抛错。
- **跨平台混合选择失效**：文件、文件夹使用两个 picker mode，不设置 `openFile + openDirectory`。
- **本地路径误发到远程执行目标**：远程项目隐藏路径入口；Main 只返回路径，Provider 不上传文件。
- **普通文件内容意外进入消息**：路径只进入普通文本上下文；测试监控 read/write 调用，禁止复用通用 `*` attachment adapter。
- **内部上下文被误显示或误解析**：只解析消息开头的完整 Files mentioned/My request 结构，label/path 使用 JSON 字符串编码；历史渲染移除合法前缀，格式不完整时原样显示。
- **路径类型在历史中降级**：客户端元数据存在时保留 file/folder；只有 App Server 文本历史时恢复为通用路径引用，不通过访问磁盘猜测类型。
- **图片 MIME 丢失**：自定义 image-only adapter 保留 `File.type`，针对 PNG/JPEG/WebP 分别断言。
- **模型不支持图片**：以模型目录的 `inputModalities` 为唯一判断依据；添加和发送两处都设保护，并覆盖切换模型测试。
- **超大或过多图片由下游拒绝**：首期不硬编码未经协议确认的阈值；保留错误附件状态、展示 Provider/App Server 原因并允许移除，后续再增加可配置限制。
- **历史消息丢失路径**：history mapper 优先读取附件元数据，缺失时从普通文本前缀恢复，并以完全重启后的历史测试验证。
- **assistant-ui unstable API 变化**：把 trigger/formatter 适配集中在一个 Composer context 模块；现有 `@` 行为保留回归测试。

## 6. 验证命令

实现完成后依次执行：

```bash
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run lint
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp run typecheck
npm --prefix desktop-app/vendors/ai-sdk-provider-codex-asp test
npm --prefix desktop-app run lint
npm --prefix desktop-app test
npm --prefix desktop-app run test:e2e -- --reporter=line
```

验收停止条件：上述检查通过，且 e2e 已证明路径引用进入普通文本上下文、历史可从该文本恢复路径 chip、照片映射为 localImage；如环境无法运行 e2e，必须记录具体缺口，不能仅凭 Renderer 单测宣称完成。

## 7. 组件资料依据

- assistant-ui Attachment：<https://www.assistant-ui.com/docs/primitives/attachment>
- assistant-ui Composer（AddAttachment、Attachments）：<https://www.assistant-ui.com/docs/primitives/composer>
- shadcn/ui Popover：<https://ui.shadcn.com/docs/components/base/popover>
- shadcn/ui Command：<https://ui.shadcn.com/docs/components/base/command>
- Electron dialog：<https://www.electronjs.org/docs/latest/api/dialog>

## 8. 默认假设

- 首期以本地项目为目标；远程文件引用另立需求。
- “搜索并引用上下文”首期只覆盖工作区文件和当前模型工具；不扩大到历史对话、Apps、Skills、Plugins、Sites 或 MCP。
- 普通文件和文件夹是“路径引用”，不是“读取内容附件”；照片是唯一二进制输入。
- 不扩展 App Server `UserInput` 或 `TurnStartParams`，也不向当前协议发送自定义 `attachments` 字段。
- App Server 普通文本历史不保存可靠的 file/folder kind；客户端元数据缺失时使用通用路径图标，不影响 path 语义。
- 首期不新增图片数量/大小硬限制，只实现模型能力守卫、读写错误状态和下游拒绝提示。
- 不引入新 npm 依赖，不运行 shadcn 代码生成器；现有组件足够完成首期交互。
