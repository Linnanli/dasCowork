# Codex 审阅工作区参考复刻实施计划

- 状态：Ready for implementation（子 agent 审查缺口已补齐）
- 独立复核：PASS（P0/P1/P2 无剩余阻断项）
- 规划模式：Direct
- 日期：2026-08-09
- 参考项目：`reference-projects/codex-electron-26.707.72221-beautified`
- 目标项目：`desktop-app`
- 设计事实源：`DESIGN.md` 的 `Review workspace contract`

## 1. 结论

这不是新建一套 Git 审阅能力，而是对现有能力做分层重构和 UI 复刻。当前项目已经具备共享 `GitManager`、Review 快照、按文件取 diff、stage/unstage/revert、分支/提交来源、preload IPC 和回归测试；主要差距在 Renderer：现有 `LocalGitReviewPanel.tsx` 是 1100 多行的单体组件，只显示一个选中文件，右侧是扁平列表，Review 仍使用自研 `DiffViewer`，没有参考项目的堆叠 diff、Pierre 文件树、来源下拉菜单和富预览。

实施采用以下固定决策：

1. Review 文本差异改用已经安装的 `@pierre/diffs`。
2. 右侧变更文件树改用已经安装的 `@pierre/trees`。
3. Git 数据继续统一经过 `GitManager -> WorktreeRepository/GitReviewSnapshot -> LocalGitService`，不另建 Git client，不修改 `codex/codex-rs/app-server`。
4. 截图中的 `未提交` 是 Renderer 聚合来源：并行读取现有 `unstaged` 和 `staged` 快照，不伪造一个合并后端 patch；同一路径保留两套 generation/revision 和独立写操作目标。
5. 富预览只覆盖 Markdown、图片和 PDF。其他二进制、音视频、压缩包、gitlink 和未知格式显示明确的不可预览状态；不引入通用二进制查看器。
6. 工具栏复刻 `提交或推送` 外观，并接入现有本地提交能力。真实网络 push、认证和 PR 创建不是本计划的默认范围，未有 Main 合同时按钮不得暗示 push 可用。
7. 三种查找能力分开实现：Header 的“跳转到文件”在已加载的变更路径中做本地模糊匹配；右侧树的“筛选文件”只隐藏树节点；`Cmd/Ctrl+F` 的“在审阅中查找”经过共享 Git 快照搜索 patch 内容。三者不共享含糊状态，也不把树过滤请求发到 Main。
8. 文件“已查看/未查看”按参考项目首期只在 branch comparison 且存在稳定 revision 时出现；状态按 repository、来源身份、path 和 revision 隔离，内容 revision 改变后自动回到未查看，不能把旧快照标记带到新内容。

本计划在 Review 工作区展示层与 `.omx/plans/p0-04-local-git-review-and-recovery-reference-parity.md` 冲突时，以本计划为准；Git 写操作的完整快照集合、generation/revision 校验和原子性继续以 `.omx/plans/local-git-review-findings-3-6-reference-parity-plan.md` 为准。

## 2. 参考项目取证

### 2.1 可观察实现

| 能力 | 参考证据 | 结论 |
| --- | --- | --- |
| 顶部来源与统计 | `webview/assets/app-initial~app-main~onboarding-page-DWQ2hD55.js:42105-42493` | 来源 trigger、选中勾、增删统计、提交/分支二级选择均在同一 header |
| Review 选项 | 同文件 `43159-43976` | refresh、split/unified、wrap、expand、rich preview、word diff、whitespace、full files、copy git apply |
| Header 组装 | 同文件 `44160-44520` | 左侧来源摘要，右侧工具按钮、文件树开关和提交区域 |
| 跳转到文件 | 同文件 `41575-41681` | Header 的文件+放大镜按钮打开本地模糊匹配菜单；空结果文案为 `No matching files`，选择后滚动到对应 diff |
| Review 内容搜索 | `.vite/build/worker.js:68080-68405`、webview 同文件 `31880-32005` | `review-search` 复用共享 GitManager/ReviewSnapshot 搜索 patch 路径与 hunk，过滤 generated files，返回最多 250 个 match、总数与 capped 状态 |
| 已查看状态 | webview 同文件 `31090-31235` | `review-viewed-file-v1` 按文件和 diff revision 记录；文件头可切换 `Mark as viewed/unviewed` |
| Pierre diff | 同文件 `26739-26916` | 文件 diff 组件接收 `fileDiff`、`diffStyle`、`overflow`、`hunkSeparators` 和稳定 cache key |
| 富预览路由 | 同文件 `26739-26836` | Markdown、image、PDF 分流；binary/empty/rename 有专门状态 |
| Pierre 文件树 | `webview/assets/app-initial~app-main~quick-chat-window-page~chatgpt-conversation-page-CrA1-JEm.js:158487-158934` | 分层路径、flatten empty directories、Git status、29px 行、选中后滚动到 diff；本地 Files 树已有可复用的 Pierre 右键菜单接线 |
| 树宽与拖动 | 同文件 `158965-159053` | 右侧树最小 200px，最大工作区 60%，左边缘 resize handle |
| GitManager | `.vite/build/src-HagpvBpE.js:53327`、`.vite/build/worker.js:71386`、`.vite/build/main-CpD8a18d.js:84165` | Review summary/diff/search/patch/cat-file 复用共享 Git 管理实例 |
| 中文文案 | `webview/assets/zh-CN-t8Aas5q1.js:2117-2202` | 文件搜索、展开/折叠、全文件、富预览、split/unified、来源等文案可定位 |

### 2.2 截图优先级

用户提供的两张截图是本轮视觉目标。实施前复制到固定、可提交的测试路径，不允许 E2E 继续引用会被系统清理的临时目录：

- 原图 `/var/folders/wd/cvfh5tnd4ds4027l2dhdhzbr0000gn/T/codex-clipboard-08b95ec2-f405-405a-90ed-c89612cd6655.png` -> `desktop-app/tests/e2e/fixtures/review/screenshots/codex-review-collapsed-tree-dark-1460x2048.png`
- 原图 `/var/folders/wd/cvfh5tnd4ds4027l2dhdhzbr0000gn/T/codex-clipboard-20d0b46c-e54b-41ac-b8ee-ecde288056ec.png` -> `desktop-app/tests/e2e/fixtures/review/screenshots/codex-review-source-menu-dark-1460x2048.png`
- `desktop-app/tests/e2e/fixtures/review/screenshots/measurements.json` 固定视口、DPR、字体、toolbar/tree/file-row 裁剪框、关键尺寸和两张原图的 SHA-256；Playwright baseline 使用相同语义文件名。

截图比 26.707 bundle 多出一个 `未提交` 聚合来源，因此实现时按截图增加该项；`上一轮`、`未暂存`、`已暂存`、`已提交`、`分支` 继续映射已有能力。任何 bundle 与截图的视觉差异，以截图为准；任何写操作安全差异，以当前 Main 快照合同为准。

### 2.3 第三方库边界

| 场景 | 参考项目 | 当前项目 | 本计划 |
| --- | --- | --- | --- |
| 文本 diff | Pierre Diffs，底层使用 Shiki | 已安装 `@pierre/diffs@1.2.12`，但 Review 未使用 | 使用 `processFile` + React `FileDiff`；保留 assistant 消息的旧 `DiffViewer` |
| 右侧文件树 | Pierre Trees | 已安装 `@pierre/trees@1.0.0-beta.6`，Files 工作区已使用 | Review 直接使用 `useFileTree` + `FileTree`，抽取共享主题 CSS |
| Markdown | 参考项目内部 Markdown/mdast 组件 | 已有 `streamdown` | 复用当前安全 Markdown 组件，不再引入一套解析器 |
| 图片 | 原生 `<img>` | Files 工作区已用原生 `<img>` | 使用受限 Blob/Object URL，卸载时回收 |
| PDF | React-PDF/PDF.js bundle | 当前 Files 工作区使用 `iframe` | 严格参考复刻阶段先做兼容性 spike，再把相互兼容的 `react-pdf`/`pdfjs-dist` 精确版本写入 package/lockfile；worker 必须是本地打包资源并通过 packaged smoke |
| 其他二进制 | 没有通用查看器 | 有 unsupported/too-large 状态 | 保留专门状态，不新增通用二进制库 |
| Schema/IPC | 打包后不可直接归属 | 已有 Zod | 扩展现有 `localGitApi.ts`，不新增并行协议层 |

## 3. 范围

### 3.1 包含

- 来源下拉菜单：上一轮、未提交、未暂存、已暂存、已提交、分支。
- Header 总增删统计、刷新、展开/折叠全部、split/unified、显示/隐藏文件树、选项菜单和本地提交入口。
- Header “跳转到文件”菜单、`Cmd/Ctrl+F` Review 内容查找、匹配前后导航和 capped/加载更多状态；右树筛选仍是第三条独立路径。
- 左侧所有变更文件的纵向堆叠 diff；大 diff 时降级为单文件模式。
- 右侧可筛选、可展开、可拖动宽度的分层文件树。
- 文件树右键菜单：复制相对路径；仅对当前工作树中可验证存在的文件启用 Files 工作区预览/固定打开和系统“打开方式”。
- 树选择与 diff 滚动双向同步。
- branch comparison 文件头的标记已查看/未查看、revision 变化自动失效，以及文件树的已查看视觉状态。
- Markdown、图片、PDF 富预览与 binary/conflict/rename/type-change/gitlink 专门状态。
- 现有 section/file/hunk stage、unstage、revert 和首次撤销确认。
- Review 视图偏好、来源、文件树宽度/显隐、折叠项和滚动位置恢复。
- 键盘、焦点、aria、tooltip、窄宽度和深浅主题。
- 单元、集成、E2E 与截图回归。

### 3.2 不包含

- 修改 Codex app server、聊天协议或模型调用链。
- GitHub PR review、评论、blame、remote cloud review。
- 任意文件编辑器、行内评论系统或 review comment 发布。
- 通用音频、视频、Office、压缩包、十六进制二进制查看器。
- 未经单独授权的网络 push、凭据管理、remote 设置或 PR 创建。
- 重写 `GitManager`、`WorktreeRepository`、现有 mutation 安全模型。

## 4. 目标架构

```mermaid
flowchart LR
  A[ReviewWorkspace] --> B[useReviewWorkspaceController]
  B --> C[Review source composer]
  C --> D1[unstaged snapshot]
  C --> D2[staged snapshot]
  B --> E[bounded diff cache]
  B --> S[review search adapter]
  E --> F[preload git API]
  S --> F
  F --> G[LocalGitService]
  G --> H[GitManager / GitReviewSnapshot]
  A --> I[ReviewToolbar]
  A --> J[ReviewDiffStack]
  A --> K[ReviewFileTree]
  J --> L[@pierre/diffs FileDiff]
  K --> M[@pierre/trees FileTree]
  J <--> K
```

Renderer 只拥有显示来源、筛选、选择、折叠、宽度和渲染偏好；可信 cwd、Git root、snapshot generation、file revision、diff、blob 内容和写操作继续由 Main 签发或验证。

### 4.1 Renderer 显示模型

新增 Renderer-only 类型，不把 `uncommitted` 直接传给现有 Git IPC：

```ts
type ReviewDisplaySource =
  | { type: 'uncommitted' }
  | LocalGitReviewSource

type ReviewFileSection =
  | {
      kind: 'snapshot'
      backendSource: Exclude<LocalGitReviewSource, { type: 'last-turn' }>
      snapshotGeneration: string
      file: LocalGitReviewFile
      key: string
    }
  | {
      kind: 'turn'
      backendSource: { type: 'last-turn'; turnId: string }
      file: LocalGitReviewLastTurn['files'][number]
      key: string
    }

type ReviewFileGroup = {
  path: string
  previousPath?: string
  sections: ReviewFileSection[]
  additions: number
  deletions: number
  treeStatus: GitStatus
}
```

`uncommitted` 并行读取 staged/unstaged，按规范化 path 分组。同一路径若两边都有变更，树中只出现一次，diff 区显示一个文件组和两个清楚标注的 section；所有 stage/unstage/revert 仍使用对应 section 自己的 source、generation、revision。

### 4.2 缓存键

快照 patch 使用 `target + source + snapshotGeneration + path + previousPath + revision + whitespace + fullFiles` 作为 key；last-turn 使用 `turnId + path + stable diff hash`。来源切换、generation 变化、文件 revision 变化或 Git change event 后，旧请求可以自然完成，但结果不得写入当前 key。最多并发读取 4 个文件；折叠且未进入视口的文件不请求。

### 4.3 查找与已查看数据合同

- `ReviewJumpToFileMenu` 输入当前 `ReviewFileGroup[]`，按文件名优先、完整相对路径次之做本地模糊排序；选择结果只调用现有 scroll adapter，不读 Git。
- `ReviewFileTree` 的筛选值只进入 Pierre `hide-non-matches`/本地 tree model；关闭筛选后恢复筛选前的展开集合。
- 新增 typed `searchReview` IPC，输入 target、单一 backend source、query 和当前 snapshot identity。Main 只接受受限 source 枚举，经 `LocalGitService -> GitManager/GitReviewSnapshot` 生成固定 `git diff --unified=3` 搜索；不得接受 Renderer 传入的任意 Git 参数。
- 搜索结果沿用参考数据形状：`path`、`hunkId`、`lineStart/lineEnd`、patch offset、`snippet.before/match/after`，并返回 `totalMatches`、`isCapped`。每次最多返回 250 个匹配，忽略 `linguist-generated` 文件；路径命中使用 `hunkId: 'path'`。
- `uncommitted` 分别搜索 staged/unstaged，再以 section 身份合并；一侧失败保留另一侧结果。last-turn 在 Renderer 对不可变 turn patch 做同形状本地搜索，不用当前工作树补内容。
- 已查看 key 为 `host/repository + displaySourceIdentity + path`，值为当前文件组的 section revision 集合。只有 branch comparison 且集合完全相等才显示已查看；任一 revision 增删或变化立即失效。持久记录采用有版本号、有限容量的 LRU，仓库移除时可清理。

## 5. 可测试验收标准

### AC-01 来源和 Header

- 默认从会话 Changes 入口打开 `未提交`；从 turn 卡片打开 `上一轮`。
- 来源菜单顺序与截图一致，并显示当前项勾选；Commit/Branch 使用二级列表。
- 切换来源立即保留 Header，内容进入 loading；失败原位 Retry，成功更新总增删统计。
- Header 控件在 1440×900 和截图等比视口中的高度、间距、边框、圆角和左右分区与基线误差不超过 2px。
- icon button 全部有 tooltip/aria-label；split、tree、wrap 等开关有 `aria-pressed`。

### AC-02 堆叠 diff 与 Pierre Diffs

- 普通快照的每个文件都有一个可滚动定位的文件组，不再只渲染 `selectedFile`。
- 文本 patch 经 `processFile(..., { isGitDiff: true, cacheKey })` 解析，并由 `@pierre/diffs/react` 的 `FileDiff` 渲染。
- `disableFileHeader: true`，文件 Header 由产品组件统一绘制；unified/split、wrap/scroll、word/char/none、hunk separator 和 theme 由选项映射。
- 展开/折叠全部只改变展示状态；重新展开复用同 generation/revision 的缓存。
- Pierre 解析或 worker 出错时单文件显示可重试错误，不使整个 Review 崩溃。
- assistant 消息里的旧 `DiffViewer` 行为和测试不变化。

### AC-03 文件树

- `@pierre/trees` 收到分层 path、Git status 和选中 path；单子目录链自动压平。
- 搜索只在 Renderer 过滤/隐藏不匹配项，不触发 Git 读取；清空后恢复原展开状态。
- 树默认占 32%，最小 200px，最大 60%；拖动宽度被持久化。
- 宽度小于 760px 时树自动折叠，但用户仍可用 Header 按钮临时打开；diff 不被压到不可读宽度。
- 文件图标、目录箭头、Git 状态、橙色装饰、选中圆角行和 29–32px 行高与截图对齐。
- 文件右键菜单复用 Files 树的 native menu 模式：复制仓库相对路径、在 Files 工作区预览/固定打开；打开动作和系统“打开方式”只在当前工作树文件经过 Main/preload 能力确认后启用。
- commit/branch/last-turn 等历史来源不得把历史 path 直接交给当前磁盘预览或系统打开；如果当前工作树没有可验证的同 path 文件，只保留复制路径，其余项禁用并解释原因。

### AC-04 跳转到文件与 Review 内容查找

- Header 文件+放大镜按钮打开 `ReviewJumpToFileMenu`；输入为空时按文件名/父路径稳定排序，输入后文件名命中优先于完整路径命中。
- 无结果显示“没有匹配的文件”；方向键移动、Enter 选择、Escape 关闭并把焦点还给 trigger。选择后展开目标文件、按需加载并滚动到文件 Header。
- 右树“筛选文件…”只隐藏树节点，不改变 diff stack、不触发 Git IPC；Header 跳转菜单关闭时不改变树筛选词。
- Review 获得焦点时，`Cmd/Ctrl+F` 打开内容查找；query debounce 后通过 `searchReview` 搜索路径与 patch hunk，显示当前/总匹配、上一个/下一个和关闭按钮。
- 选择内容匹配会加载目标文件、滚动到对应 hunk/行并高亮 snippet；来源或 generation 改变时旧结果立即失效，迟到响应不得重新高亮。
- 结果被 250 上限截断时显示“仅显示前 250 个，共 N 个”；large-diff/capped 模式中仅在还有未装载的匹配文件时显示“加载更多匹配项”，不能伪造无限分页。
- 空 query 不发 Git 命令；无匹配、部分来源失败、完全失败、搜索中止和 capped 都有独立状态与测试。

### AC-05 树与 diff 双向同步

- 单击树文件，若 diff 已加载则滚动到文件 Header；未加载则优先入队并在完成后定位。
- 用户滚动 diff 时，顶部最接近容器起点的文件成为 active path，树选择与可视区域同步。
- 程序性滚动期间不会产生 selection-scroll 循环或连续抖动。
- rename/copy 使用新 path 作为主定位，旧 path 只作说明；同 path 双 section 仍只有一个树节点。

### AC-06 `未提交` 聚合

- staged/unstaged 同时成功时按 path 合并显示，总增删为两个快照统计之和。
- 仅一侧成功时保留成功内容，并在失败 section 显示 partial error/retry；不得把成功快照标记为失败。
- 对同路径双 section 执行 action 时，请求只携带被操作 section 的 source/generation/revision。
- section-level action 明确区分 `未暂存全部` 与 `已暂存全部`，不能生成一个跨两代快照的伪原子请求。
- 切换回单独 `未暂存` 或 `已暂存` 时只发一次对应快照请求。

### AC-07 富预览与二进制

- Rich preview 开关只对 `.md/.mdx`、受支持图片和 PDF 可见或生效。
- Markdown 读取所选 source 对应的 Git 内容，使用现有安全 Markdown renderer；不能错误读取当前工作区文件代替历史版本。
- 图片使用受限字节结果生成 Blob URL，切换/卸载时调用 `URL.revokeObjectURL`。
- PDF 使用 PDF.js worker 渲染，支持至少页数、逐页显示、loading/error；打包应用不能依赖公网 worker URL。
- 单文件内容有 MIME 白名单、原始字节上限、base64/IPC 上限和 stale snapshot 校验。
- remote host 若暂不具备安全二进制传输，显示 `此主机暂不支持富预览` 并保留 diff/binary summary，不回退到损坏字符串。
- last-turn 没有可验证 blob/object ID 时禁用 rich preview 并保留 patch；不能用当前工作区文件冒充历史 turn 内容。
- audio/video/archive/gitlink/unknown binary 不进入 Markdown/PDF/image renderer。

### AC-08 写操作和提交

- 现有 stage/unstage/revert 的 section/file/hunk 能力继续通过 Main 校验。
- stale snapshot 后所有写按钮禁用，自动刷新成功才恢复。
- pending 只锁定目标 section/file/hunk；其他文件仍可浏览。
- destructive revert 首次显示确认和 `不再询问`，取消/Escape 不写 Git。
- Header 的提交入口复用 `LocalCommitService`/`CommitChangesDialog`，成功后刷新 staged、unstaged 和统计。
- 未实现 push 合同时，`提交或推送` 的 push 分支保持能力禁用并解释原因，不执行 shell 或网络旁路。

### AC-09 状态、可访问性和持久化

- loading、background refresh、empty、error、large diff、binary、conflict、deleted、renamed-only、type-changed、gitlink 都有独立状态。
- 背景刷新保留上次内容但冻结 mutation；刷新失败可继续阅读并 Retry。
- source、diffMode、wrap、wordDiff、whitespace、fullFiles、richPreview、treeVisible、treeWidth、collapsedKeys 按 repository/workspace 隔离。
- branch comparison 且存在稳定 revision 时，文件头可标记已查看/未查看，已查看文件在树与 Header 中有不依赖颜色的状态；其他来源不显示伪按钮，revision 改变后自动恢复未查看。
- 已查看记录按 repository/source/path/revision 隔离并有容量上限；切换来源不能串标，重命名后的新 path 默认未查看。
- 打开菜单后方向键移动，Enter/Space 选择，Escape 只关闭最上层，焦点回 trigger。
- tree、menu、toolbar、file group 均有可读 role/name；不能只靠红绿/橙色区分状态。

### AC-10 视觉与性能

- dark 主题 1460×2048 截图状态与两张用户基线进行像素比较，关键 toolbar/tree/header 区域 `maxDiffPixelRatio <= 0.005`，整页 `<= 0.01`。
- 1440×900 light/dark、1280×800、760px 临界宽度各有截图和交互断言。
- 100 文件快照首次可交互时间不被 100 次串行 diff 请求阻塞；首屏只请求进入/接近视口的文件，最大并发 4。
- 来源快速切换 10 次后，没有陈旧 patch 闪回、未处理 Promise rejection、Blob URL 泄漏或 worker 泄漏。

### AC-11 架构边界

- Renderer 中没有 `fs`、`child_process`、Git shell 拼接或直接模型请求。
- 新读取能力完整经过 shared Zod schema、preload、Main IPC、`LocalGitService` 和 `GitManager`。
- `searchReview` 与文件内容读取复用同一个 repository-scoped `GitManager`；禁止在 IPC handler 或 Renderer 另建 Git client。
- 没有修改 `codex/codex-rs/app-server`。
- `@pierre/diffs`/`@pierre/trees` 成为 Review 的唯一 diff/tree 渲染实现；没有再造第二套同类 parser/tree。

## 6. 实施步骤

### Step 0：先锁定行为与视觉基线

涉及文件：

- `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewPanel.test.tsx`
- `desktop-app/tests/e2e/local-git-review.e2e.ts`
- `desktop-app/tests/e2e/right-workspace.e2e.ts`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/reviewTestFixtures.ts`
- 新增 `desktop-app/tests/e2e/fixtures/review/`

动作：

1. 为 staged、unstaged、同 path 双状态、commit、branch、last-turn、binary、conflict、rename、large diff 建稳定 fixture。
2. 先增加失败测试，证明当前实现只请求/显示一个 `selectedFile`、使用扁平列表、未使用 Pierre、无 `未提交` 聚合，也没有跳转菜单、内容查找、树右键菜单和已查看状态。
3. 将两张用户截图复制到 `desktop-app/tests/e2e/fixtures/review/screenshots/` 的固定语义文件名；生成 `measurements.json`，记录 SHA-256、Electron/Chromium、字体、主题、DPR、1460×2048 视口、toolbar/tree/file-row 裁剪框和关键尺寸。测试不得保留 `/var/folders/.../T` 路径。
4. 为 Playwright 建 `codex-review-collapsed-tree-dark-1460x2048.png`、`codex-review-source-menu-dark-1460x2048.png` 两个全页基线，以及 toolbar、source-menu、file-tree 三个稳定裁剪基线；mask 仅允许时间/系统字体不可控区域并在 JSON 解释原因。
5. 固定当前 stage/unstage/revert、commit/branch、stale snapshot 行为测试，防止 UI 重构破坏已有能力。

完成门：新 UI 测试按预期失败，旧 Git 读写测试保持通过。

### Step 1：拆分 Review 单体组件和显示状态

涉及文件：

- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewWorkspace.tsx`
- `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewPanel.tsx`
- `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewProvider.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/reviewWorkspaceTypes.ts`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/reviewWorkspaceModel.ts`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/useReviewWorkspaceController.ts`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/reviewWorkspaceStore.ts`

动作：

1. 让 `ReviewWorkspace` 成为唯一页面编排器；`LocalGitReviewPanel` 暂保留兼容 facade，直到现有调用和测试迁完。
2. `LocalGitReviewProvider` 只保留 target、打开来源、lastTurn、通知和 Git workflow；页面局部 state 移入 controller。
3. 用已有 Zustand 保存纯 UI 偏好，key 至少包含 host/repository/workspace；服务端快照和 Promise 不写入持久 store。另建有版本号、有限容量的 viewed-file slice，保存 source/path/revision identity，不保存 patch 内容。
4. 定义 `ReviewDisplaySource`、`ReviewFileSection`、`ReviewFileGroup`、load state 和 mutation state。
5. 把当前 1100 多行组件中的 source load、file diff load、mutation、branch/commit picker、revert confirmation 拆成可独立测试的 hooks/model。

完成门：旧 UI 外观可以暂时不变，但所有旧行为通过新 controller，`LocalGitReviewPanel.tsx` 不再拥有 Git 数据协议细节。

### Step 2：实现来源组合和 Header

涉及文件：

- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewToolbar.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewSourceMenu.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewCommitMenu.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewBranchMenu.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewJumpToFileMenu.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/RightWorkspaceProvider.tsx`
- `desktop-app/src/renderer/src/components/workspace-container/workspaceOpenTargets.ts`
- `desktop-app/src/renderer/src/components/workspace-container/workspacePersistence.ts`

动作：

1. 将 workspace 持久化 source 扩展为 Renderer 的 `ReviewDisplaySource`，向 IPC 发请求前再收窄到 `LocalGitReviewSource`。
2. Changes 入口默认打开 `uncommitted`；last-turn 入口仍携带 turn payload。
3. `uncommitted` 使用 `Promise.allSettled` 并行拉 staged/unstaged，生成 partial-success 状态和 file groups。
4. Header 左侧实现来源 trigger、当前 commit subject/branch comparison 和总增删；右侧实现截图中的紧凑 toolbar。
5. Commit/Branch 二级菜单复用现有 `listCommits`、`listBranches`、`resolveMergeBase`，增加 search、loading、empty、error/retry。
6. Header 文件+放大镜按钮接入 `ReviewJumpToFileMenu`：本地模糊匹配当前 file groups，文件名权重高于完整路径；选择结果复用 controller 的 load-and-scroll adapter。
7. 工具按钮只显示有真实能力的项；未完成能力进入 disabled+tooltip，不放置无效开关。

完成门：AC-01、AC-04、AC-06 的来源与 Header 组件测试通过。

### Step 3：用 Pierre Diffs 构建堆叠 diff

涉及文件：

- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewDiffStack.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileBlock.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileDiff.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/reviewDiffOptions.ts`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/reviewDiffCache.ts`
- `desktop-app/src/renderer/src/components/assistant-ui/diff-viewer.tsx` 仅回归验证，不迁移其其他消费者

动作：

1. 对每个 `LocalGitFileDiff.diff` 调用 `processFile(diff, { isGitDiff: true, cacheKey })`，解析失败进入文件级 ErrorBoundary。
2. 使用 `<FileDiff fileDiff={...}>`；设置 `disableFileHeader: true`，让 `ReviewFileBlock` 绘制截图一致的文件 Header。
3. 映射选项：`diffStyle`、`overflow`、`lineDiffType`、`hunkSeparators`、`themeType`、`expandUnchanged`；统一 Pierre unsafe CSS 到语义 token。
4. Header 显示目录省略、文件名、状态、+/-、折叠、stage/unstage/revert；双 section 使用次级 section 标签，不复制树节点。
5. branch comparison 且有稳定 revision 时，文件 Header 增加“标记为已查看/未查看”；状态值绑定该文件组当前 section revision 集合。树节点同步展示已查看状态，revision 改变自动失效；其他来源不渲染该动作。
6. 用 Pierre 的 fileDiff hunk metadata 作为 hunk index 的唯一来源，把现有 hunk mutation 控件接到对应 section。
7. 对 binary/conflict/truncated/rename-only/type-change/gitlink 使用专门组件，禁止把 Git 元数据字符串送进代码高亮。

完成门：AC-02、AC-08、AC-09 的显示、已查看状态与写操作组件测试通过；代码库中 Review 不再 import 自研 `DiffViewer`。

### Step 4：用 Pierre Trees 构建右侧文件树

涉及文件：

- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileTree.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/reviewFileTreeModel.ts`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/shared/pierreTreeTheme.ts`
- `desktop-app/src/renderer/src/components/right-workspace/files/WorkspaceFileTree.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/files/workspaceFileTreeGit.ts`

动作：

1. 从 Files 的 `fileTreeUnsafeCss` 抽取通用 Pierre 树 theme，Files/Review 各自只追加行高和 decoration 差异。
2. `reviewFileTreeModel` 把 file groups 转成 paths、entriesByTreePath、GitStatusEntry、初始展开目录和 filter 索引。
3. `useFileTree` 配置 `flattenEmptyDirectories: true`、`itemHeight: 29`、colored complete icons、sticky folders、selection、Git status。
4. 右侧容器加入搜索框、1px 左边框和 resize handle；宽度 clamp 200px–60%。
5. 搜索使用 Pierre hide-non-matches 或 model reset，但必须保留选中 path 和用户展开状态。
6. 复用 `WorkspaceFileTree.tsx` 的 Pierre right-click/native-menu 接线，不复制平台判断：菜单支持复制相对路径、在 Files 工作区预览/固定打开，以及经过能力判断的系统“打开方式”。历史来源只有在当前工作树存在同 path 文件时才可打开，否则除复制路径外均禁用。
7. selected row、muted 文件文字、hover/focus、橙色 status decoration 和已查看 decoration 通过 CSS variable/unsafeCSS 对齐截图；已查看状态同时有文本/图标语义，不能只降低颜色。

完成门：AC-03 的组件、键盘和宽度测试通过；Files 工作区原有树截图不回归。

### Step 5：实现滚动同步、Review 内容查找、懒加载和 large-diff 降级

涉及文件：

- `desktop-app/src/renderer/src/components/right-workspace/review/useReviewWorkspaceController.ts`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewDiffStack.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileTree.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/reviewDiffCache.ts`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFindBar.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/reviewSearchAdapter.ts`
- `desktop-app/src/shared/localGitApi.ts` 及 `localGitApi.test.ts`
- `desktop-app/src/preload/index.ts` 及 preload 类型测试
- `desktop-app/src/main/localGit/localGitIpc.ts` 及测试
- `desktop-app/src/main/localGit/LocalGitService.ts` 及测试
- `desktop-app/src/main/localGit/GitManager.ts` 及测试
- `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewPanel.test.tsx` 或迁移后的 Review 测试

动作：

1. 使用一个 diff scroll container 和 `IntersectionObserver`；首屏与预加载边界内文件进入最大并发 4 的队列。
2. 树点击设置 scroll intent，优先调度目标文件，加载完成后 `scrollIntoView({ block: 'start' })`。
3. stack 滚动通过 file Header observer 更新 active path；程序性滚动期间用 intent token 抑制反向写入。
4. source/generation 变化时 abort/失效旧队列；Promise resolve 前再次比较完整 cache key。
5. 增加 `searchReview` Zod/preload/Main 合同；`LocalGitService` 通过当前 repository 的共享 `GitManager/GitReviewSnapshot` 执行固定 diff 搜索，过滤 generated files，并返回参考形状的 path/hunk/snippet/total/isCapped，单次上限 250。
6. `uncommitted` 对 staged/unstaged 分别搜索后保留 section identity 合并；last-turn 只搜索 turn patch。空 query 不发 IPC，query/source/generation 变化会 abort 或丢弃迟到响应。
7. `ReviewFindBar` 响应 `Cmd/Ctrl+F`，提供当前/总数、上一个/下一个、关闭、空/失败/partial/capped 状态；选中 match 时先调度对应 file，再精确滚动到 hunk/line 并高亮。
8. service 标记 `largeDiff` 时只加载选中文件，默认选择第一项；Header 和树仍显示完整文件摘要。“加载更多匹配项”只负责装载尚未渲染的已知匹配文件，不突破后端 250 上限。
9. 折叠文件取消未开始请求，已完成缓存保留到 generation 失效。

完成门：AC-04、AC-05、AC-10、AC-11 的搜索、同步、竞态、架构和性能测试通过。

### Step 6：增加安全的 Git 内容读取和富预览

涉及文件：

- `desktop-app/src/shared/localGitApi.ts` 及 `localGitApi.test.ts`
- `desktop-app/src/preload/index.ts` 及 preload 类型测试
- `desktop-app/src/main/localGit/localGitIpc.ts` 及测试
- `desktop-app/src/main/localGit/LocalGitService.ts` 及测试
- `desktop-app/src/main/localGit/GitManager.ts`
- `desktop-app/src/main/localGit/GitHostRegistry.ts`
- 新增 `desktop-app/src/main/localGit/reviewFileContent.ts`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewRichPreview.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewPdfPreview.tsx`
- `desktop-app/package.json` 和 lockfile，仅在 PDF slice 实施时更新

动作：

1. 先做 PDF 依赖门禁：在目标 Electron/Vite/React 版本上验证 `react-pdf` peerDependencies、与 `pdfjs-dist` 的 worker/API 兼容性、ESM 打包和 CSP。兼容性 spike 未通过前不得写生产预览组件。
2. spike 通过后，把确定的一对 `react-pdf`/`pdfjs-dist` **精确版本**写入 `desktop-app/package.json` 和 lockfile（不得使用 `^`/`~`），在 `docs/codex-right-workspace.md` 记录版本配对与升级检查项。
3. 增加 `getReviewFileContent` typed request：target、backend source、snapshotGeneration、file target、side；Main 重新验证 snapshot/source/revision。
4. `reviewFileContent.ts` 按 source 推导可信 Git object/worktree/index 内容，禁止 Renderer 传任意 ref 或绝对路径。
5. 文本限制与二进制限制分开；结果为 text、media bytes、too-large、unsupported、stale，不返回任意本地路径。
6. 若现有 `GitHost.runGit` 的字符串 transport 不能无损返回二进制，为 host 增加显式 bytes capability；无法安全实现的 remote host 返回 unsupported，不做隐式编码猜测。
7. Markdown 复用 Streamdown；图片用 Blob URL；PDF worker 通过 `new URL(..., import.meta.url)` 或等价 Vite 本地 asset 方案打包，不设置 CDN/public URL。
8. PDF slice 必须分别通过 dev server、production build 和 packaged Electron 离线 smoke；断网后仍能显示多页 PDF，worker 加载不违反 CSP。
9. Rich preview 失败只回退到当前文件 diff/summary，不改变 source，不吞掉 binary/conflict 状态。
10. 为 deletion/rename 决定 preview side：删除显示 before；新增显示 after；修改默认 after；必要时在预览 Header 提供 before/after 选择。

完成门：AC-07 的 schema、Main、Renderer、精确依赖版本、CSP/worker 和 packaged build 测试通过。

### Step 7：补齐 Review options、完整 patch 和提交入口

涉及文件：

- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewToolbar.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewOptionsMenu.tsx`
- `desktop-app/src/shared/localGitApi.ts`
- `desktop-app/src/main/localGit/LocalGitService.ts`
- `desktop-app/src/main/localGit/reviewSnapshot.ts`
- `desktop-app/src/renderer/src/components/local-git-review/CommitChangesDialog.tsx`

动作：

1. 将 word diff、wrap、rich preview、full files、whitespace、copy apply 放入 options menu；split/unified 和 tree toggle 保留一级按钮。
2. Word diff 只映射 Pierre `lineDiffType`，不改变 Git patch。
3. Whitespace/full-files 若需要重取数据，扩展 `getFileDiff` 的受限枚举选项；Main 映射固定 Git 参数，Renderer 不能传任意 CLI 参数。
4. `Copy git apply command` 使用 Main 按当前 snapshot 生成/返回的完整受限 patch 或安全命令，不继续依赖用户复制后才读取的漂移工作区状态。
5. 将现有 `CommitChangesDialog` 提炼为可从 Review Header 打开；提交成功统一使 staged/unstaged snapshot 失效并刷新。
6. Push 只留 capability seam；若后续纳入，必须单独增加 typed `LocalPushService`、expected HEAD、upstream/remote 校验、认证/非快进错误和网络测试，不能在本计划中偷偷执行 `git push`。

完成门：所有 options 有真实效果或被隐藏/禁用；提交回归通过。

### Step 8：持久化、响应式、可访问性和视觉收口

涉及文件：

- `desktop-app/src/renderer/src/components/right-workspace/review/reviewWorkspaceStore.ts`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewWorkspace.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewToolbar.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewJumpToFileMenu.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFindBar.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewDiffStack.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileTree.tsx`
- `desktop-app/src/renderer/src/assets/styles/globals.css`，仅补语义变量无法表达的全局规则
- `desktop-app/tests/e2e/right-workspace.e2e.ts`

动作：

1. 按 repository/workspace 保存偏好，限制 collapsed key 数量并在 generation 变化时清理无效项；viewed-file 状态按 repository/source/path/revision 保存为有版本号的 bounded LRU。
2. 实现 760px tree 自动折叠、toolbar overflow、source 文本省略和 commit 控件 disabled 布局。
3. 完成 menu/tree/file group 的 focus order、Escape、方向键、aria 状态和 reduced motion。
4. 在固定 theme/DPR/viewport 下逐个对齐 Header、3 个 collapsed file row、tree search、group nesting、selected row、source menu。
5. 运行视觉比较；只允许字体抗锯齿的记录差异，不扩大 mask 隐藏结构偏差。

完成门：AC-09、AC-10 全部通过。

### Step 9：删除兼容壳并更新文档

涉及文件：

- `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewPanel.tsx`
- `desktop-app/src/renderer/src/components/local-git-review/LocalGitReviewPanel.test.tsx`
- `docs/codex-right-workspace.md`
- `DESIGN.md`

动作：

1. 所有调用和测试迁到新 Review workspace 后，删除或缩成无逻辑 re-export/facade；不保留两套 Review UI。
2. 删除只服务旧 flat list/single diff 的 helper 和样式，保留被 assistant 消息使用的 `DiffViewer`。
3. 文档更新数据流、第三方库、rich preview 支持矩阵、remote 降级和 push 非范围。
4. 使用 `rg` 确认 Review 唯一 diff/tree import 来自 Pierre，且没有 Renderer Git/Node 越界。

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `未提交` 同 path 同时 staged/unstaged | 误把两代快照合成一次写操作 | 只在显示层 group；section 始终保留 backend source/generation/revision |
| 100+ 文件的 Pierre worker/高亮开销 | 首屏卡顿、内存升高 | IntersectionObserver、并发 4、稳定 cache key、large-diff 单文件模式 |
| 树选择与滚动互相触发 | 抖动、跳错文件 | scroll intent token + active Header observer + 单一 scroll owner |
| 三种搜索状态混用 | 树筛选意外改变 diff 或产生多余 Git 请求 | jump/tree-filter/review-find 使用独立 state 和组件；以测试断言 IPC 调用边界 |
| 内容搜索迟到响应 | 切源后跳到旧 hunk | request identity 包含 source/generation/query，AbortSignal + resolve 前二次校验 |
| 已查看记录跨 revision 泄漏 | 新改动被误标为已查看 | 保存完整 section revision 集合；集合变化立即失效并限制持久化容量 |
| 历史来源调用当前文件打开能力 | 打开磁盘上不对应的版本 | context menu capability gate；当前工作树无同 path 文件时只允许复制路径 |
| binary 通过字符串 transport 损坏 | 图片/PDF错误或安全问题 | 显式 bytes capability；不支持的 host 明确降级 |
| React-PDF/PDF.js 版本或 worker 不匹配 | 开发可用、生产空白 | 先做兼容性 spike，精确锁定版本对，worker 本地 asset、CSP 测试、packaged smoke test |
| 临时截图被清理或裁剪漂移 | 视觉回归不可复现 | 固定 fixture 文件名、SHA-256、measurements.json 和裁剪 baseline |
| Pierre shadow DOM 样式漂移 | 与截图不一致 | 优先 CSS variables，共享 theme，最少 unsafeCSS，锁定组件版本 |
| 旧 monolith 与新组件并存 | 两套状态、修复漂移 | facade 只用于迁移，Step 9 删除，新增功能只进新目录 |
| refresh 时旧 mutation 仍可点 | stale snapshot 写入失败/误导 | background refresh 冻结写按钮，Main 校验继续作为最终防线 |
| `提交或推送` 文案超出当前能力 | 用户误认为会 push | 本地提交可启用；push 未有合同则 disabled + tooltip，另立能力计划 |

## 8. 验证顺序

每一步先运行最小相关测试，再逐层扩大：

```bash
npm --prefix desktop-app test -- src/renderer/src/components/right-workspace/review
npm --prefix desktop-app test -- src/renderer/src/components/local-git-review/LocalGitReviewPanel.test.tsx
npm --prefix desktop-app test -- src/main/localGit/LocalGitService.test.ts src/main/localGit/reviewSnapshot.test.ts src/main/localGit/localGitIpc.test.ts
npm --prefix desktop-app run typecheck
npm --prefix desktop-app run lint
npm --prefix desktop-app test
npm --prefix desktop-app run build
npm --prefix desktop-app run test:e2e -- --reporter=line
```

补充验证：

- `git diff --check`。
- `rg -n 'DiffViewer' desktop-app/src/renderer/src/components/right-workspace/review desktop-app/src/renderer/src/components/local-git-review` 应无新 Review 使用。
- `rg -n '@pierre/diffs|@pierre/trees' desktop-app/src/renderer/src/components/right-workspace/review` 应分别命中 diff/tree 组件。
- `rg -n 'child_process|node:fs|git push' desktop-app/src/renderer/src/components/right-workspace/review` 应无 Renderer 越界。
- `searchReview` schema/IPC/Main 测试断言空 query 不执行 Git、最大 250、generated path 被忽略、stale generation 被拒绝，且共享 `GitManager` 实例未被旁路。
- 跳转菜单、右树筛选和 `Cmd/Ctrl+F` 内容搜索测试分别断言自己的 state/IPC 行为，防止三者耦合。
- 树右键菜单覆盖 working-tree 与历史来源；已查看覆盖 branch 同 revision 恢复、revision 变化失效、来源隔离和持久化容量。
- `package.json` 与 lockfile 中 `react-pdf`/`pdfjs-dist` 是经 spike 验证的精确版本；断网 packaged smoke 仍能加载本地 worker。
- 视觉测试只从 `desktop-app/tests/e2e/fixtures/review/screenshots/` 和 Playwright snapshot 目录读取，原始 fixture SHA-256 与 `measurements.json` 一致。
- packaged Electron 中打开 Markdown/image/PDF、切换 source、快速折叠/展开、拖动树宽、切换 theme。
- local 与 remote host 各跑一次；remote binary 不支持时必须出现预期降级，而不是乱码。

## 9. 完成定义

满足以下条件才算完成：

1. AC-01 至 AC-11 全部有自动化证据。
2. 两张用户截图对应状态达到视觉阈值，且控件可实际操作。
3. Review 使用 Pierre Diffs/Pierre Trees，堆叠 diff、来源菜单、跳转到文件、内容查找、树同步、树右键菜单、已查看状态和富预览均落地。
4. 原有 stage/unstage/revert、commit/branch、stale snapshot、last-turn 行为没有回归。
5. Main/preload/shared 分层完整，没有 Renderer 越界，没有 app-server 改动。
6. 未实现的 remote push 被明确隔离，不以外观相似冒充能力完成。
7. 旧单体 Review UI 不再作为第二实现存活，文档与 `DESIGN.md` 同步。
