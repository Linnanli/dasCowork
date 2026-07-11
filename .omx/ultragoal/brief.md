# 受控 `app://` 本地媒体协议实施计划

## 状态与范围

**状态：已完成可行性审查，待实施。**

目标是在 `desktop-app` 中复刻参考项目的核心协议边界，解决历史对话附件以 `file://` 传入 renderer 后在 CSP/HTTP 开发页中加载失败的问题，同时避免向 renderer 放开通用本地文件访问。

本计划覆盖：

- `app://-/...`：生产环境的 renderer HTML、JS、CSS 等静态资源；
- `app://fs/@fs/<绝对路径>`：仅本地图片和视频的受控流式读取；
- 对话历史里的 `file://` 图片：在 **main process** 转换为 `app://fs` URL，再交给 assistant-ui 渲染；
- 历史消息再次提交给模型前：在 **main process** 把受控 `app://fs` URL 还原为 `file:` URL，使 provider 继续生成 `localImage` 输入；
- `data:` 与 `blob:`：继续保留给内嵌图片和已下载的内存资源。

本计划**不**实现“所有本地文件都能通过 URL 在 renderer 中读取”。文档、压缩包、代码等普通文件继续使用现有打开文件、下载或未来的专用预览能力。

## 已确认的依据

| 结论 | 依据 |
| --- | --- |
| 参考项目的 CSP 放行 `app:`、`blob:`、`data:`，但不放行 `file:`。 | [参考 CSP](/Users/nallylin/Documents/code/dasCowork/reference-projects/codex-electron-26.623.101652-beautified/webview/index.html:138) |
| 参考项目在应用启动前把 `app` 注册为标准、安全、可流式读取的协议。 | [参考协议注册](/Users/nallylin/Documents/code/dasCowork/reference-projects/codex-electron-26.623.101652-beautified/.vite/build/workspace-root-drop-handler-4fzIumU3.js:4698) |
| `app://fs/@fs` 只接受绝对路径且只允许 `image/*`、`video/*`。 | [参考本地媒体校验](/Users/nallylin/Documents/code/dasCowork/reference-projects/codex-electron-26.623.101652-beautified/.vite/build/workspace-root-drop-handler-4fzIumU3.js:4824) |
| 参考项目把 `app://fs` 请求限制为自身主页面或开发 renderer origin。 | [参考请求来源限制](/Users/nallylin/Documents/code/dasCowork/reference-projects/codex-electron-26.623.101652-beautified/.vite/build/workspace-root-drop-handler-4fzIumU3.js:4787) |
| 当前生产环境用 `loadFile()`，开发环境用 Vite HTTP；尚未注册自定义协议。 | [当前窗口加载](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/index.ts:226) |
| 当前 CSP 只允许 `'self' data:`，因而不会允许来自 HTTP renderer 的 `file:` 图片。 | [当前 CSP](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/index.html:8) |
| 当前会话恢复通过读取本地图片字节转成 `data:`，会放大 IPC 负载。 | [当前 data URL 转换](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/localImageDataUrls.ts:24) |
| 当前附件组件已具备 `<img>` 加载失败后的稳定文件缩略图回退。 | [当前附件回退](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/App.tsx:1013) |
| 恢复后的 `UIMessage[]` 会在后续发送时整体回传 main，并在 main 中转换为模型消息。 | [Renderer 回传消息](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts:118)、[Main 转换模型消息](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.ts:595) |
| Provider 只把 `file:` 图片映射为 `localImage`，其他 URL 会作为远端 `image` URL。 | [Provider 图片 URL 映射](/Users/nallylin/Documents/code/dasCowork/desktop-app/vendors/ai-sdk-provider-codex-asp/src/utils/prompt-file-resolver.ts:173) |
| 当前 E2E 通过 `electron .` 启动构建产物，不等价于 electron-builder 打包后的 asar/unpacked 应用。 | [当前 E2E 启动方式](/Users/nallylin/Documents/code/dasCowork/desktop-app/tests/e2e/support/app.ts:35) |

## 目标架构

```text
历史 UIMessage 的 file:// 图片
        │  openConversation() 在 main process 规范化展示 URL
        ▼
app://fs/@fs/<经过编码的绝对路径>
        ├─────────────────────────────────────────┐
        │                                         │
        ▼                                         ▼
Electron protocol.handle('app')            后续发送/编辑历史消息
  ├─ host '-'  → renderer 静态资源               │
  └─ host 'fs' → 来源、类型、路径、Range 校验     │ main process 反向还原
        │                                         ▼
        ▼                                  file:///<绝对路径>
Renderer <img> / 后续 <video>                     │
                                                  ▼
                                       provider → localImage

非首方 frame / 非 image、media 请求 / 非媒体文件 / 非法路径
        → 取消请求或返回 404
```

## 决策记录（ADR）

### 决定

采用参考项目同构的 `app://-` 与 `app://fs/@fs` 双 host 设计；生产环境由 `app://-/index.html` 加载 renderer，历史图片以 `app://fs` 呈现。保留 `data:` 作为已有内嵌图片的兼容格式，而不是将所有资源转成 Base64。

`app://fs` 是 renderer 的展示协议，不是 provider/app-server 的模型输入协议。main process 在消息进入 renderer 前执行 `file: -> app:` 转换，在消息进入 `convertToModelMessages()` 前执行受控的 `app: -> file:` 反向转换。两次转换使用同一组解析与媒体 allowlist，避免 renderer 展示需求泄漏到 provider 协议层。

### 驱动因素

1. `file:` 不应加入 CSP，且 Vite HTTP 开发页无法可靠读取它。
2. 本地大图片不应在每次打开历史会话时复制成 Base64 并经 IPC 传输。
3. 自定义协议必须同时处理 URL、文件类型、路径和请求来源；仅注册协议不足以形成安全边界。

### 备选方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 继续全部转换成 `data:` | 保留为兼容回退，不作为主路径 | 简单但会复制图片字节，历史图片较大时内存和 IPC 成本高。 |
| 在 CSP 中放开 `file:` | 拒绝 | renderer 将获得不受控的本地 URL 读取面，且与参考项目策略相反。 |
| 只实现 `app://fs`，继续用 `file://` 加载生产 renderer | 拒绝 | 无法形成稳定的一方页面 origin，来源校验会退化。 |
| 使用 token/capability URL 代替路径 URL | 后续增强项 | 隐藏路径更强，但并非参考项目的 `app://fs` 同构实现，会增加生命周期和缓存管理。 |

### 后果

- 生产环境 renderer origin 从 `file:` 迁移为 `app://-`；所有静态资源必须能由协议处理器正确返回。
- 本地媒体路径仍会出现在 renderer DOM 的 URL 中；参考实现以“仅自身 frame 可以请求 + 仅媒体 MIME”来限制读取，后续若有更高隐私要求再升级 capability URL。
- 历史消息存在展示形态和模型输入形态两种 URL；转换职责固定在 main process，renderer 和 provider 均不新增协议知识。
- 视频保留在协议能力范围内，并实现字节范围响应；本次仍不新增聊天视频播放器 UI。
- 现有已存储的 `data:` 图片无需迁移；已失效的临时路径仍会触发现有 UI 回退，而不会显示浏览器裂图。

## 可测试的验收标准

1. 无 `ELECTRON_RENDERER_URL` 的生产构建分支通过 `app://-/index.html` 成功加载；HTML、JavaScript、CSS、JSON/WASM、字体和图片静态资源返回正确 `Content-Type`，开发环境仍从 `ELECTRON_RENDERER_URL` 加载并保留 HMR。
2. `app://fs/@fs` 仅能读取绝对路径的允许媒体类型：至少覆盖 PNG、JPEG、WebP、SVG、GIF、MP4、WebM；视频无 Range 时返回 `200`，合法 Range 返回 `206` 和正确的 `Content-Range`，非法 Range 返回 `416`。
3. 相对路径、空路径、双重编码的 `..`、静态根目录穿越、文本/压缩包/脚本文件、未知扩展名均得到 404，绝不读取文件内容。
4. 对 `app://fs/*` 的请求仅接受来自 `app://-` 的 `image`/`media` 子资源请求；开发模式额外允许精确匹配的 Vite origin。任意 HTTP 站点、`webview`、外部窗口、无 frame 请求以及 `mainFrame`、`subFrame`、`xhr` 等其他资源类型均被取消。
5. 历史会话中的 `file:///tmp/image.png` 在 main process 返回前被替换为 `app://fs/@fs/...png`；远端 URL 和已有 `data:` URL 不变，renderer 不再收到该附件的 `file:` URL。
6. 继续普通历史会话、编辑并重新提交带历史图片的用户消息时，进入 provider 的图片仍为 `file:`/`localImage`，绝不把 `app://fs` 发送给 app-server 或上游模型服务。
7. 图片不存在、权限不足或协议返回 404 时，附件组件显示现有非图片缩略图回退，不显示浏览器的裂图图标。
8. macOS 关闭全部窗口后通过 `activate` 重建窗口，`app://fs` 的来源限制仍然生效，且 request listener 没有重复注册。
9. 不新增 renderer 直连 Node/Electron 能力，不经 preload 暴露任意路径读取 API，不新增通用文件协议。

## 实施步骤

### 1. 提取可单测的协议策略模块

新增 `desktop-app/src/main/localMediaProtocol.ts` 与 `desktop-app/src/main/localMediaProtocol.test.ts`。

- 定义稳定常量：`APP_SCHEME = 'app'`、静态 host `'-'`、媒体 host `'fs'`、媒体前缀 `'/@fs'`。
- 提供三个职责明确的导出：
  - `registerAppSchemePrivileges(protocol)`：只调用 Electron 的 `registerSchemesAsPrivileged()`；必须在 `app.whenReady()` 之前执行。
  - `registerAppProtocol(options)`：在 ready 后注册 `protocol.handle('app', handler)` 和 `defaultSession.webRequest.onBeforeRequest`。
  - `toAppMediaUrl(fileUrlOrAbsolutePath)`：只在 main process 将合法 `file:` URL/绝对路径转成 `app://fs/@fs/...`。
- 再提供共享的反向解析能力 `resolveAppMediaPath(appMediaUrl)`：只有 scheme、host、前缀、编码、绝对路径和媒体 allowlist 全部合法时才返回本地绝对路径；展示协议 handler 与模型输入还原必须复用它，不能维护两套解析逻辑。
- 把 handler 拆成纯函数：静态资源解析、媒体资源解析、首方 origin 判定、响应构建。依赖以参数注入（`stat`、`createReadStream`、`protocol`、`session`、`platform`），保持 Vitest 无 Electron 运行时也能测试。
- 不新增 `mime-types` 依赖。维护两张用途不同的显式映射：
  - 静态资源 MIME 表覆盖构建产物实际需要的 HTML、JS/MJS、CSS、JSON、WASM、SVG/PNG/JPEG/WebP、WOFF/WOFF2/TTF 等类型；未知静态扩展名返回 404。
  - 本地媒体 allowlist 复用并扩展 [当前图片扩展名映射](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/localImageDataUrls.ts:9)，只包含允许展示的 image/video 类型；扩展名匹配仅决定是否允许和响应 MIME，不宣称验证了文件内容真实性。
- 媒体路径按参考实现处理：解码后先拒绝 `..` 路径段，再要求 `path.isAbsolute()`；只对 allowlist MIME 返回实际路径。静态文件则必须在 renderer 产物根目录内，通过 `path.relative()` 二次验证。
- URL 生成与解析必须满足往返不变量：空格、Unicode、`#`、`?`、POSIX 根路径、Windows 盘符和 UNC 路径转换后可无损还原；不得通过整段 `encodeURIComponent()` 破坏路径分隔符，也不得人工拼出多余的 `/`。
- 非 Windows 使用 `createReadStream()` 转为 Web stream 返回 `Response`；Windows 保留 `net.fetch(pathToFileURL(...))` 分支，避免平台差异。所有分支都必须返回明确的 `Content-Type` 和 `Content-Length`。
- 视频分支按参考实现解析单段 `Range: bytes=...`，返回 `Accept-Ranges: bytes`、`206`/`Content-Range` 或 `416`；图片和静态资源不进入视频 Range 分支。
- 首方判断读取 `webRequest` 的 `details.frame?.url`，对 `app:` 按 `app://${host}` 比较，对 HTTP(S) 才使用标准 `origin`；不要直接依赖 Node `new URL('app://-').origin`。同时检查 `resourceType` 只允许 `image`/`media`，frame 缺失时默认拒绝。

### 2. 在主进程注册协议并迁移生产页面 origin

修改 `desktop-app/src/main/index.ts`。

- 在文件顶层、`app.whenReady()` 之前调用 `registerAppSchemePrivileges(protocol)`；保证 Electron 在创建 session 前知道该 scheme 的安全属性。
- 在 `app.whenReady()` 回调的前段调用 `registerAppProtocol()`，注入：
  - renderer 产物目录 `join(__dirname, '../renderer')`（当前 `loadFile()` 的同一目录，见 [index.ts](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/index.ts:229)）；
  - 生产首方 origin `app://-`；
  - 开发模式下精确的 `ELECTRON_RENDERER_URL` origin。
- 修改 `createWindow()`：开发分支保留 `loadURL(ELECTRON_RENDERER_URL)`；生产分支改为 `loadURL(createAppRendererUrl())`，其结果为 `app://-/index.html`。
- 保留既有 `setWindowOpenHandler`、审批事件和 IPC handler，不将协议逻辑塞入 preload 或 renderer。
- 协议 handler 和 `webRequest` listener 与 default session/application 同寿命，只在 `app.whenReady()` 初始化一次；不得在 `window-all-closed` 清理，因为 macOS 会在应用不退出时通过 `activate` 重建窗口。若测试或显式 app shutdown 需要清理，只允许在应用真正退出或隔离的测试 session 中调用 `protocol.unhandle()`/传入 `null` listener。
- 注册函数必须防止重复调用；同时在测试中记录 Electron 对同一 `webRequest` 事件只保留最后一个 listener 的约束，后续新增网络拦截功能必须通过同一注册边界协调。

### 3. 用受控 URL 代替会话恢复时的 `file:` 与 Base64 转换

重命名并重写 `desktop-app/src/main/conversations/localImageDataUrls.ts` 为 `localMediaUrls.ts`，同步重命名测试文件。

- 将 `inlineLocalImageDataUrls()` 改为同步或轻量异步的 `normalizeLocalMediaUrls()`：遍历历史 `UIMessage` 的 `file` part；只处理 `mediaType` 为 `image/*`（预留 `video/*` 支持）的 `file:` URL。
- 用 `toAppMediaUrl()` 替换 URL；不再读文件、不再构造 Base64、也不在 `openConversation()` 阶段传输图片字节。
- 已经是 `data:`、`blob:`、`https:`/`http:` 的 URL 保持不变；不识别或不可转换的 `file:` URL 保持原始数据，让 renderer 走现有 `onError` 回退，而不是伪造成功 URL。
- 修改 [ConversationApiService](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/conversations/ConversationApiService.ts:164) 的导入与调用；若转换变为同步，删除无意义的 `await`。
- 新增纯函数 `restoreLocalMediaFileUrlsForModel(messages)`：在 [defaultStreamText()](/Users/nallylin/Documents/code/dasCowork/desktop-app/src/main/codexChatRuntimeService.ts:576) 调用 `convertToModelMessages()` 之前，把合法 `app://fs` 图片还原为 `pathToFileURL(resolveAppMediaPath(...))`；`data:`、`blob:`、HTTP(S) 等其他协议保持既有行为，任何无法通过共享解析器的 `app:` URL 都应拒绝当前请求，不得变成本地读取或原样发往 provider。
- 该反向转换只用于 main -> provider 的临时模型输入副本，不修改 renderer 内的 `entry.chat.messages`，从而保证 UI 继续使用 `app://fs`。
- 增加“打开历史会话后继续发送普通文本”和“编辑并重新提交带图片的历史用户消息”两条回归测试，断言 provider 输入为 `localImage`，上游请求中不存在 `app://fs`。

### 4. 收紧并扩展 renderer CSP

修改 `desktop-app/src/renderer/index.html`。

- 把 `img-src` 与 `media-src` 更新为 ` 'self' app: blob: data:`；如页面存在受控 HTTPS 图片需求，再单独增加 `https:` 并补测试/评审依据。
- 保持 `file:` 不在 allowlist 中。
- `script-src`、`connect-src`、`default-src` 不因本功能放宽。
- 在开发窗口、无 `ELECTRON_RENDERER_URL` 的生产构建窗口和 electron-builder unpacked 窗口中分别确认：`app://fs` 图片允许加载，外部 `file:` 图片被 CSP 或协议拒绝。

### 5. 保持附件 UI 的成功与失败状态清晰

修改 `desktop-app/src/renderer/src/App.tsx` 与 `desktop-app/src/renderer/src/App.test.tsx`。

- 保留现有 `UserMessageAttachment` 的 `<img>` 与 `onError` 状态切换，不再依赖 `AttachmentPrimitive.unstable_Thumb` 直接渲染图片。
- 更新测试输入，使用真实目标格式 `app://fs/@fs/...`，断言图片元素收到该 URL、加载错误后移除 `<img>` 并展示现有回退缩略图。
- 不把任意 `file:` URL 作为 renderer 测试中的“成功图片源”；另加一条防回归断言，历史恢复层应在到达该组件前把本地图片转换。
- 本阶段仅让协议支持视频；聊天附件的 `<video>` 交互和播放器 UI 不在本次范围，避免把“资源安全”与“新 UI 功能”混在一次变更中。

### 6. 补齐分层测试和真实应用验证

新增或更新下列测试：

- `desktop-app/src/main/localMediaProtocol.test.ts`
  - privileged scheme 配置精确包含 `standard`、`secure`、`stream`、`supportFetchAPI`；
  - `bypassCSP`、`corsEnabled`、`allowServiceWorkers` 等非必需权限未被开启；
  - `app://-/index.html` 与构建所需的 JS、CSS、JSON/WASM、字体和图片可解析且 MIME 正确，`../`、编码穿越、未知静态扩展名和未知 host 返回 404；
  - `app://fs/@fs` 接受 image/video allowlist，返回正确 `Content-Type`、`Content-Length` 和流；拒绝文本、压缩包、相对路径、无效编码、目录和不存在文件；
  - 视频覆盖无 Range、起止 Range、开放结束 Range、后缀 Range、越界/多段/非法 Range 的 `200`、`206`、`416` 行为；
  - 首方 `app://-` 与开发 Vite origin 的 `image`/`media` 请求被允许，其他 origin、缺失 frame 和其他 resourceType 被取消；
  - `app:` 来源使用 scheme + host 判定，不使用 Node 返回的 `origin === 'null'`；
  - macOS/Linux 的 stream 分支与 Windows 的 `net.fetch(file:)` 分支均通过依赖注入测试。
- `desktop-app/src/main/conversations/localMediaUrls.test.ts`
  - `file:///tmp/codex-clipboard.PNG` 转成 `app://fs/@fs/...`；
  - 空格、Unicode、`#`、`?`、POSIX 路径、Windows 盘符和 UNC 路径往返无损；
  - 合法 `app://fs` 能反向解析，未知 host、错误前缀、双重编码穿越、相对路径和非媒体扩展名不能反向解析；
  - `data:`、远端 URL、非媒体文件不变。
- `desktop-app/src/main/conversations/ConversationApiService.test.ts`
  - 打开历史会话时，renderer 得到 `app://fs` 而非 `file:`/Base64；断言不发生 `readFile`。
- `desktop-app/src/main/codexChatRuntimeService.test.ts` 及必要的 provider 集成测试
  - 普通继续会话只提交最新用户输入；
  - 编辑/重提带 `app://fs` 图片的历史用户消息时，模型输入恢复为 `file:` 并最终映射为 `localImage`；
  - 非法或非媒体 `app://fs` 不会触发本地文件读取，也不会原样发往上游模型服务。
- `desktop-app/src/renderer/src/App.test.tsx`
  - 验证 `app://fs` 图片预览、`error` 回退以及 `file:` 不应作为正常预览成功源。
- 新增 `desktop-app/tests/e2e/local-media-protocol.e2e.ts`
  - 通过现有 `electron .` fixture 验证生产构建分支加载 `app://-` 页面，但不把它描述为 packaged/asar 验证；
  - 通过测试专用临时 PNG 验证 `app://fs` 能显示；
  - 用同一 default session 创建受控 HTTP 测试页面，真实验证 HTTP frame、无 frame/主 frame 导航、非 `image`/`media` 请求和 `.txt` 无法读取协议内容；该来源限制验收不得退化为纯函数单测。
  - 在 macOS 覆盖关闭全部窗口后 `activate` 重建窗口，确认来源限制仍存在且 listener 未重复绑定；其他平台至少以 main 集成测试验证应用级生命周期。
- 增加 packaged smoke：通过 `electron-builder --dir` 生成 unpacked 应用并以其真实 executable 启动，验证 `app.isPackaged === true`、asar/unpacked 中的 `app://-/index.html`、主 JS/CSS 和一张媒体文件均能加载。若暂不纳入每次 E2E，必须作为发布前固定检查，不能由 `electron .` 结果替代。

### 7. 验收、性能检查与文档

- 执行目标测试：
  - `npm --prefix desktop-app test -- localMediaProtocol.test.ts localMediaUrls.test.ts ConversationApiService.test.ts App.test.tsx`
  - `npm --prefix desktop-app test -- codexChatRuntimeService.test.ts`
  - `npm --prefix desktop-app run typecheck:node`
  - `npm --prefix desktop-app run typecheck:web`
  - `npm --prefix desktop-app run lint`
  - `npm --prefix desktop-app run test:e2e -- --reporter=line`
- 手动检查开发模式、生产构建分支和 electron-builder unpacked 包各一次：打开含剪贴板图片的历史会话、编辑并重新提交该消息、打开临时文件已删除的历史会话、检查 DevTools Network 中成功请求为 `app://fs` 且失败请求为 404/回退，并检查模型请求中没有 `app://fs`。
- 记录浏览器裂图、协议 404、被拒绝来源、类型拒绝的结构化日志（仅记录 protocol、扩展名、状态、webContents id；不记录完整本地路径）。
- 更新本计划状态与最终改动文件清单；如果实际需求扩展到普通文件预览，另开 capability URL/下载器计划，不扩大 `app://fs` 的 allowlist。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 生产 renderer 的相对资源路径在 `app://-` 下失效 | 先对静态资源 handler 写测试，再在生产构建 E2E 与 packaged smoke 中分别验证 HTML、JS、CSS 均可加载。 |
| 静态 JS/CSS/字体缺少正确 MIME 导致生产白屏 | 静态资源使用独立的显式 MIME 表，单测覆盖当前构建产物的全部扩展名，并在真实 Electron 页面断言没有模块 MIME 错误。 |
| 只做 CSP 修改导致任意本地文件泄露 | 保持 `file:` 禁用；协议层执行 origin、路径与 MIME 三重检查。 |
| `app://fs` 被作为主页面、iframe 或 fetch 入口使用 | 来源校验同时限制 frame origin 和 `resourceType`，只允许 `image`/`media` 子资源，缺失 frame 默认拒绝。 |
| 直接使用 `path.normalize()` 被编码绕过 | 在解码前后检查穿越段，并用 `relative()` 复核静态根目录边界。 |
| 展示 URL 在编辑/重提历史消息时被发送给 provider | 在 `convertToModelMessages()` 前对模型输入副本执行受控反向转换，并覆盖编辑历史图片消息的集成测试。 |
| 视频能首帧加载但无法跳播 | 实现并测试单 Range 的 `206`/`416` 行为；若无法完成则从本期范围和验收标准中移除视频支持。 |
| 临时剪贴板文件被清理 | 协议返回 404，现有 `onError` 转为稳定附件回退；不声称可恢复已删除的原始图片。 |
| 允许列表不完整导致某种图片不能显示 | 起始支持明确列出的常见格式；新增格式必须同时补 MIME、协议测试和 UI 测试。 |
| macOS 关闭窗口后清理 listener 导致重开窗口失去保护 | listener 与应用/default session 同寿命，不在 `window-all-closed` 清理；测试覆盖 `activate` 重建窗口。 |
| 多窗口/开发重载重复注册或覆盖 request listener | 协议注册封装为应用级一次性初始化；集中管理同类 `webRequest` 监听，测试断言重复调用不重复绑定。 |
| `electron .` 通过但真实安装包读取 asar 失败 | 将生产构建 E2E 与 packaged smoke 分开，发布前必须以 electron-builder unpacked 可执行文件验证。 |

## 完成条件

- 生产页面从 `app://-` 加载，开发页面保持 Vite HTTP 开发体验。
- 历史图片不再以 `file:` 或 Base64 形式跨 main/renderer 传递，而是使用验证后的 `app://fs` URL。
- 历史图片再次进入模型输入时被还原为 `file:`/`localImage`，普通继续会话与编辑重提均不向 app-server 或模型服务发送 `app://fs`。
- `app://fs` 无法读取普通文件，且非首方 renderer 无法请求本地媒体。
- 视频 Range、macOS 窗口重建、生产构建分支和真实 packaged/unpacked 启动均有对应验证证据。
- 所有验收标准对应的单元、集成/E2E 验证通过；已有聊天、模型、审批、项目和会话测试无回归。
