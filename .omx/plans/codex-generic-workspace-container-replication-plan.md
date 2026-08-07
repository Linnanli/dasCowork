# Codex 通用工作区内容容器复刻计划

> 计划模式：Direct。本文只定义目标、代码边界、实施步骤与验收方式，不修改业务代码。
>
> 基线说明：本计划以当前工作区中已经存在的 `right-workspace` staged 实现为起点；不覆盖 `.omx/plans/codex-right-workspace-implementation-plan.md`，而是规划如何把现有“右侧专用工作区”演进为参考项目的“右侧 + 底部共用通用内容容器”。

## 1. 结论先行

采用“行为等价、干净重写”的复刻方式，不复制参考项目的混淆 bundle，也不照搬其私有模块：

1. 在 renderer 新建与位置无关的通用 tab/controller 层，统一管理 `right`、`bottom` 两个面板。
2. 保留现有 Files、Terminal、Browser、Review 内容组件和 main/preload/shared 能力，只为它们增加统一的 descriptor、生命周期和移动适配器。
3. 先让右侧面板无回归地切换到新控制器，再补预览/固定、MRU、批量关闭、焦点和快捷键，最后交付底部面板与跨面板拖动。
4. 资源句柄继续只存在于 main 或 renderer 的临时 runtime 状态；localStorage 只保存可恢复且不敏感的 tab 描述。
5. 不修改 `codex/codex-rs/app-server/`，不改变聊天、thread/turn、审批或模型调用链。
6. 不新增拖拽/docking 依赖；优先复用项目已有 React、Radix、原生 pointer/drag 事件和现有拖动实现模式。

这条路线复刻的是参考项目的容器语义和用户可见行为，不复刻其压缩后的变量命名、内部 action registry 或私有 browser 包。

### 1.1 UI 复用硬约束

本次实施是“复用现有 UI，补齐参考项目交互”，不是重新设计工作区外观。以下规则属于硬约束，除非用户另行批准，不得在实施中偏离：

1. 当前 staged `right-workspace` 是唯一视觉基线。必须复用现有 `RightWorkspaceShell`、`RightWorkspaceTabBar`、`WorkspaceLauncher` 以及 Files、Terminal、Browser、Review 内容组件的结构和样式；通用化时优先改名、抽参或包薄适配层，不复制一套外观相近的新组件。
2. 沿用当前项目的 Tailwind 语义 token、shadcn/Radix 组件、Lucide 图标、字体、颜色、边框、圆角、阴影、hover、focus、disabled 和动效规范；不得从参考 bundle 复制 CSS、颜色值、字体或私有设计 token。
3. 保持现有右侧面板的视觉尺寸和响应式行为，包括 56px tab bar、90–160px tab 宽度、标题渐隐、关闭按钮、新建菜单、面板宽度/最大化/收起动画，以及 Files/Terminal/Browser/Review 已有工具栏和内容布局。
4. 参考项目只决定新增行为：preview/pin、MRU、批量关闭、overflow 提示、焦点、快捷键、拖动和双面板；新增视觉只能服务这些行为，且必须使用现有 token 和组件表达。
5. bottom panel 必须复用与 right panel 相同的 `WorkspacePanelShell`、`WorkspaceTabStrip`、菜单、按钮和状态样式，只允许因横向/纵向布局方向不同而调整尺寸与 resize handle；不得形成第二套底部栏视觉语言。
6. 禁止新增全局设计系统、独立 tab 样式表、docking UI 框架或仅为模仿参考项目外观而增加依赖。确需新增的 drag overlay、preview 斜体、overflow fade 和 bottom resize handle 必须保持最小样式差异。
7. 现有右侧工作区截图是回归基线。除计划明确新增的状态和控件外，同一 viewport、主题和内容下，布局层级、间距、尺寸、颜色和控件位置不得发生肉眼可见变化。
8. 如果通用架构与原 UI 发生冲突，优先调整 controller、adapter 或 props 接口来适配原 UI；不得以“架构更通用”为理由改掉已交付的视觉和交互细节。

## 2. 范围与默认产品决策

### 2.1 本期包含

- 通用 tab descriptor 与内容注册表。
- 右侧、底部两个独立面板实例，共用同一套控制器。
- 稳定 ID 去重、可替换 preview、pin、插入位置、激活历史和 MRU 回退。
- 单项关闭、关闭其他、关闭右侧、关闭当前面板活动 tab。
- 同面板重排、右侧与底部之间移动；移动时不重建 terminal/browser runtime。
- panel-aware 焦点、相邻 tab 循环切换、关闭快捷键和可访问性。
- 版本化持久化与旧 `right-workspace:*` 状态迁移。
- Files、Terminal、Browser、Review 四类现有内容迁移和资源生命周期统一。
- 单元、组件、集成、Electron E2E 和视觉截图回归。

### 2.2 默认交互决策

- 每个面板最多存在一个可替换 preview tab；preview 被 pin 后不再被替换。
- 文件树单击打开 preview；文件树双击、tab 双击、在文件预览正文中产生实际交互时 pin。
- 文件树、搜索结果、tab 关闭按钮和菜单标记为 preview-pin-exempt，避免“选择下一个文件”误把当前 preview 固定。
- Review、Terminal、Browser 以及 `+` 菜单主动创建的 tab 默认 pinned；首期只有文件内容使用 preview。
- 关闭活动 tab 后优先回到该面板最近访问的 tab；历史不可用时才选左邻，再选右邻。
- 关闭最后一个 tab 会收起对应面板；用户再次通过工作区开关打开时显示 launcher。
- 关闭正在运行的 Terminal 必须经过一次确认；批量关闭先汇总受影响的运行中 Terminal，只弹一次确认。Browser、File、Review 不需要关闭确认。
- 拖动只改变 tab 所属面板和顺序，不等同于关闭，因此不得触发 PTY kill 或 Browser view destroy。
- 本期交付可见 bottom panel 和 right ↔ bottom 拖动；不是只在数据模型中预留。

### 2.3 本期不包含

- 不新增 Artifact、Timeline、MCP、Sandbox 等新内容类型，只为它们保留注册接口。
- 不实现参考项目的 `windows.tabs.open` 模型工具或跨窗口 app action；本期提供 renderer 内部的类型化 `openWorkspaceTarget()`，外部工具桥另立计划。
- 不引入任意 docking 框架，不支持自由拆分成多列、多行或浮动窗口。
- 不持久化终端 scrollback、浏览器 Cookie/完整历史、文件内容、绝对路径、凭据或原生资源句柄。
- 不改变 Files、Terminal、Browser、Git Review 的 main 服务安全规则。

## 3. 现状与参考能力差距

本节引用别名：

- `[C-STATE]`：`desktop-app/src/renderer/src/components/right-workspace/workspaceState.ts`
- `[C-PROVIDER]`：`desktop-app/src/renderer/src/components/right-workspace/RightWorkspaceProvider.tsx`
- `[C-TABS]`：`desktop-app/src/renderer/src/components/right-workspace/RightWorkspaceTabBar.tsx`
- `[C-SHELL]`：`desktop-app/src/renderer/src/components/right-workspace/RightWorkspaceShell.tsx`
- `[C-APP]`：`desktop-app/src/renderer/src/App.tsx`
- `[C-SHARED]`：`desktop-app/src/shared/rightWorkspaceApi.ts`
- `[C-MAIN]`：`desktop-app/src/main/rightWorkspace/registerRightWorkspaceIpc.ts`
- `[C-E2E]`：`desktop-app/tests/e2e/right-workspace.e2e.ts`
- `[R-CONTROLLER]`：`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~artifact-tab-content.electron~app-main~pull-request-code-review~new-thread-pane~f023c15b-DuVw_8by.js`
- `[R-TABS]`：`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~artifact-tab-content.electron~app-main~new-thread-panel-page~onboarding-page~pr~el73lghr-Dt1yA99A.js`
- `[R-OPEN]`：`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-CrA1-JEm.js`
- `[R-SHORTCUTS]`：`reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~page-DRgkI91I.js`

### 3.1 当前项目已经具备

| 能力 | 当前证据 | 结论 |
| --- | --- | --- |
| 四类内容 | `[C-STATE]:3-34` 已定义 Review/File/Terminal/Browser | 内容能力不用重做 |
| 单右侧面板状态 | `[C-STATE]:42-48` 管理 open/maximized/width/tabs/active | 需要抽成 panel-neutral 状态 |
| 基础打开和文件去重 | `[C-STATE]:116-149` | 可迁移为统一 open target 规则 |
| 基础关闭和重排 | `[C-STATE]:154-163`、`:194-199` | 缺 MRU、guard、批量关闭、跨面板移动 |
| localStorage | `[C-STATE]:205-280` | 缺 schema version、preview/panel/history 迁移 |
| Provider 命令入口 | `[C-PROVIDER]:15-31`、`:43-68` | 需要替换成通用 controller API |
| tablist 与键盘导航 | `[C-TABS]:106-199` | 缺 pin、右键菜单、中键、自动滚动和拖动 |
| 活动内容渲染 | `[C-SHELL]:132-155` | 需要通用 panel shell 和内容 registry |
| 四类内容接线 | `[C-APP]:802-872` | 当前类型 switch 应迁入 registry adapter |
| Electron 资源边界 | `[C-SHARED]:71-108`、`[C-MAIN]:98-205` | 保留 API，容器不绕过 preload |
| 会话/窗口清理 | `[C-APP]:809-815`、`[C-MAIN]:207-279` | 需要与 tab close/move 状态机对齐 |
| E2E 基线 | `[C-E2E]:22-83` | 已覆盖四内容打开，需扩充容器行为 |

### 3.2 参考项目需要复刻的行为

| 参考行为 | 参考证据 | 本项目差距 |
| --- | --- | --- |
| 同一工厂创建 right/bottom 控制器 | `[R-CONTROLLER]:33009-33349`、`:33457-33458` | 当前控制器写死 right |
| rich descriptor 与 per-tab state | `[R-CONTROLLER]:33034-33093`、`:33326-33346` | 当前 union 只含内容数据和少量 runtime ID |
| 同 ID 更新、不重复插入 | `[R-CONTROLLER]:33111-33123` | 当前只实现部分类型去重 |
| preview 替换与复用位置 | `[R-CONTROLLER]:33111-33133` | 当前每个不同文件都会永久增加 tab |
| pin 与双击固定 | `[R-CONTROLLER]:33241-33243`、`[R-TABS]:7882-7890` | 当前无 preview/pin |
| 关闭前 veto、关闭清理、MRU 回退 | `[R-CONTROLLER]:33222-33239`、`:33272-33291` | 当前只选左邻且 effect 在 App 外置 |
| 关闭其他/关闭右侧 | `[R-TABS]:7335-7375` | 当前无右键批量关闭 |
| 面板内与跨面板移动 | `[R-CONTROLLER]:33166-33220`、`[R-TABS]:10905-11047` | 当前 reducer 有 reorder，但 UI 无拖动且无 bottom |
| panel-aware 相邻切换与焦点 | `[R-SHORTCUTS]:9623-9648` | 当前只有 tab 按钮获得焦点时响应方向键 |
| overflow、active scroll、preview 样式 | `[R-TABS]:8072-8464`、`:7487-7492` | 当前只有横向滚动和标题 fade |
| 类型化打开目标和 placement | `[R-OPEN]:110036-110053` | 当前是三个专用 Provider 方法，没有统一 target |

实施时只提炼上述参考行为，不依赖这些 bundle。

## 4. 目标架构

### 4.1 分层

```text
调用方（文件树 / Review / Launcher / 后续 artifact）
       │ openWorkspaceTarget(target, options)
       ▼
WorkspaceContainerProvider
       ├── right: WorkspacePanelController
       ├── bottom: WorkspacePanelController
       ├── lastFocusedPanelId
       ├── persistence/migration
       └── drag + close-guard coordinator
                │
                ▼
WorkspaceContentRegistry
       ├── file adapter    ── FileWorkspace
       ├── terminal adapter ─ TerminalWorkspace
       ├── browser adapter ─ BrowserWorkspace
       └── review adapter  ── ReviewWorkspace
                │
                ▼
现有 window.desktopApp.workspace → preload → main services
```

### 4.2 状态必须分成三类

1. 可持久化 tab 记录
   - `id`、`kind`、`title`、`props`、`panelId`、`isPreview`、`isClosable`。
   - 只包含 JSON-safe 且不敏感的数据。
2. panel/controller 状态
   - 有序 tab IDs、activeTabId、activationHistory、open、size、maximized。
   - right 与 bottom 独立维护，根状态只保存 lastFocusedPanelId 和 drag/close UI 状态。
3. 临时 runtime/tab state
   - Terminal session ID、Browser view ID、文件树展开/搜索/滚动、外部焦点、挂起状态。
   - 移动 panel 时保留；应用重启时按 registry 规则恢复或降级，不原样写入持久化记录。

### 4.3 Descriptor 与 registry 责任

不要把 React Component、函数或 Electron 句柄直接写入 reducer/localStorage。推荐用 `kind` 查 registry：

- `createDescriptor(target, options)`：生成稳定 ID、标题、props、preview/closable 默认值。
- `render(context)`：渲染现有内容组件。
- `serialize/restore`：只处理该类型允许持久化的 props。
- `onActivate/onDeactivate`：处理 Browser show/hide、Terminal fit/focus 等。
- `onBeforeClose`：运行中 Terminal 的确认；允许 veto。
- `onClose`：kill Terminal、destroy Browser；File/Review 清理订阅状态。
- `onMove`：更新 panel 相关 props，但不得重建资源 ID。
- `pinOnInteraction` 与 `previewPinExempt`：控制 preview 固定规则。

### 4.4 命令层与 reducer 分工

- reducer 保持纯函数，只负责合法状态转换。
- controller 命令负责异步 guard 和副作用，顺序固定为：
  1. 解析目标 descriptor；
  2. 执行去重/preview replacement 预检查；
  3. 对将被替换或关闭的 tab 执行 `onBeforeClose`；
  4. reducer 提交状态；
  5. 执行 `onClose/onActivate/onDeactivate`；
  6. 恢复 panel 与内容焦点。
- `moveTab` 走独立事务：source yank → destination receive → adapter onMove → activate；不能复用 close 命令。

### 4.5 文件身份与 preview 规则

- `Files` launcher 使用稳定单例 ID，例如 `files:explorer`。
- 文件内容 ID 使用 main 返回的规范相对路径，例如 `file:src/example.ts`；文件树和搜索结果当前已经来自 main 校验后的 `FileWorkspaceEntry.path`，见 `FileWorkspaceService.ts:54-86`、`:215-235`。
- 单击文件调用 `openWorkspaceTarget({ type: 'file', path }, { mode: 'preview' })`。
- 双击文件调用相同 target，但 `mode: 'pinned'`。
- 如果同路径已存在，直接激活并更新，不新建；如果它已经 pinned，不得降级为 preview。
- 打开新的 preview 时，旧 preview 必须先走完整 close pipeline，防止未来可预览资源泄漏。

### 4.6 资源所有权

- renderer descriptor 只保存资源 ID，不持有 PTY、WebContentsView、watcher 或绝对路径。
- main 继续按 webContents owner 管理服务，见 `registerRightWorkspaceIpc.ts:59-73`、`:84-95`。
- panel collapse、tab deactivate、popover/drag overlay：Browser hide，不 destroy；Terminal 保持运行。
- tab close：Terminal kill、Browser destroy。
- panel move：复用相同 runtime ID，只重新计算 Browser bounds、重新 fit Terminal。
- workspace dispose、renderer reload/crash、window close：沿用 main 的最终兜底清理，见 `registerRightWorkspaceIpc.ts:207-279`。

## 5. 可测试验收标准

### 5.1 状态与打开规则

- [ ] `WorkspacePanelController` 能用同一套测试分别实例化 `right` 和 `bottom`，不存在 `RightWorkspace*` 类型依赖。
- [ ] 打开相同稳定 ID 两次后，目标面板仍只有一个 tab，第二次更新 descriptor 并激活原 tab。
- [ ] 在同一面板依次 preview 文件 A、B 后，只有 B 保持 preview，A 已从 tab 列表和 runtime state 移除。
- [ ] pin A 后 preview B，A 与 B 同时存在，且再次 preview A 不会把 A 降级。
- [ ] 从文件树单击 A、再单击 B，不增加第二个 preview；双击 A 后再单击 B，A 保留。
- [ ] 新建 Review、Terminal、Browser 默认 `isPreview=false`。
- [ ] 新 tab 默认插入活动 tab 后；显式 `insertAfterTabId` 按目标位置插入。

### 5.2 激活、关闭和历史

- [ ] 激活顺序 A→B→C 后关闭 C，活动 tab 为 B；再关闭 B 后为 A。
- [ ] 重排 tab 不改变 MRU 语义；历史中不存在已关闭或已移动到其他 panel 的幽灵 ID。
- [ ] `onBeforeClose` 返回 false 时，单项关闭、preview replacement、关闭其他和关闭右侧均不改变状态、不执行 `onClose`。
- [ ] 关闭其他只关闭可关闭且 guard 通过的 tab；关闭右侧只处理当前顺序中目标右边的 tab。
- [ ] 批量关闭命中一个或多个运行中 Terminal 时只显示一次确认；取消后整个批次不做部分关闭。
- [ ] 关闭最后一个 tab 后面板 `open=false`；重新打开面板显示 launcher。
- [ ] Browser destroy、Terminal kill 各执行一次；重复 close/dispose 不抛错、不重复操作资源。

### 5.3 拖动与双面板

- [ ] pointer 移动未超过 6px 时只算点击，不触发重排。
- [ ] 同 panel 拖动实时预览顺序；取消后恢复原顺序和原活动 tab。
- [ ] right → bottom 与 bottom → right 移动后 tab ID、tab state、Terminal session ID、Browser view ID 均保持不变。
- [ ] 目标 panel 已有 preview 且移入另一个 preview 时，旧 preview 先通过 close pipeline 释放。
- [ ] 目标 panel 已有相同 tab ID 时拒绝移动并恢复源 panel，不产生重复 tab。
- [ ] 移动完成后目标 panel 打开、tab 激活、标题滚动可见，Browser bounds 与 Terminal fit 在一帧内重新计算。

### 5.4 焦点、快捷键与可访问性

- [ ] tab strip 保持 `tablist/tab/tabpanel`、`aria-selected`、roving tabindex、Arrow/Home/End 行为。
- [ ] 相邻 tab 快捷键只作用于拥有焦点或最近获得外部焦点的 panel，并在首尾循环。
- [ ] 输入框、CodeMirror、xterm 接管的文字输入快捷键不误触 app 级新建/关闭命令。
- [ ] Browser WebContentsView 获焦时，panel identity 仍可被记录；返回 tab strip/content 的焦点路径可用。
- [ ] 中键只关闭可关闭 tab；tab 双击只 pin preview；右键菜单键盘可达。
- [ ] 活动 tab 在横向溢出时自动滚动可见，左右遮挡区显示渐变提示；preview 标题有可区分但不只依赖颜色的样式。

### 5.5 持久化与兼容

- [ ] 新 storage payload 带显式 schema version；未知版本安全回退，不删除其他项目状态。
- [ ] 旧 `right-workspace:<scope>` 数据可一次性迁移到新结构，旧 tab 均按 pinned/right 解释，原 active、width、open、maximized 保留。
- [ ] runtime ID、终端输出、浏览历史、文件内容和绝对路径不进入 localStorage。
- [ ] 持久化中引用不存在文件或无法恢复资源时显示可关闭的恢复失败内容，不导致 Provider 崩溃。
- [ ] draft conversation 获得 threadId 后，workspace scope、tab 顺序和运行中资源不因 key 改变而重建；切换到另一个 conversation 才 dispose。

### 5.6 架构边界和回归

- [ ] 实现 diff 不包含 `codex/codex-rs/app-server/`。
- [ ] renderer 仍只通过 `window.desktopApp.workspace` 访问系统能力。
- [ ] 现有四类内容、右侧宽度/最大化/收起、Browser 安全和 main 资源清理测试全部通过。
- [ ] Electron E2E 覆盖真实 Files preview、Terminal、Browser、Review、right/bottom 和资源关闭链路。
- [ ] 1440×900 与 1100×800 两组截图中，chat、right、bottom 不溢出，原生 Browser view 不遮住菜单或错误 panel。

### 5.7 UI 复用验收

- [ ] right panel 通用化前后的同 viewport 截图，除新增 preview/overflow/drag 状态外，tab bar、launcher、四类内容工具栏、间距、颜色、圆角和控件位置无肉眼可见差异。
- [ ] bottom panel 与 right panel 使用同一个 `WorkspacePanelShell` 和 `WorkspaceTabStrip` 实现；测试中不存在按 panelId 复制整套 JSX/CSS class 的分支。
- [ ] 新增 UI 只使用现有 Tailwind 语义 token、shadcn/Radix 和 Lucide；没有从参考 bundle 复制 CSS 或新增独立设计 token。
- [ ] `desktop-app/src/renderer/src/assets/styles/globals.css` 不因本功能新增另一套工作区主题；如确需增加通用状态 token，必须同时被 right/bottom 复用并有深浅主题截图。
- [ ] `desktop-app/package.json` 不因 UI 复刻新增 docking、tab-bar 或设计系统依赖。
- [ ] Files、Terminal、Browser、Review 内容组件的视觉结构保持原样；adapter 只负责容器协议、runtime 和生命周期翻译。

## 6. 实施步骤

### 步骤 0：锁定当前 staged 基线

目标：在重构前把现有行为和资源清理变成不可回退的测试基线。

涉及文件：

- `desktop-app/src/renderer/src/components/right-workspace/workspaceState.test.ts`
- `desktop-app/src/renderer/src/components/right-workspace/RightWorkspaceTabBar.test.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/RightWorkspaceShell.test.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/terminal/TerminalWorkspace.test.tsx`（新增）
- `desktop-app/tests/e2e/right-workspace.e2e.ts`

工作项：

1. 补齐现有打开/关闭/恢复、Terminal renderer、Browser hide/show、conversation dispose 测试。
2. 为 `onTabClosed` 当前 kill/destroy 行为添加调用次数断言，基线位置见 `App.tsx:826-839`。
3. 保存当前右侧工作区 desktop/narrow 截图，作为迁移右侧 shell 的视觉基线。

完成门槛：新增基线测试在未引入通用 controller 前通过；失败用例不能靠放宽断言解决。

### 步骤 1：建立纯 TypeScript 通用领域模型

新增目录建议：`desktop-app/src/renderer/src/components/workspace-container/`。

新增文件建议：

- `workspaceTypes.ts`
- `workspaceReducer.ts`
- `workspaceReducer.test.ts`
- `workspacePersistence.ts`
- `workspacePersistence.test.ts`

工作项：

1. 定义 `WorkspacePanelId = 'right' | 'bottom'`、JSON-safe tab record、panel state、root layout state、runtime tab state。
2. 实现 open/update/dedupe、preview replacement、pin、activate、MRU、close commit、reorder、yank/receive、panel open/size/maximized 等纯状态动作。
3. reducer 不导入 React、Electron API 或具体内容组件。
4. 用同一组 table-driven tests 对 right/bottom 两个 panel 运行参考行为用例。

完成门槛：第 5.1、5.2 中不涉及异步 guard 的状态标准全部由纯单测证明。

### 步骤 2：建立内容 registry 和 descriptor builder

新增文件建议：

- `WorkspaceContentRegistry.ts`
- `workspaceOpenTargets.ts`
- `workspaceOpenTargets.test.ts`
- `adapters/fileWorkspaceAdapter.tsx`
- `adapters/terminalWorkspaceAdapter.tsx`
- `adapters/browserWorkspaceAdapter.tsx`
- `adapters/reviewWorkspaceAdapter.tsx`

修改：

- `desktop-app/src/renderer/src/App.tsx:802-872`
- `desktop-app/src/renderer/src/components/right-workspace/files/FileWorkspace.tsx:29-36`
- `desktop-app/src/renderer/src/components/right-workspace/terminal/TerminalWorkspace.tsx:16-28`
- `desktop-app/src/renderer/src/components/right-workspace/browser/BrowserWorkspace.tsx:20-26`

工作项：

1. 把 App 中按 tab type 的 render switch 迁入 registry adapter。
2. 为四类内容定义稳定 ID、默认 placement、preview/pinned、persist/restore、activate/deactivate/close/move 行为。
3. 保留现有组件和 IPC API；adapter 只做容器协议与内容 props 的翻译。
4. 建立统一 `WorkspaceOpenTarget`：`file/browser/terminal/review`，调用方不再直接构造 tab union。

完成门槛：新增一种测试用 fake content 只需注册 adapter 即可打开、激活、移动、关闭，不修改 controller 或 panel UI。

### 步骤 3：实现命令控制器、guard 和副作用事务

新增文件建议：

- `WorkspacePanelController.ts`
- `WorkspaceContainerProvider.tsx`
- `WorkspaceCloseGuardDialog.tsx`
- `WorkspacePanelController.test.tsx`

工作项：

1. 在 reducer 外实现 async open/close/bulk-close/move 命令管线。
2. 所有关闭来源统一经过 guard；批量关闭采用全有或全无事务，不出现关闭一半后取消。
3. 把现有 `App.tsx:826-839` 的 kill/destroy 外置回调迁入 content adapter `onClose`。
4. 保留 main 的 workspace/window dispose 作为最终兜底，不让 renderer 和 main 各自猜测资源状态。
5. 暂时提供 `RightWorkspaceProvider` 兼容 facade，让现有调用方可逐个迁移，避免一次性大爆炸修改。

完成门槛：单项关闭、preview replacement、批量关闭和移动的 effect 顺序均有可观测测试；同一资源最多清理一次。

### 步骤 4：版本化持久化和会话身份迁移

修改：

- `desktop-app/src/renderer/src/components/right-workspace/workspaceState.ts:80-100`
- `desktop-app/src/renderer/src/components/right-workspace/RightWorkspaceProvider.tsx:36-49`
- `desktop-app/src/renderer/src/App.tsx:599-602`
- `desktop-app/src/renderer/src/App.tsx:802-815`

工作项：

1. 引入 `workspace-container:v2:<conversationScope>`，payload 带版本和 right/bottom panel。
2. 一次性读取并迁移旧 `right-workspace:<scope>`；迁移成功后保留旧 key 一个发布周期，避免无法回滚。
3. 将 UI 持久化 scope 与 runtime workspace ID 都改为基于稳定 conversation identity；threadId 只作为当前 target 参数，不再进入 React Provider key。
4. 明确恢复策略：File/Review 恢复描述；Terminal/Browser 恢复为未启动占位，不能复用已失效的原生句柄。

完成门槛：旧 payload、损坏 JSON、未知版本、draft→thread、切 conversation 五组测试通过。

### 步骤 5：用通用 panel shell 替换右侧专用状态层

新增/修改：

- 新增 `WorkspacePanelShell.tsx`
- 新增 `WorkspaceTabStrip.tsx`
- 修改 `RightWorkspaceShell.tsx:24-161` 为薄布局适配器或删除后由通用 shell 取代
- 修改 `RightWorkspaceTabBar.tsx:106-338` 为通用 tab strip 适配器或删除
- 修改 `WorkspaceLauncher.tsx`
- 修改 `App.tsx:599-646`、`:817-872`

工作项：

1. 首先只挂载 `panelId='right'`，保持现有宽度、最大化、收起、launcher 和四类内容行为。
2. 内容组件通过 `WorkspaceTabRenderContext` 获取 tabState、setTabState、panelId、panel size/maximized，不再调用 `useRightWorkspace()`。
3. BrowserWorkspace 将 `[data-slot="right-workspace-shell"]` 查询改为通用 panel root，当前硬编码见 `BrowserWorkspace.tsx:69-79`、`:225-242`。
4. FileWorkspace 的响应式判断改读 panel context，当前 right-only 依赖见 `FileWorkspace.tsx:36-38`、`:224`。
5. UI 只允许从现有组件抽取通用 props 和共享结构；不得在 `workspace-container` 中重写一套 tab、launcher 或四类内容外观。

完成门槛：现有 `right-workspace.e2e.ts:22-83` 与右侧视觉截图无功能或视觉回退，并通过第 5.7 节 UI 复用验收后，再进入新增行为阶段。

### 步骤 6：交付 preview、pin 和文件树复用体验

修改：

- `FileWorkspace.tsx:211-223`
- `WorkspaceTabStrip.tsx`
- `workspaceOpenTargets.ts`
- 对应 reducer/controller/component tests

工作项：

1. 文件树和搜索结果区分单击与双击，分别发送 preview/pinned open。
2. tab 标题对 preview 使用斜体及可访问标签；双击 preview tab 执行 pin。
3. 在 active preview 内容根捕获 pointer/keyboard interaction 并 pin；导航树、搜索、关闭和菜单加 `data-tab-preview-pin-exempt`。
4. pin 后持久化；preview replacement 使用旧 preview 的可视位置，避免 tab 条跳动。

完成门槛：文件 A/B preview、双击 pin、正文交互 pin、exempt 不误 pin 全部有组件测试和 E2E。

### 步骤 7：补齐 tab strip 完整桌面交互

工作项：

1. 加中键关闭、右键 Close/Close others/Close to right、禁用状态和 content adapter 自定义菜单项。
2. 活动 tab 自动滚动可见；用 IntersectionObserver 渲染左右 overflow fade。
3. 保留 90–160px 宽度和标题 fade 基线，当前断言见 `RightWorkspaceTabBar.test.tsx:113-137`。
4. 加 suspended/loading/error/retry 状态槽，内容错误不能让整个 workspace Provider 崩溃。
5. 所有菜单打开时通知 Browser adapter hide 原生 view；关闭菜单后仅恢复当前活动 Browser。

完成门槛：鼠标、键盘、菜单、溢出和 error boundary 有组件测试；Browser view 不穿透 popover。

### 步骤 8：建立 panel-aware 焦点和快捷键

新增文件建议：

- `workspaceFocusManager.ts`
- `useWorkspaceShortcuts.ts`
- `workspaceFocusManager.test.ts`

工作项：

1. 记录 lastFocusedPanelId、tab DOM focus 和 adapter 上报的 external focus。
2. 实现 next/previous、close active、open Terminal/Browser/Review 等命令，但先做快捷键冲突表再绑定。
3. 输入框、CodeMirror、xterm 的文本快捷键优先；Browser WebContentsView 外部焦点由 main 事件或显式 activate/focus 回报关联 panel。
4. 快捷键 UI 只显示真正注册的组合；修复当前 `⌘ R/T/B` 仅展示未注册的问题，现状见 `RightWorkspaceTabBar.tsx:72-76`。

完成门槛：chat composer、tab strip、file tree、CodeMirror、xterm、Browser 六种焦点来源的命令矩阵测试通过。

### 步骤 9：增加 bottom panel 布局

新增文件建议：

- `WorkspaceLayout.tsx`
- `BottomWorkspaceResizeHandle.tsx`
- `WorkspaceLayout.test.tsx`

修改：

- `App.tsx:584-647`
- `WorkspaceHeaderActions` 相关布局测试
- `workspaceState`/persistence 的 panel size 配置

工作项：

1. 把主区改成“chat+right 横向行”与 bottom 纵向堆叠，right/bottom 都使用 `WorkspacePanelShell`。
2. bottom 默认高度、最小高度、最大比例与键盘 resize 独立持久化；窗口变窄/变矮时保证 chat 最小可用尺寸。
3. bottom 为空或关闭时不占布局；最大化规则明确为一次只允许一个 panel 最大化。
4. Browser/Terminal/File/Review 在 bottom 中使用同一个 registry，无类型白名单分叉。

完成门槛：right-only、bottom-only、双面板、最大化、resize 和窄窗口布局测试通过。

### 步骤 10：实现同栏重排与跨栏拖动

新增文件建议：

- `WorkspaceTabDragCoordinator.tsx`
- `workspaceDragGeometry.ts`
- `workspaceDragGeometry.test.ts`

工作项：

1. 使用 pointer threshold 6px 区分点击和拖动；拖动 overlay 只复制 tab 外观，不复制内容组件。
2. 同 panel drag-over 只更新预览顺序；drop 提交，cancel 恢复原顺序/active。
3. 跨 panel drop 调用 controller move 事务，支持 before/after 插入位置。
4. 移动 Browser 时先 hide，drop 后重新 setBounds/show；移动 Terminal 后 fit，不 kill/recreate。
5. 复用现有 queued follow-up 原生拖动测试思路，参考 `QueuedFollowUpList.tsx:54`、`:197-203`，但容器用 pointer coordinator 完成 threshold 和跨面板 preview。

完成门槛：第 5.3 全部自动化通过；E2E 断言移动前后 terminal session/browser view ID 不变。

### 步骤 11：收口兼容层、文档和扩展接口

修改：

- `desktop-app/src/renderer/src/components/right-workspace/index.ts`
- `desktop-app/src/renderer/src/components/right-workspace/RightWorkspaceProvider.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/workspaceState.ts`
- `docs/codex-right-workspace.md:1-53`

工作项：

1. 所有调用方迁移完成后删除或降为 re-export 的 right-only reducer/provider，避免两套真相源。
2. 文档改名或新增 `docs/workspace-content-container.md`，记录 descriptor、registry、panel、生命周期、持久化和新增内容类型流程。
3. 保留 `desktopApp.workspace` 和 main `rightWorkspace` 服务命名作为兼容 API；不要为了 UI 通用化做无价值的跨进程大改名。
4. 在文档明确后续 Artifact/Timeline/MCP/Sandbox 只需注册 adapter，不得直接修改 controller 分支。

完成门槛：仓库中不存在仍参与运行的第二套 right-only tab 状态；新增 fake content 示例测试不改核心文件。

## 7. 验证步骤

按风险从小到大执行：

1. 纯状态与持久化：

   ```bash
   npm --prefix desktop-app exec -- vitest run src/renderer/src/components/workspace-container
   ```

2. 现有与迁移后的 renderer：

   ```bash
   npm --prefix desktop-app exec -- vitest run src/renderer/src/components/right-workspace
   ```

3. Main/shared/preload 资源回归：

   ```bash
   npm --prefix desktop-app exec -- vitest run src/main/rightWorkspace src/shared
   ```

4. 类型、lint、构建：

   ```bash
   npm --prefix desktop-app run typecheck
   npm --prefix desktop-app run lint
   npm --prefix desktop-app run build
   ```

5. Electron E2E：

   ```bash
   npm --prefix desktop-app run test:e2e -- tests/e2e/right-workspace.e2e.ts --reporter=line
   ```

6. 人工检查自动化难以完全证明的部分：
   - xterm 输入、选择、复制与 app 快捷键冲突。
   - Browser WebContentsView 在 drag overlay、popover、确认框、panel collapse 时的遮挡与焦点。
   - 触控板/鼠标拖动在 100%、125%、150% 缩放下的 before/after 判定。
   - 深浅主题与 1440×900、1100×800 布局截图。

最终交付证据必须包含：测试命令结果、right/bottom E2E 截图、资源 ID 移动前后对比、localStorage v1→v2 迁移样本，以及 `git diff --name-only` 证明未修改 app-server。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 现有 right-workspace 是 staged 新代码，重构时覆盖用户改动 | 高 | 从当前 working tree 建基线测试；新增 generic core，最后再删除兼容层；每阶段保持可运行 |
| close、preview replace、bulk close 多条路径导致资源双清理或泄漏 | 高 | 所有关闭走 controller transaction；adapter cleanup 要幂等；main dispose 只做兜底 |
| Browser WebContentsView 位于 React DOM 之上 | 高 | overlay/menu/drag/confirm 统一通知 active browser hide；激活后重新 bounds/show |
| running Terminal 被批量关闭静默 kill | 高 | 批量预检、单次确认、取消时全批次不提交 |
| localStorage schema 扩展破坏已有用户状态 | 高 | 明确 version、迁移函数、损坏/未知版本测试、旧 key 保留一个发布周期 |
| draft→thread 改变 Provider key 导致 PTY/browser 重建 | 高 | scope/runtime workspace ID 改用稳定 conversation identity，threadId 只作可更新 target |
| 自研拖动出现误触或跨 panel 状态错乱 | 中 | 6px threshold、纯 geometry 单测、cancel snapshot、move 事务；不在 reducer 内做副作用 |
| bottom panel 挤压聊天或与最大化冲突 | 中 | 设 chat 最小尺寸和 panel max ratio；只允许一个 panel maximized；覆盖窄高窗口 |
| 快捷键抢占 composer/xterm/browser 输入 | 中 | 明确焦点矩阵、输入控件优先、只有真实注册后才显示快捷键 |
| 为“通用化”大改 shared/preload/main 命名 | 中 | 保留跨进程 API 和服务实现；此次重构主要限制在 renderer 与 App 布局 |
| 参考 bundle 无源码语义和公共 API 保证 | 中 | 只复刻已由行为和调用链证明的规则；不依赖 bundle、私有包或变量名 |

## 9. 建议实施批次与停止条件

### 批次 A：通用控制器但仍只有右侧

包含步骤 0–5。完成后应当看不出 UI 差异，但内部已没有 right-only controller。

停止条件：现有四内容、IPC、右侧截图、resource cleanup 全部无回归；第 1.1 节 UI 复用硬约束和第 5.7 节 UI 复用验收全部满足。

### 批次 B：Codex tab 语义

包含步骤 6–8。交付 preview/pin、MRU、批量关闭、overflow、焦点和真实快捷键。

停止条件：文件树单击不堆积永久 tab，所有关闭来源使用同一 guard/cleanup，焦点矩阵通过。

### 批次 C：双面板与移动

包含步骤 9–10。交付可见 bottom panel、重排和 right ↔ bottom 移动。

停止条件：跨面板移动不重建/销毁 Terminal 和 Browser，布局与遮挡 E2E 通过。

### 批次 D：收口

包含步骤 11、全量验证、文档和旧兼容层删除。

停止条件：只有一套通用状态源；旧 storage 可迁移；所有验收项有自动化或明确人工证据；无 app-server diff。

## 10. 实施时的文件责任边界

| 责任 | 允许修改区域 | 不应修改 |
| --- | --- | --- |
| 通用状态/Provider/UI | `desktop-app/src/renderer/src/components/workspace-container/` | app-server、main service 内部协议 |
| 内容适配 | `desktop-app/src/renderer/src/components/right-workspace/` | Files/Terminal/Browser 的安全规则 |
| 布局接线 | `desktop-app/src/renderer/src/App.tsx` | 聊天 transport/provider/app-server 链路 |
| 持久化迁移 | renderer workspace persistence | 终端输出、浏览历史、文件内容持久化 |
| 资源生命周期 | adapter + 已有 `window.desktopApp.workspace` | renderer 直接使用 Node/Electron |
| 测试 | renderer/main/shared tests、`tests/e2e/right-workspace.e2e.ts` | 通过删除或放宽已有断言制造“通过” |

建议交付时按批次拆成独立提交，禁止把“纯状态模型”“右侧迁移”“新增交互”“底部布局”“跨栏拖动”压进同一个不可审阅提交。
