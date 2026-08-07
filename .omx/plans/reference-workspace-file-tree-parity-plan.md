# 参考项目工作区文件树复刻开发计划

## 计划状态

- 模式：`$plan` direct（已有参考项目分析和明确落点，不进入共识评审模式）
- 目标：把当前 `FileWorkspace` 的简单递归目录列表升级为参考项目同类的路径驱动文件树，同时保留现有文件预览、工作区标签页、IPC 和安全边界。
- 主方案：直接采用参考项目同源的 `@pierre/trees` React 组件，通过本项目适配层接入。
- 回退方案：如果依赖在 React 19、Electron Vite、Shadow DOM 样式或许可证检查中不通过，则保留相同适配层接口，继续使用当前自研树渲染器；不因此改动 main/preload 协议。

## 需求摘要

1. 复用当前已经完成的工作区文件能力：目录读取、文件读取、搜索、系统打开、文件变化通知和路径安全校验，不新建第二套文件系统链路。
   - Renderer 调用入口：`desktop-app/src/renderer/src/components/right-workspace/files/FileWorkspace.tsx:119-286`
   - Preload 白名单：`desktop-app/src/preload/index.ts:420-463`
   - Main IPC：`desktop-app/src/main/rightWorkspace/registerRightWorkspaceIpc.ts:98-145`
   - 文件服务与路径安全：`desktop-app/src/main/rightWorkspace/FileWorkspaceService.ts:49-272`
2. 使用 `@pierre/trees` 提供树模型、虚拟滚动、键盘导航、焦点、选中、粘性目录和 Shadow DOM 渲染；不复制或修改第三方源码。
   - 参考项目树模型：`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-CrA1-JEm.js:61674-62031`
   - 参考项目 React 包装层：同一文件 `:155524-155656`
   - 官方接口参考：<https://github.com/pierrecomputer/pierre/blob/main/packages/trees/README.md>
3. 对齐参考项目的应用层行为：
   - 按展开目录懒加载，不预先递归扫描整个工作区。
   - 单击文件打开临时预览，双击固定标签页。
   - 切换到已打开文件时，自动展开祖先目录、选中并滚动到文件。
   - 保存文件树显示/宽度、展开目录和滚动位置；切换任务后按工作区隔离。
   - 搜索时展示独立结果列表，清空搜索后恢复原树状态。
   - 文件变化后只刷新受影响目录，保留展开、选中和滚动状态。
   - 显示可用的 Git 状态、文件/目录图标和右键菜单。
   - 参考项目工作区浏览控制器：同一参考 bundle `:157677-158058`
   - 参考项目树状态同步和选中项显现：同一参考 bundle `:156055-156224`
4. 保持当前通用工作区容器不变：Files 标签仍可在右侧和底部工作区移动，预览标签仍执行“替换临时预览、保留固定标签”的现有规则。
   - 内容注册：`desktop-app/src/renderer/src/components/workspace-container/WorkspaceContentRegistry.tsx:102-127`
   - 工作区持久化：`desktop-app/src/renderer/src/components/workspace-container/workspacePersistence.ts:10-71`
5. 不修改 `codex/codex-rs/app-server/`，不改变聊天推理链路，不把任意本地路径能力暴露给 renderer。

## 范围边界

### 本轮包含

- 文件树底层组件替换和适配层。
- 懒加载、展开/选中/滚动状态、选中项显现。
- 现有文件名搜索的参考项目式结果视图。
- 文件变化刷新。
- 键盘操作、可访问性语义和虚拟滚动。
- Git 状态装饰、基础文件/目录图标。
- 右键菜单：临时预览、固定打开、复制相对路径、使用系统应用打开。
- 在右侧和底部工作区中的一致行为。

### 暂不包含

- 文件编辑、创建、删除、重命名和拖拽移动。
- 远程 host 文件树；当前 root 只接受 main 根据本地会话解析出的工作区。
- 完全像素级复制；对齐信息层级、行高、选中态、悬停态和交互，继续使用本项目主题变量。
- “加入聊天上下文”右键项。参考项目有该业务动作，但当前工作区注册表没有安全的 composer 插入接口；应在文件树稳定后作为独立的 composer 集成任务处理，避免文件树直接操作聊天内部状态。
- 对 `@pierre/trees` 做 fork 或把其源代码复制进仓库。

## 当前能力与差距

| 能力 | 当前状态 | 目标状态 | 主要落点 |
| --- | --- | --- | --- |
| 目录读取 | 已按目录懒加载 | 保留并加请求去重/过期响应保护 | `FileWorkspace.tsx:119-190` |
| 树渲染 | React 递归渲染全部已展开节点 | `@pierre/trees` 虚拟化路径模型 | `FileWorkspace.tsx:587-651` |
| 搜索 | 150ms 后端搜索，独立结果列表 | 保留交互并恢复树选中/滚动状态 | `FileWorkspace.tsx:251-273, 374-430` |
| 文件打开 | 单击预览、双击固定 | 完全保留 | `FileWorkspace.tsx:275-287, 390-427` |
| 选中项显现 | 仅设置样式，不保证祖先展开或滚入视口 | 自动展开祖先并滚动到当前文件 | 新树控制器 + `@pierre/trees` model |
| 树状态 | 只保存显示和宽度 | 增加展开目录和滚动位置，按 workspaceId 隔离 | `FileWorkspace.tsx:705-738` |
| 文件变化 | 已监听并刷新相关目录 | 保留状态，合并重复事件和请求 | `FileWorkspace.tsx:223-249` |
| Git 状态 | 文件树未显示 | 复用现有 Git repository/provider 和 review snapshot | `GitRepositoryProvider.tsx:31-94`、`localGitApi.ts:119-165` |
| 图标 | 通用 Lucide 文件/目录图标 | 先按文件/目录/常见扩展映射，不再造协议 | 新树适配层 |
| 可访问性 | 每行是按钮，无标准 tree 键盘模型 | `role=tree/treeitem`、方向键/Home/End/Enter | `@pierre/trees` + 组件测试 |
| 超大目录 | 单目录最多 500 项，UI 不提示截断 | 保留上限并显示“结果已截断” | `fileWorkspaceApi.ts:5-9, 60-81` |
| 安全 | realpath + 工作区根目录约束 | 原样保留，第三方组件只接收相对路径 | `FileWorkspaceService.ts:215-270` |

## 目标结构

```text
FileWorkspace
├── FilePreview（保留现有实现）
└── WorkspaceFileTreeController
    ├── 目录缓存 / 请求去重 / 文件变化刷新
    ├── 展开、选中、滚动和搜索状态
    ├── WorkspaceFileTreePathAdapter（FileWorkspaceEntry -> path-first model）
    └── WorkspaceFileTreeView（@pierre/trees React 包装）
        ├── 主题与图标
        ├── Git 状态
        └── 右键菜单

Renderer -> 现有 preload API -> 现有 main IPC -> FileWorkspaceService
```

建议新增的 renderer 文件：

- `desktop-app/src/renderer/src/components/right-workspace/files/WorkspaceFileTree.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/files/useWorkspaceFileTree.ts`
- `desktop-app/src/renderer/src/components/right-workspace/files/workspaceFileTreeModel.ts`
- `desktop-app/src/renderer/src/components/right-workspace/files/workspaceFileTreePersistence.ts`
- 对应的 `*.test.ts` / `*.test.tsx`

原则：`FileWorkspace.tsx` 继续负责“预览区 + 文件树面板布局”；树的目录缓存和第三方 model 生命周期从当前 700 多行组件中分离，但不建立与其它工作区无关的通用框架。

固定的首期 model 配置为：`stickyFolders: true`、`flattenEmptyDirectories: false`、`search: false`、`renaming: false`。搜索继续由现有后端覆盖未加载目录；空目录折叠和重命名不借树组件顺手开启。

## 可测试验收标准

### 核心树行为

- **AC-01**：打开 Files 工作区时只调用一次 `prepareRoot` 和一次根目录 `listDirectory('')`；未展开的子目录不得读取。
- **AC-02**：首次展开目录只发起一次读取；同一请求未完成时重复点击不得产生并行重复请求；折叠后再次展开使用缓存，除非该目录已收到文件变化事件。
- **AC-03**：目录路径传给 `@pierre/trees` 时统一使用尾部 `/`，文件路径不带 `/`；symlink 和 `other` 不得被当作可展开目录。
- **AC-04**：单击文件调用 `onOpenFile(path, name, 'preview')`，双击调用 `onOpenFile(path, name, 'pinned')`，行为与现有 E2E 一致。
- **AC-05**：活动文件路径改变时，树自动加载并展开全部祖先、选中目标，并在最多 60 个 animation frame 内滚动到目标；路径不存在时不死循环、不清空其他已加载目录。
- **AC-06**：10,000 个已知路径下，DOM 中实际渲染的 `treeitem` 数量保持在 300 以内；滚动到底部仍能选择目标文件；滚动深层目录时粘性祖先目录保持可见。

### 状态和搜索

- **AC-07**：按 `workspaceId` 保存 `visible`、`width`、`expandedPaths`、`scrollTop`；重新挂载同一工作区恢复状态，不同工作区互不污染。
- **AC-08**：持久化数据损坏、超额或字段类型错误时回到默认值，不影响文件预览；最多保存 500 个展开路径并限制每条路径长度为 4096。
- **AC-09**：输入搜索词 150ms 后调用现有 `files.search(... includeContent: false)`；搜索期间显示加载状态，零结果显示空态，点击/双击结果仍分别执行预览/固定。
- **AC-10**：清空搜索后恢复搜索前的展开、选中和滚动位置；点击搜索结果后，返回树视图时目标祖先已加载并展开。

### 刷新、Git 和菜单

- **AC-11**：`fileEvent` 只刷新变更文件的父目录；连续事件合并处理，刷新后保持当前展开、选中和滚动位置。
- **AC-12**：文件被删除时，目录项在刷新后消失；若它正处于预览状态，预览区显示已有错误态，树本身仍可操作。
- **AC-13**：在 Git 仓库内，当前存在的 added/modified/renamed 文件显示对应状态；非 Git 工作区和 Git 查询失败时静默退化为无装饰文件树，不阻塞目录加载。
- **AC-14**：右键文件可预览、固定、复制相对路径、使用系统应用打开；目录不显示文件专属动作；所有打开动作继续走现有 preload/main 白名单。
- **AC-15**：当 `listDirectory().truncated === true` 时，对应目录显示可识别提示，用户不会误以为已经展示全部文件。

### 兼容性和安全

- **AC-16**：Files 标签在 right/bottom 面板移动后，树可继续滚动、搜索和打开文件，不创建第二个 root watcher。
- **AC-17**：方向键、Home/End、Enter/Space 可操作树；焦点样式可见，屏幕阅读器可识别 tree/treeitem、展开态和选中态。
- **AC-18**：路径越界、绝对路径、反斜杠路径和逃逸 symlink 仍被现有 schema/service 拒绝；新增 renderer 代码不得拼接绝对路径后直接访问 Node/Electron。
- **AC-19**：`codex/codex-rs/app-server/` 零改动；provider fork 零改动；聊天发送和审批 E2E 不受影响。
- **AC-20**：React 19 开发模式下 model 创建/清理成对，切换任务和卸载后没有残留订阅、timer、animation frame 或文件树自定义元素重复注册错误。

## 实施步骤

### 1. 先锁定现有行为

修改前扩充 `desktop-app/src/renderer/src/components/right-workspace/files/FileWorkspace.test.tsx:14-95`：

- 增加根目录加载、展开懒加载、单击预览、双击固定、搜索清空恢复、文件事件刷新和 root 切换的回归测试。
- 增加“旧请求晚于新 workspace 返回”的测试，明确过期结果不得覆盖新 root。
- 保留现有“默认显示、窄面板仍显示、关闭状态持久化”测试。
- 不改 `FilePreview` 逻辑，现有文本、Markdown、图片、PDF、过大文件行为作为非回归边界，位置在 `FileWorkspace.tsx:470-584`。

完成条件：新测试在现有实现上通过，或明确标为本计划要新增的失败测试；不能在没有行为基线时直接删掉 `FileTreeItem`。

### 2. 做依赖兼容性门禁

目标文件：

- `desktop-app/package.json:36-50`
- `desktop-app/package-lock.json`

动作：

1. 从官方包选择一个明确版本并精确锁定，不使用浮动 `latest`。
2. 核对 Apache-2.0 许可证、React peer 范围、浏览器入口和包体积。
3. 做最小渲染试验：React 19 + jsdom + Electron Vite build 能创建、渲染、卸载 `useFileTree`/`FileTree`。
4. 核对 Shadow DOM 内主题 CSS、CSP 和自定义元素重复注册。

门禁失败时：不继续在组件内部散落 `@pierre/trees` 调用；按同一 `WorkspaceFileTreeView` props 接口实现当前自研树回退，并把虚拟滚动/键盘导航列为后续单独工作。

### 3. 建立路径模型适配层

新增 `workspaceFileTreeModel.ts` 及纯函数测试：

- 把 `Record<directoryPath, FileWorkspaceListDirectoryResult>` 转换为稳定、有序、去重的 path-first 数组。
- 目录追加 `/`，文件保留普通相对路径；根目录不生成伪文件项。
- 保留每个路径对应的 `FileWorkspaceEntry`，供双击、菜单、图标和 Git 状态使用。
- 输出 `truncatedDirectories`，让视图显示截断提示。
- 固定排序规则：目录在前、文件在后；同类按当前 locale 行为排序。若要严格保持 main 返回顺序，则测试明确这一选择，避免 renderer/main 各排一次产生跳动。

完成条件：路径转换、去重、symlink、空目录、截断目录、Windows 风格非法输入均有纯单测。

### 4. 抽出文件树控制器并接入第三方 model

从 `FileWorkspace.tsx:50-286` 抽出 `useWorkspaceFileTree`：

- 持有 `rootId`、目录结果缓存、展开集合、请求中的目录、搜索状态、加载和错误状态。
- 每次 `prepareRoot` 创建 generation token；所有异步返回写状态前检查 token。
- 展开新增目录时调用现有 `listDirectory`，完成后一次性更新 paths 并调用 model `resetPaths`。
- model 仅在 workspace/root 生命周期内创建一次；卸载时取消订阅、timer、RAF 并 `cleanUp()`。
- `FileWorkspace` 只接收控制器结果并渲染 `WorkspaceFileTree`，现有 `FilePreview` 和 resize 代码保持原位。

完成条件：删除 `FileTreeItem` 递归渲染后，AC-01 至 AC-06 的组件测试通过。

### 5. 补齐状态恢复和选中项显现

将 `FileTreePreferences` 从 `visible/width` 扩展为版本化状态：

- 新增 `expandedPaths`、`scrollTop`，保留旧存储结构的兼容读取。
- 存储 key 继续按 `workspaceId` 隔离；不要写入通用 `workspace-container:v2`，避免文件树细节污染面板/标签协议。
- model 订阅只在状态真正变化时写 React 状态；scroll 写入做 100-200ms 去抖。
- 当 `tab.relativePath` 改变时加载祖先、选中目标并调用 `scrollToPath`；已在视口内不重复滚动。

完成条件：AC-05、AC-07、AC-08 和 AC-20 通过；旧 localStorage 数据无需迁移脚本即可继续工作。

### 6. 对齐参考项目的搜索切换

保留当前后端搜索，而不是开启 `@pierre/trees` 的仅已加载节点搜索：

- 原因：当前 `files.search` 能找到尚未展开目录中的文件，参考项目同样在输入搜索词后切换到独立结果视图，证据在参考 bundle `:157748-158045`。
- 把 `FileSearchResults` 移到树模块并保留 150ms 防抖。
- 搜索请求也绑定 root generation，旧查询结果不得覆盖新查询。
- 选择结果时加载全部祖先；清空搜索后恢复 model 的展开和滚动状态。

完成条件：AC-09、AC-10 通过，并覆盖快速连续输入、搜索报错、切换工作区三类竞态。

### 7. 接入 Git 状态、图标和右键菜单

Git 状态：

- 在 `GitRepositoryProvider` 已经包围工作区的前提下，复用 `useGitRepository()`，位置见 `desktop-app/src/renderer/src/App.tsx:609-656`。
- 对 ready repository 复用现有 `window.desktopApp.git.getReviewSnapshot` 获取 staged/unstaged 文件集合，映射到 `@pierre/trees` 支持的 git status。
- 合并规则写成纯函数并测试：冲突 > 删除 > 重命名 > 添加/未跟踪 > 修改；不存在于文件系统的 deleted 项不强行创建虚假可打开节点。
- 订阅现有 git change event 并去抖刷新；Git 失败不影响文件树。

图标：

- 第一阶段使用已有 `lucide-react` 图标和有限扩展名映射，避免为了视觉复刻再引入第二个大图标依赖。
- 如果产品要求与参考项目完全一致，再单独评估 `@pierre/vscode-icons`，不与树引擎接入绑定。

右键菜单：

- 复用项目现有菜单组件样式；动作只接收相对路径和 `FileWorkspaceEntry`。
- “使用系统应用打开”继续调用 `workspace.files.openWithSystem`。
- “复制相对路径”使用受用户手势触发的 clipboard API，并提供失败提示。
- 不在本步骤增加“加入聊天上下文”。

完成条件：AC-13、AC-14 及非 Git 降级测试通过。

### 8. 收紧刷新、截断和错误处理

基于现有 `FileWorkspace.tsx:223-249` 和 `registerRightWorkspaceIpc.ts:282-310`：

- 将 fileEvent 按父目录聚合，刷新完成后再统一 `resetPaths`，防止每条事件重建 model。
- 对已移除路径清理选中和上下文菜单目标，但保留其他展开目录。
- 记录每个目录的 `truncated`，在对应目录末尾显示不可点击提示行。
- 根目录读取失败显示现有错误态；单个子目录失败只在该目录内展示重试，不让整棵树消失。
- 不放宽 `FILE_WORKSPACE_MAX_DIRECTORY_ENTRIES`、文件大小限制或路径 schema。

完成条件：AC-11、AC-12、AC-15、AC-18 通过；`FileWorkspaceService.test.ts:44-169` 的安全测试全部保持通过。

### 9. 完成端到端和视觉验收

扩展 `desktop-app/tests/e2e/right-workspace.e2e.ts:22-232`：

- 在真实临时项目中验证根目录、展开目录、预览/固定、搜索、清空搜索和文件变化刷新。
- 验证 Files 标签移动到 bottom 后树仍能操作。
- 增加键盘导航测试：聚焦树后 ArrowDown/ArrowRight/Enter 能打开目标文件。
- 增加宽屏、1100px 窄屏和 bottom panel 三张稳定截图，用于和参考项目的信息层级比对。
- 增加大目录 fixture，断言虚拟化后的 DOM 节点数有上限，而不是把所有路径渲染进 DOM。

完成条件：AC-16、AC-17、AC-19 和全部 E2E 场景通过，无 console error、unhandled rejection 或重复 custom element 注册错误。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `@pierre/trees` 仍处于 beta 或 React 19 兼容性不稳定 | 构建或卸载时报错 | 先做依赖门禁并精确锁版本；所有调用隔离在一个适配层 |
| Shadow DOM 让 Tailwind 类和主题变量失效 | 视觉不一致 | 只通过 `unsafeCSS`/CSS variables 注入主题；建立暗色/亮色组件测试和截图 |
| 路径模型要求目录带 `/`，当前 API 不带 | 展开/选中错位 | 集中在纯函数适配器转换，禁止各组件自行拼接 |
| root/search/expand 异步结果乱序 | 切换任务后显示旧文件 | generation token + 每目录请求去重 + 取消 timer/RAF |
| Git snapshot 读取太频繁 | 大仓库卡顿 | 复用现有 GitManager 缓存和 change event；去抖且 Git 失败可降级 |
| 文件变化事件粒度不稳定 | 刷新过多或遗漏 | 按父目录聚合；无法确定路径时只刷新已加载目录，不重新扫描全仓库 |
| expandedPaths 持久化无限增长 | localStorage 膨胀 | 500 条上限、路径长度校验、损坏数据回退 |
| 单目录 500 项上限被误解为完整列表 | 用户找不到文件 | 明确显示截断提示；搜索仍可跨目录查找 |
| 参考项目是无 source map 的发布包 | 细节判断可能偏差 | 以可观察行为和官方 `@pierre/trees` API 为准，不依赖混淆变量名；参考边界见 `_analysis/README.md:3-19` |
| 文件树与 composer 直接耦合 | 破坏聊天状态边界 | 本轮不做“加入聊天上下文”；后续通过显式 renderer callback 设计 |

## 验证步骤

按由小到大的顺序执行：

1. 纯模型和持久化测试：
   - `npm --prefix desktop-app test -- workspaceFileTreeModel workspaceFileTreePersistence`
2. 文件树组件测试：
   - `npm --prefix desktop-app test -- FileWorkspace WorkspaceFileTree`
3. Main 文件安全回归：
   - `npm --prefix desktop-app test -- FileWorkspaceService registerRightWorkspaceIpc`
4. 通用工作区回归：
   - `npm --prefix desktop-app test -- WorkspaceContentRegistry WorkspacePanelController workspaceReducer workspacePersistence`
5. 静态检查：
   - `npm --prefix desktop-app run lint`
   - `npm --prefix desktop-app run typecheck`
6. 目标 E2E：
   - `npm --prefix desktop-app run test:e2e -- tests/e2e/right-workspace.e2e.ts --reporter=line`
7. 聊天非回归烟测：
   - `npm --prefix desktop-app run test:e2e -- tests/e2e/chat.e2e.ts --reporter=line`

如果完整 `npm test` 因 provider 安装或网络不可用不能执行，必须记录原因，并至少完成已安装依赖条件下的 renderer/main 目标测试、typecheck 和构建；不得把未运行写成通过。

## 开发顺序与提交建议

1. `test(files): lock current workspace tree behavior`
2. `build(files): add pinned pierre trees dependency`
3. `refactor(files): extract file tree model and controller`
4. `feat(files): render virtualized workspace tree`
5. `feat(files): restore tree state and reveal active file`
6. `feat(files): align search and live refresh behavior`
7. `feat(files): add git decorations and file actions`
8. `test(files): cover workspace tree parity end to end`

每个提交都必须能通过其直接相关的测试；不把依赖引入、700 行组件重构和视觉调整压在同一个提交里。

## 完成定义

满足以下条件才算完成：

- AC-01 至 AC-20 全部有自动化测试或明确的 E2E/截图证据。
- 现有文件预览、预览标签替换、固定标签和 right/bottom 移动行为无回归。
- lint、typecheck、目标单测和 right-workspace E2E 新鲜通过。
- `codex/codex-rs/app-server/` 和 provider fork 没有文件改动。
- 第三方依赖版本和许可证被记录，包锁定可重复安装。
- 没有未清理的订阅、timer、RAF、watcher 或 model 实例。
- 参考项目无法从发布包确认的细节被列为已知限制，而不是用猜测补齐。
