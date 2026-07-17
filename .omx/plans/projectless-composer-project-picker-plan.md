# Projectless 对话框项目卡片与项目选择浮窗实施计划

## 1. 目标与结论

在尚未绑定 thread 的新对话输入框上方增加一个与 Composer 视觉连体的项目卡片：

- Projectless（即没有选中 local、path 或 remote 项目）时，卡片只显示文件夹图标和“选择项目”；
- 点击卡片后，从输入框上方弹出项目浮窗，支持搜索、项目列表、创建空白项目、使用现有文件夹；
- 已选中项目时，卡片显示当前项目名称，并允许在发送首条消息前切换项目；
- 对尚未绑定 thread 的新对话，选择项目后直接更新当前草稿；
- 对已经绑定 thread 的对话，不渲染项目卡片及 `composer-project-card-shell`，不提供修改项目入口。

实现限定在 `desktop-app/` 的 Renderer、shared schema、preload、Electron Main 和项目服务中。
不修改 `codex/codex-rs/app-server/`，也不修改 provider fork。

### 1.1 实施状态（2026-07-17）

本计划已实施完成：

- 已新增 Composer 顶部项目卡片、可搜索项目浮窗、“新建项目”二级页面和空白项目命名 Dialog；
- Projectless 的空 selection 与显式 `{ projectKind: 'projectless' }` 已统一为同一产品状态，
  均只显示“选择项目”并允许发送首条消息；
- local、path、remote 项目已归一化为统一选择器模型，支持名称、路径、remote host/path 搜索；
- 已接通 `Renderer → preload → Main → ProjectApiService` 的空白项目创建链路，在 Documents
  下原子创建目录，同名时依次使用 `2`、`3` 后缀；
- 未绑定草稿可原地切换项目；绑定 thread 后隐藏项目卡片和修改入口；取消文件夹选择不改变草稿；
- 已删除未使用的旧 `ProjectSwitcher.tsx` 和 `CreateLocalProjectDialog.tsx`，避免保留第二套入口；
- E2E 已保存项目选择器截图附件，并验证浮窗位于卡片上方、搜索过滤、项目选择，以及通过
  Renderer/preload/Main 真实创建空白项目目录并刷新卡片。

实施时保留了两个最小化差异：

- `projectPickerModel.ts` 独立消费现有 `ProjectState`，没有重构 Sidebar 的稳定映射逻辑，避免为本功能
  扩大 Sidebar 回归面；
- 空白项目不执行 `git init`，与本计划的范围约束一致。

验证结果：

- `npm --prefix desktop-app run typecheck`：通过；
- `npm --prefix desktop-app test`：70 个测试文件、651 个测试通过；
- `npm --prefix desktop-app run lint`：0 error；另有未修改
  `model-selector.tsx` 的 221 条既有 Prettier warning；
- `npx playwright test --reporter=line`：25 个通过、1 个按既有条件跳过；
- `git diff --check`：通过。

## 2. 参考项目分析

### 2.1 值得复用的交互结构

参考项目没有把项目选择逻辑写死在输入框中，而是拆成“触发器 + 可复用浮窗内容 + 统一项目状态”：

- 项目浮窗 `Ke` 接收项目列表、选中项、选择回调和底部动作，见
  `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~app-main~hotkey-window-new-thread-page~hotkey-window-home-page~composer-utility-bar-C1jWzTPL.js:114-129`。
- 搜索在 Renderer 内存中即时完成，匹配项目名、仓库根目录、路径和远程主机名，见同文件
  `:153-159`。
- 项目列表最多显示约 5 行，超出后浮窗内部滚动，见同文件 `:200-202`。
- 无结果时显示明确空状态，见同文件 `:286-303`。
- 底部动作和项目列表由分隔线隔开，见同文件 `:315-380`。
- 完整控制器 `Ze` 负责当前项目、菜单开关和选择动作，见同文件 `:436-514`。
- 没有项目时显示 `Choose project`，tooltip 和 aria-label 也随状态变化，见同文件
  `:517-574`。
- “New project”使用二级菜单，包含 `Start from scratch` 和
  `Use an existing folder`，见同文件 `:588-618`。
- 浮窗从触发器上方弹出、左对齐，并使用独立宽度和高度约束，见同文件
  `:753-763`。

本项目复用这些交互原则，但不复制 beautified bundle 中的通用菜单框架、全局 atom、
analytics、worktree 和 host 分支。

### 2.2 Projectless 语义

参考项目把“没有 active project”作为 Projectless 展示状态：

- active project 为空时显示 `Choose project`，见项目选择器文件 `:505-510`、`:517-547`；
- Projectless 历史不会作为普通项目混入项目列表，见
  `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~artifact-tab-content.electron~app-main~pull-request-code-review~new-thread-pane~f023c15b-DuVw_8by.js:51333-51353`；
- 真正启动任务时再生成独立 Projectless cwd 和输出目录，见同文件 `:27398-27415`。

dasCowork 已有相同的 Main 端能力：没有 selection 或 selection 为 `projectless` 时，
`ProjectService` 会创建隔离工作区，见
`desktop-app/src/main/projects/ProjectService.ts:50-57`、`:145-159`。
因此不需要为了卡片额外创建一个“Projectless 项目”，也不需要修改 app-server。

### 2.3 创建空白项目

参考项目的“新建空白项目”实际创建一个本地目录，而不是只创建内存元数据：

- Renderer 完成项目命名后发送 `electron-create-new-workspace-root-option`，见
  `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/app-initial~artifact-tab-content.electron~app-main~pull-request-code-review~new-thread-pane~f023c15b-DuVw_8by.js:53046-53078`；
- Main 创建目录后复用“添加 workspace root”的注册和激活逻辑，见
  `reference-projects/codex-electron-26.707.72221-beautified/.vite/build/main-CpD8a18d.js:57863-57869`；
- 项目名会被清理，重名时追加 `2`、`3`，目录创建在系统 Documents 下，见同文件
  `:58922-58957`；
- “使用现有文件夹”则调用 Electron `showOpenDialog`，见同文件 `:58901-58920`；
- 两种入口最后都更新项目列表、active root 并广播状态，见同文件 `:58987-59030`。

当前项目的 `createLocalProject` 要求至少一个已经存在的 source root，见
`desktop-app/src/shared/projects/projectSchemas.ts:20-23` 和
`desktop-app/src/main/projects/ProjectApiService.ts:63-97`，不能直接表达“新建空白项目”。
需要补充一条窄的创建目录 API。

首期与参考项目有一个有意差异：只创建并注册空目录，不自动执行 `git init`。当前需求没有
Git 初始化要求，为此引入命令执行和设置分支会扩大范围；后续如有需要再单独增加。

## 3. 当前项目的复用点与设计决定

### 3.1 卡片挂载位置

`ChatThread` 已经在 footer 中依次渲染状态卡和 Composer，见
`desktop-app/src/renderer/src/App.tsx:716-741`。在 `:723-733` 增加一个
`ComposerProjectStack`，内部依次放置 `ComposerProjectCard` 和现有 `Composer`：

- 卡片和输入框使用零间距容器，形成截图中的上下连体关系；
- `ComposerTurnStatusCard` 继续位于整个项目卡片/输入框组合的上方；
- footer 继续使用 `--thread-max-width: 44rem`，不再建立另一套宽度；
- Composer 内现有 `Working in: ...` 文案位于
  `desktop-app/src/renderer/src/App.tsx:2112-2117`，新卡片上线后删除，避免重复显示项目上下文。

### 3.2 Projectless 统一定义

当前 `ProjectSelection` 已有显式 `projectless` 分支，见
`desktop-app/src/shared/projects/projectTypes.ts:1-7`；但默认项目状态没有 active selection，
见 `desktop-app/src/main/projects/ProjectStore.ts:20-34`。

产品层不区分“无项目”和“显式 Projectless”。统一定义为：

> 项目状态加载完成后，只要没有选中 local、path 或 remote 项目，就处于 Projectless。

`activeProjectSelection == null` 和 `{ projectKind: 'projectless' }` 只是同一产品状态在不同
生命周期中的内部表示：

- `undefined` 常见于默认项目状态或尚未持久化选择的新草稿；
- `{ projectKind: 'projectless' }` 用于明确切回 Projectless，以及 thread assignment 的持久化；
- Renderer 展示、可发送判定和用户文案不得因这两种内部表示而不同。

新 UI 使用一个统一判定：

```ts
const isProjectlessMode =
  projectState.state !== null &&
  (effectiveSelection == null ||
    effectiveSelection.projectKind === "projectless");
```

同时修正 Composer 的可发送判定：

- 项目状态仍在加载时保持禁发，避免把“尚未加载”误判成 Projectless；
- Projectless 无论内部表示为空 selection 还是 `projectKind: 'projectless'`，都允许发送，
  由 Main 按现有逻辑创建 Projectless workspace；
- 卡片不显示 `Projectless`、临时 cwd、输出目录或 `Working in`。

当前禁发逻辑在 `desktop-app/src/renderer/src/App.tsx:1990-1995`，
项目上下文判定在 `:2153-2161`，应使用同一 Projectless 判定，避免展示和发送状态不一致。

### 3.3 项目列表模型

新增 Renderer 纯函数，把 `ProjectState` 归一化为轻量选项：

```ts
type ProjectPickerOption = {
  id: string;
  kind: "local" | "path" | "remote";
  label: string;
  detail: string | null;
  searchText: string;
  selection: ProjectSelection;
  selected: boolean;
  missing: boolean;
};
```

数据源沿用现有状态：

- 本地项目：`projectOrder` + `localProjects`；
- 已使用文件夹：`workspaceRootOptions`，保持当前数组的最近使用顺序；
- 远程项目：`remoteProjects`，只提供选择，不在该浮窗增加“新建远程项目”；
- `projectless` 不作为列表项。

`ProjectState` 的这些字段定义在
`desktop-app/src/shared/projects/projectTypes.ts:40-86`。Sidebar 已有三类项目的映射规则，
见 `desktop-app/src/renderer/src/sidebar/sidebarModel.ts:34-57`、`:59-138`，新模型应提取并
复用共同的 label / selection 规则，避免 sidebar 和 Composer 各自解释项目类型。

列表按以下顺序展示：

1. pinned 本地项目；
2. 其余本地项目，遵循 `projectOrder`；
3. path 项目，遵循 `workspaceRootOptions` 当前顺序；
4. remote 项目，遵循 `remoteProjects` 当前顺序。

同一个真实目录已经被 local project 覆盖时，不再重复显示 path 项；去重仅使用项目状态中
已经规范化的 root/path，不在 Renderer 访问文件系统。

搜索为大小写不敏感的子串匹配，覆盖项目名、路径、远程 host 和 remote path，不新增 IPC。

### 3.4 新草稿与已有线程的项目边界

`ConversationChatRegistry` 只允许未绑定 thread、无消息且 ready 的草稿更新 project selection，
见 `desktop-app/src/renderer/src/runtime/ConversationChatRegistry.ts:255-260`。
发送时 transport 也优先使用已有会话的 project selection，见
`desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.ts:168-181`。

因此选择动作固定为：

- 未绑定的新草稿：`selectProject` 后停留在当前草稿，runtime 自动同步 selection；
- 已绑定 thread：`ComposerProjectCard` 不挂载，`composer-project-card-shell` 不存在，不提供选择、
  创建项目或切回 Projectless 的入口；
- 创建空白项目、使用现有文件夹和切回 Projectless 只适用于未绑定草稿；
- 未绑定草稿的操作失败时不关闭浮窗，并在浮窗或命名 Dialog 中显示错误。

现有 Sidebar 已使用“选择项目后新建对话”的安全模式，见
`desktop-app/src/renderer/src/sidebar/SidebarProjectsSection.tsx:22-25`。用户如需更换项目，应从
Sidebar 或新对话入口创建新草稿后再选择；这不意味着已绑定对话内的 Composer 可以修改项目。

## 4. 需求摘要

### 4.1 本期包含

1. 未绑定新草稿输入框顶部的项目卡片和与输入框连体的视觉样式。
2. Projectless 时只显示“选择项目”，不向用户暴露“无项目”和“显式 Projectless”的区别。
3. 未绑定草稿已选项目时显示当前项目名称。
4. 从输入框上方弹出的项目浮窗。
5. 项目名、路径、远程 host/path 的本地搜索。
6. local、path、remote 项目选择和当前项勾选。
7. “新建项目”二级动作：
   - 新建空白项目；
   - 使用现有文件夹。
8. 已选项目时提供“不在项目中工作”动作，切回 Projectless；Projectless 状态下不显示该动作。
9. 项目创建、文件夹选择和状态广播。
10. 已绑定 thread 隐藏项目卡片与 `composer-project-card-shell`。
11. 键盘、焦点、空状态、加载状态和错误状态。

### 4.2 本期不包含

- 修改 Codex app-server 或 AI SDK provider；
- 新建远程项目；
- 自动 `git init`；
- 项目删除、重命名、置顶管理；
- 文件夹内容扫描或服务端搜索；
- 迁移或重写现有 thread 的 project assignment；
- 复制参考项目的 worktree、host、analytics 或通用菜单框架。

## 5. 实施步骤

### 步骤 1：抽出统一项目选择视图模型

涉及文件：

- 新增 `desktop-app/src/renderer/src/projects/projectPickerModel.ts`
- 新增 `desktop-app/src/renderer/src/projects/projectPickerModel.test.ts`
- 调整 `desktop-app/src/renderer/src/sidebar/sidebarModel.ts:34-138`

工作内容：

1. 建立 `ProjectPickerOption` 和稳定 selection key。
2. 从 local、path、remote 状态生成统一选项。
3. 把共同的 label、detail、selection、selected 和 missing 规则从 sidebar 映射中提取为纯函数。
4. 按 pinned / projectOrder / workspaceRootOptions / remote 顺序生成列表。
5. 对 local root 和 path root 做确定性去重。
6. 增加大小写不敏感搜索；空查询返回完整列表。
7. 单测覆盖三种项目、Projectless 排除、当前项、缺失目录、重名项目、去重、顺序和搜索。

### 步骤 2：实现 Composer 项目卡片与可搜索浮窗

涉及文件：

- 新增 `desktop-app/src/renderer/src/projects/ComposerProjectCard.tsx`
- 新增 `desktop-app/src/renderer/src/projects/ComposerProjectCard.test.tsx`
- 复用 `desktop-app/src/renderer/src/components/ui/popover.tsx:9-37`
- 复用 `desktop-app/src/renderer/src/components/ui/command.tsx:59-138`

工作内容：

1. 在 Composer stack 中增加固定 40px 高的卡片容器，沿用卡片边框、背景、圆角和阴影；
   trigger 使用共享的 `Button variant="ghost"`，保持内容宽度且不撑满容器：
   - Projectless：文件夹图标 + “选择项目”；
   - 有 selection：项目图标 + 当前项目名；
   - loading：禁用并显示“加载项目…”；
   - Projectless trigger 不显示路径、`Projectless` 标签、删除按钮或额外说明。
2. Popover 使用 `side="top"`、`align="start"` 和 collision padding，宽度跟随 Composer，
   高度最多约 5 个项目行，超出后内部滚动。
3. 浮窗顶部使用 `CommandInput`，placeholder 为“搜索项目”。
4. 列表项显示图标、名称、必要时的路径/host 辅助信息和当前项勾选；缺失目录禁用并显示原因。
5. 无搜索结果时显示“未找到项目”。
6. 底部通过 separator 放置：
   - 条件显示的“不在项目中工作”；
   - “新建项目”二级动作。
7. “新建项目”的二级视图提供“新建空白项目”和“使用现有文件夹”；使用 Command 内部二级页面
   或嵌套 Radix primitive，不增加新依赖。
8. Enter / Space 打开，方向键移动，Enter 选择，Escape 逐级返回或关闭；关闭后焦点返回 trigger。
9. 异步选择期间禁用重复提交；失败保留浮窗并显示 `role="alert"`。

不要接入现有 `ProjectSwitcher.tsx:16-162` 的手写 absolute 浮层；它没有搜索、
`workspaceRootOptions`、click-outside 和键盘焦点语义。新组件完成并确认无引用后，删除未使用的
`ProjectSwitcher.tsx`；旧 `CreateLocalProjectDialog.tsx` 在确认无引用后也一并删除，
避免保留两套相互冲突的项目入口。

### 步骤 3：把卡片接入 Composer，并统一 Projectless 行为

涉及文件：

- `desktop-app/src/renderer/src/App.tsx:294-317`
- `desktop-app/src/renderer/src/App.tsx:421-495`
- `desktop-app/src/renderer/src/App.tsx:622-745`
- `desktop-app/src/renderer/src/App.tsx:1884-2175`
- `desktop-app/src/renderer/src/App.test.tsx`

工作内容：

1. `ChatThread` 仅在当前视图是无消息的新草稿且尚未绑定 `threadId` 时挂载
   `ComposerProjectCard`。
2. 未绑定草稿在 `ChatThread` footer 中用零间距 stack 包住项目卡片与 Composer；已绑定 thread
   只保留 Composer。
3. 未绑定草稿使用当前草稿的有效 selection 展示卡片；已有对话的 project selection 仍用于
   runtime 上下文，但不再渲染为可操作卡片。
4. 选择、创建或打开文件夹成功后，保留当前未绑定草稿并更新 selection。
5. 删除 Composer action row 中的 `Working in: ...`。
6. 统一 Projectless 的两种内部表示：状态已加载时，无 selection 和
   `projectKind: 'projectless'` 都允许发送；状态尚未加载时仍禁发。
7. 保留当前 `ProjectService` 的 Projectless workspace 生成路径，不把临时 cwd 暴露到 UI。
8. App 集成测试覆盖未绑定草稿中卡片位于 composer shell 之前、Projectless 文案唯一、发送状态，
   以及已绑定 thread 中项目卡片与 shell 均不存在。

### 步骤 4：增加“新建空白项目”的安全桌面 API

涉及文件：

- `desktop-app/src/shared/projects/projectSchemas.ts:20-49`
- `desktop-app/src/shared/projects/projectSchemas.test.ts`
- `desktop-app/src/shared/codexIpcApi.ts:356-375`
- `desktop-app/src/shared/codexIpcApi.test.ts`
- `desktop-app/src/preload/index.ts:79-99`
- `desktop-app/src/main/index.ts:86-101`
- `desktop-app/src/main/index.ts:429-464`
- `desktop-app/src/main/projects/ProjectApiService.ts:17-97`
- `desktop-app/src/main/projects/projectRuntimeServices.ts:15-50`

新增窄接口：

```ts
type ProjectCreateBlankPayload = {
  name: string
}

createBlankProject(input: ProjectCreateBlankPayload): Promise<WorkspaceRootOption>
```

工作内容：

1. shared schema 对 name 执行 trim、非空、最大长度和路径分隔符校验；拒绝 `.`、`..`。
2. preload 只增加 `codex:projects:create-blank` 的固定 invoke 映射。
3. main handler 解析 payload，调用 `ProjectApiService.createBlankProject`，成功后复用
   `broadcastProjectState`。
4. `createProjectRuntimeServices` 新增 `documentsPath` 注入；由 Electron Main 传入
   `app.getPath('documents')`，测试中使用临时目录。
5. 新增可测试的 `createBlankProjectRoot(name)`：
   - 目标为 `<Documents>/<name>`；
   - 冲突时依次尝试 `<name> 2`、`<name> 3`；
   - 使用非递归 mkdir + `EEXIST` 重试，避免先检查后创建的竞态；
   - 不执行 shell 命令，不执行 `git init`。
6. 把 `ProjectApiService.pickWorkspaceRoot` 的“校验 → upsert workspaceRootOptions →
   激活 path selection”抽成私有共用方法；创建空目录和选择已有文件夹都走同一注册逻辑。
7. 创建目录成功但状态持久化失败时，返回包含已创建路径的明确错误，不静默删除目录，
   避免误删用户在并发流程中写入的内容。

### 步骤 5：接入空白项目命名 Dialog 和已有文件夹动作

涉及文件：

- 新增 `desktop-app/src/renderer/src/projects/CreateBlankProjectDialog.tsx`
- 新增 `desktop-app/src/renderer/src/projects/CreateBlankProjectDialog.test.tsx`
- `desktop-app/src/renderer/src/projects/useProjectState.ts:10-84`
- `desktop-app/src/renderer/src/projects/useProjectState.test.tsx`
- `desktop-app/src/renderer/src/projects/ComposerProjectCard.tsx`

工作内容：

1. 给 `ProjectStateController` 增加 `createBlankProject(name)`，调用 preload API 后刷新状态。
2. “使用现有文件夹”直接复用现有 `pickWorkspaceRoot` 链路；当前链路已经是
   Renderer → preload → Main `dialog.showOpenDialog({ openDirectory })` →
   validate/register/select，见：
   - `desktop-app/src/renderer/src/projects/useProjectState.ts:40-45`
   - `desktop-app/src/preload/index.ts:79-83`
   - `desktop-app/src/main/index.ts:166-172`、`:429-434`
   - `desktop-app/src/main/projects/ProjectApiService.ts:36-60`
3. “新建空白项目”打开只包含项目名的 Dialog；自动聚焦、Enter 提交、Escape 取消。
4. 提交时展示进行中状态并防重复点击；schema/Main 错误显示为 `role="alert"`。
5. 成功后关闭 Dialog 和项目浮窗，刷新未绑定草稿的卡片为新项目。
6. 取消 Dialog 或原生文件夹 picker 时，不改变项目状态。

### 步骤 6：补齐 Main、状态和边界测试

涉及文件：

- `desktop-app/src/main/projects/ProjectApiService.test.ts`
- `desktop-app/src/main/projects/projectRuntimeServices.test.ts`
- `desktop-app/src/main/projects/ProjectStore.test.ts`
- `desktop-app/src/shared/projects/projectSchemas.test.ts`
- `desktop-app/src/shared/codexIpcApi.test.ts`
- 新增项目 preload / IPC handler 的定向测试文件，或先抽出可注入 handler 再测试

必须覆盖：

1. 合法名称在 Documents 下创建目录、注册为 path 项并设为 active selection。
2. 同名目录已存在时使用 `name 2`、连续冲突使用 `name 3`。
3. 空名、`.`、`..`、路径分隔符和超长名称在写磁盘前被拒绝。
4. mkdir 非 `EEXIST` 错误原样传播，不写 ProjectStore。
5. ProjectStore 写入失败时错误包含已创建目录路径，不假装回滚成功。
6. 选择已有文件夹取消时返回 null，状态不变。
7. 创建和选择成功后 Main 广播一次最新 ProjectState。
8. preload 不能调用任意 channel，Renderer 不能访问 `fs`、`dialog` 或 Documents 路径。
9. Projectless 的两种内部表示发送时都由 `ProjectService` 生成相同的 Projectless assignment；
   选中项目后使用对应 path/local/remote assignment。

### 步骤 7：视觉和真实链路验收

涉及文件：

- `desktop-app/tests/e2e/chat.e2e.ts:69-138`
- `desktop-app/tests/e2e/sidebar.e2e.ts:23-55`

工作内容：

1. 扩展 Projectless Composer e2e，检查卡片与输入框对齐、浮窗向上打开、列表滚动和暗色主题。
2. 覆盖搜索并选择一个已有项目，确认新消息使用该项目 cwd。
3. 覆盖已绑定 Projectless 或项目 thread 中不渲染项目卡片与
   `composer-project-card-shell`，且原 thread assignment 不变。
4. 覆盖“使用现有文件夹”取消和成功两条路径；成功后卡片显示文件夹名。
5. 覆盖新建空白项目命名、重名后缀、状态广播和新对话聚焦。
6. 保存稳定 screenshot，只断言关键尺寸、DOM slot、popover 方向和文本，不依赖整页像素完全一致。

## 6. 可测试验收标准

### 6.1 卡片与 Projectless

- 项目状态加载完成且没有选中 local、path 或 remote 项目时，统一进入 Projectless：
  未绑定草稿的卡片可见且只出现一次“选择项目”；页面不出现 `Projectless`、`Working in:`、
  临时 cwd 或输出目录。
- `activeProjectSelection == null` 和 `{ projectKind: 'projectless' }` 的卡片、发送按钮和
  新 thread 行为完全一致。
- Projectless 时发送按钮可用；发出首条消息后，Main 生成
  `workspaceKind: 'projectless'` 的 thread assignment。
- 项目状态仍为 `null` 时，卡片显示“加载项目…”且发送按钮不可用。
- local、path、remote selection 分别显示对应项目名；辅助路径只在浮窗中显示，不挤入卡片。
- 卡片 DOM 位于 `aui_composer-shell` 之前，并与 shell 共用同一最大宽度；两者之间没有 footer 的
  16px gap。
- 卡片容器高度固定为 40px；内部 trigger 使用共享 `Button`，宽度小于卡片容器。
- 已绑定 thread 不渲染 `ComposerProjectCard` 或 `composer-project-card-shell`。

### 6.2 浮窗和搜索

- 鼠标点击、Enter、Space 均可打开浮窗；`aria-expanded` 与实际 open 状态一致。
- 浮窗从卡片上方弹出并左对齐；项目超过 5 行时列表内部滚动，footer 动作保持可见。
- 搜索项目名、路径、remote host、remote path 均为大小写不敏感子串匹配。
- 无匹配项时显示“未找到项目”，清空搜索后恢复完整列表。
- local、path、remote 项目都能选中；当前项有勾选，missing path 不可选择。
- Projectless 不出现在项目列表中。
- 当前为项目模式时显示“不在项目中工作”；当前为 Projectless 时不显示该动作。
- Escape 从二级动作返回主列表，再次 Escape 关闭；关闭后焦点回到“选择项目”卡片。

### 6.3 项目切换

- 未绑定 thread 的新草稿选择项目后，草稿文字和附件保持不变，当前草稿 selection 更新，
  不额外创建对话。
- 已绑定 thread 的项目卡片与 shell 不存在，无法从 Composer 修改项目；旧 thread 的
  project assignment、cwd、消息和草稿不被改写。
- 未绑定草稿的选择动作失败时不关闭浮窗，错误以 `role="alert"` 展示。
- 选择“不在项目中工作”后，未绑定草稿进入 Projectless；已绑定 thread 不提供该动作。

### 6.4 新建项目与已有文件夹

- “新建项目”二级动作只显示“新建空白项目”和“使用现有文件夹”。
- 新建空白项目要求输入合法名称；取消不创建目录、不写状态、不新建对话。
- 成功创建 `<Documents>/<name>` 后，目录存在、列表新增 path 项、active selection 指向该目录、
  卡片显示名称。
- 同名目录已存在时创建 `<name> 2`，连续冲突时继续递增，不覆盖任何现有目录。
- 创建空白项目不会自动创建 `.git`，不会调用 shell 或 app-server。
- 使用现有文件夹调用 Electron `openDirectory`；取消不改变状态，成功后注册、激活并显示该目录。

### 6.5 架构边界

- Renderer 只通过 `window.desktopApp.projects` 调用项目能力，不能读取 Documents、调用 `fs` 或
  Electron dialog。
- preload 只增加固定的 `codex:projects:create-blank` invoke 映射。
- Main 对所有 Renderer payload 先做 Zod 校验，再执行文件系统操作。
- `codex/codex-rs/app-server/` 和
  `desktop-app/vendors/ai-sdk-provider-codex-asp/` 没有功能性改动。

## 7. 风险与缓解

- **Projectless 与“尚未加载”混淆**：以 `projectState.state === null` 区分 loading；
  状态加载完成后，只要没有选中 local、path 或 remote 项目就进入 Projectless。
- **已有 thread 被错误换 cwd**：`ChatThread` 同时检查新草稿状态和 `threadId`，首条消息出现或
  thread 绑定后都不挂载项目卡片；
  用 App 集成测试和 E2E 锁定项目入口缺失及旧 assignment。
- **同一目录重复出现**：统一视图模型按规范化 root/path 去重；Projectless 永不进入普通项目列表。
- **local/path/remote 排序不稳定**：排序只依赖持久化的 pinned、projectOrder 和数组顺序，
  不使用渲染时的当前时间。
- **嵌套浮窗焦点丢失**：优先用 Command 二级页面；如使用嵌套 Radix primitive，增加
  Escape、closeAutoFocus 和键盘遍历测试。
- **目录命名冲突或竞态**：使用 mkdir 的原子失败结果判断 `EEXIST`，不采用
  `exists → mkdir` 两阶段检查。
- **创建后持久化失败**：不静默删除已经创建的目录；错误明确返回路径，用户可以通过
  “使用现有文件夹”重新加入。
- **旧项目入口形成两套行为**：新卡片稳定后删除未引用的手写 `ProjectSwitcher` 和旧 Dialog；
  shared/Main 的已有 createLocal API 暂不删除，避免扩大兼容性变更。
- **参考项目范围过大**：只复用选择器结构、搜索、二级动作和 Main 文件能力，不复制远程创建、
  worktree、analytics 或 git 设置。

## 8. 验证步骤

### 8.1 定向验证

```bash
npm --prefix desktop-app test -- \
  src/renderer/src/projects/projectPickerModel.test.ts \
  src/renderer/src/projects/ComposerProjectCard.test.tsx \
  src/renderer/src/projects/CreateBlankProjectDialog.test.tsx \
  src/renderer/src/projects/useProjectState.test.tsx \
  src/main/projects/ProjectApiService.test.ts \
  src/main/projects/projectRuntimeServices.test.ts \
  src/shared/projects/projectSchemas.test.ts \
  src/shared/codexIpcApi.test.ts
```

### 8.2 全量静态与单元测试

```bash
npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
npm --prefix desktop-app test
```

### 8.3 真实链路与视觉验证

```bash
npm --prefix desktop-app run test:e2e -- --reporter=line
```

当前 E2E 会附加 `composer-project-picker.png`，并检查 Popover 位于卡片上方。后续视觉回归仍应
覆盖暗色和亮色两种主题、窗口窄宽度、5 个以上项目、重名项目、超长项目名，以及 Popover
靠近屏幕边缘时的 collision 行为。

## 9. 完成条件

只有同时满足以下条件才算完成：

1. 所有验收标准都有自动化测试或明确的 e2e / screenshot 证据；
2. lint、typecheck、unit、e2e 均通过；
3. Projectless 首条消息可正常发送；
4. 已绑定 thread 不显示项目卡片或 `composer-project-card-shell`，没有 Composer 内修改项目入口；
5. 新建空白项目和使用现有文件夹均走受控 desktop API；
6. app-server 和 provider 无功能性改动；
7. 没有保留第二套未使用的项目选择浮层。
