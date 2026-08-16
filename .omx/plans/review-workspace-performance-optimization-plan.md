# Review 工作区性能优化计划

- 状态：Ready for execution（已按 2026-08-14 Performance trace 更新优先级）
- 规划模式：`$plan` direct
- 日期：2026-08-14
- 目标项目：`desktop-app`
- 参考项目：`reference-projects/codex-electron-26.707.72221-beautified`
- 约束：不修改 `codex/codex-rs/app-server`；不降低 Git snapshot/revision/stale 校验；默认不新增运行时依赖

## 1. 结论

可以安装 Vercel 的 React 性能 skill，但正确名称是 `vercel-react-best-practices`。它是给 Codex 使用的代码审查知识库，不是运行时插件，安装后不会直接让 Review 变快。

官方页面给出的安装命令：

```bash
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices
```

用户给出的 `Vercel (vercel@openai-curated-remote)` 推荐插件和这个 agent skill 是两套机制：前者是 Vercel 服务连接能力，后者是本地性能规则包。优化 Review 不需要安装 Vercel 连接插件，也不应把两者混为一谈。

三份 Performance trace 已经把 Renderer 侧的优先级拉开，不再把所有静态假设视为同等重要：

1. P0：`@pierre/diffs` 的 Shiki JavaScript 高亮在 Renderer 主线程执行；滚动 trace 中 `findNextMatchSync`/`#execCore` 分别采样 5.61s/2.64s，而当前代码显式设置 `disableWorkerPool`。
2. P0：Controller、文件块和 diff props 的引用不稳定。14 文件 fixture 在打开、滚动、搜索记录中分别产生 70、224、168 次 `ReviewFileBlock` render，即 5、16、12 轮完整文件树 render。
3. P1：全部文件块及其关闭状态的 Dialog/菜单子树仍被挂载，滚动记录达到 41,562 个 DOM 节点，并放大 Layout、Paint 与 GC。
4. 待验证：Main 创建 snapshot 时可能存在随文件数增长的 Git 调用放大，但本批 Chromium trace 没有 Main process 证据。先插桩，只有证实占比后才实施 Git 批量化。

因此采用“先补可区分的基线和插桩，再并行稳定 Renderer 渲染边界与验证 diff worker，然后窗口化 DOM；Main/Git 依据测量结果决定是否进入”的方案。搜索 deferred、CSS containment、React Compiler 和代码分包均排在根因之后。

完整证据见 `.omx/analysis/review-performance-trace-analysis.md`。

## 2. 需求摘要

### 2.1 目标

- 缩短打开 Review、切换来源和首次显示可见 diff 的等待时间。
- 降低大文件数、大 diff、搜索和连续滚动时的主线程阻塞。
- 从参考项目提炼可迁移手法，并区分“Review 已使用”和“同应用其他区域可借鉴”。
- 把 Vercel skill 作为可选审查护栏，配合 profiling 和回归测试使用。
- 保持现有来源切换、文件树、查找、跳转、富预览、stage/unstage/revert、stale snapshot 和 packaged Electron 行为。

### 2.2 非目标

- 不修改 Codex app server 或聊天推理链路。
- 不绕过 preload/main 让 Renderer 直接访问 Git、Node 或文件系统。
- 不用减少 revision 校验、跳过 stale 检查或读取当前工作区内容冒充历史内容来换取速度。
- 不在没有 profile 证据时全局开启 React Compiler、diff worker pool 或引入新的虚拟列表依赖。

## 3. 当前实现取证

### 3.1 已有优化

| 已有方法 | 代码证据 | 判断 |
| --- | --- | --- |
| 来源并行读取 | `desktop-app/src/renderer/src/components/right-workspace/review/useReviewWorkspaceController.ts:223-228` | `uncommitted` 的 staged/unstaged snapshot 已用 `Promise.allSettled` 并行读取。 |
| stale 回包隔离 | 同文件 `:177-285,507-536` | 使用 request id 和 diff option generation 丢弃旧响应，避免旧数据覆盖新来源。 |
| diff 按需加载 | `desktop-app/src/renderer/src/components/right-workspace/review/ReviewDiffStack.tsx:40-85` | 首批只加载选中文件和邻近文件，并用 `IntersectionObserver` 加载进入视口的 section。 |
| diff 并发上限 | `useReviewWorkspaceController.ts:462-540,1073-1083` | Renderer 侧最多并发 4 个 `getFileDiff`。 |
| diff 解析 memo | `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileDiff.tsx:80-117` | `processFile`、options 和 hunk annotations 已有 `useMemo`。 |
| 文件树 memo 与帧调度 | `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileTree.tsx:30-143` | 筛选、tree model、展开路径有 memo；active path 同步放在 `requestAnimationFrame`。 |
| 本地状态限额 | `desktop-app/src/renderer/src/components/right-workspace/review/reviewWorkspaceStore.ts:4-7,89-94,112-140` | collapsed/viewed 各限制 500 条，避免 localStorage 无限增长。 |
| Git read 缓存 | `desktop-app/src/main/localGit/reviewSnapshot.ts:432-449` | 同一 review generation 的读取经 `runCachedGitRead` 缓存。 |
| 输入/载荷上限 | `desktop-app/src/shared/localGitApi.ts:8-9,161,293` | 搜索最多 250 条、完整内容最多 5MB、snapshot 最多 10,000 文件。 |

### 3.2 静态瓶颈假设及 Trace 校准

#### H1：snapshot 创建可能存在 O(文件数) 的 Git 子进程放大（静态高风险，Trace 未覆盖）

- `createReviewSnapshot()` 先并行读取文件列表、计数和 state hash，随后又串行执行 `diffSize()`：`desktop-app/src/main/localGit/reviewSnapshot.ts:71-102`。
- `diffSize()` 通过 `getDiffForSource()` 读取完整 patch 后再算字节数：同文件 `:328-335`。
- `listReviewFiles()` 对每个 tracked file 调 `computeFileRevision()`：同文件 `:245-312`。
- 每个 `computeFileRevision()` 又并行请求一次单文件 diff 和一次 `git status -- path`：同文件 `:123-146`。

在数百或数千文件场景中，这条链路可能在 Renderer 开始渲染之前就产生大量 Git 调用。但本批 Chromium trace 只覆盖 Renderer，不能确认实际 Git invocation 数或 snapshot 占比。先加入 Main 分段 timing 和 Git invocation counter；只有 500/1000 文件 fixture 证实占比后才进入实现。

#### H2：diff 内容懒加载，但文件块仍全量挂载（Trace 已证实，高置信）

- `ReviewDiffStack` 最终对全部 `groups` 执行 `map`：`desktop-app/src/renderer/src/components/right-workspace/review/ReviewDiffStack.tsx:93-99`。
- 未加载 diff 的 section 可以返回 `null`，但每个文件的 header、actions、dialog 和 section 容器仍会创建：`desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileBlock.tsx:58-211`。

因此“没有取回全部 diff”不等于“没有创建全部 React/DOM 节点”。

#### H3：单 section 更新制造全组引用变化和重复观察（Trace 已证实，高置信）

- `replaceSection()` 当前会 spread 每个 group，即使该 group 不包含目标 section：`useReviewWorkspaceController.ts:435-447`。
- controller 每次 render 都返回新对象，并在 `:771-830` 内创建多组内联 action。
- `ReviewDiffStack` 的加载 effect 和 `IntersectionObserver` effect 依赖整个 controller：`ReviewDiffStack.tsx:51-59,61-85`。
- `ReviewFileBlock`、`ReviewDiffStack`、`ReviewToolbar` 等都接收完整 controller，当前没有 Review 专用的 memo/selector 边界。

React Performance Track 直接显示 `controller` 在 Review 组件中每轮变化，并将二十余个 action 标记为引用不稳定。14 文件数据在打开、滚动、搜索中分别发生 5、16、12 轮完整 `ReviewFileBlock` render；这已从“可能”升级为已观测问题。

#### H4：diff 解析/高亮在主线程，且 memo 被不稳定对象击穿（Trace 已证实，高置信）

- `ReviewFileDiff` 明确设置 `disableWorkerPool`：`desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileDiff.tsx:132-159`。
- `fullContentRequest` 和 `hunkActions` 在父组件 render 中按 section 重新创建：`desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileBlock.tsx:363-405`。
- `ParsedReviewFileDiff` 的 `fileDiff` memo 依赖整个 `fullContentRequest` 对象，options memo 依赖完整 `preferences` 对象：`ReviewFileDiff.tsx:80-117`。

CPU profile 已确认 `@shikijs/engine-javascript` 是首要可识别业务热点：滚动 trace 的 `findNextMatchSync` 为 5.61s、`#execCore` 为 2.64s；搜索 trace 分别为 3.36s、2.04s。worker packaged spike 不再是后期可选项，而是 P0 验证项。

#### H5：搜索和导航有可消除的重复扫描（中置信，非当前首要瓶颈）

- 每个远端搜索 item 都会重新 `flatMap(groups).find(...)`：`useReviewWorkspaceController.ts:348-375`。
- `loadSectionDiff()` 也会对全部 section 做 `flatMap().find()`：同文件 `:462-469`。
- last-turn 搜索会在 Renderer 同步 split 并遍历所有 diff 行：同文件 `:919-945`。

这些成本可通过稳定 Map 索引、deferred input 和必要时的分片/worker 搜索消除。但搜索 trace 的 6 次 input 单次最大 71.8ms，`ReviewFindBar` inclusive time 仅 4.8ms；优先级低于整树 render、高亮和 DOM 治理。

#### H6：Review 与重型预览仍是静态入口（中置信）

- `WorkspaceContentRegistry` 静态 import `ReviewWorkspace`：`desktop-app/src/renderer/src/components/workspace-container/WorkspaceContentRegistry.tsx:5-9,111-116`。
- 当前 Review 首次打开前，其组件和依赖已进入主 bundle；参考项目则对 Code view 使用 `Suspense` 边界。

这主要影响应用启动和首次 workspace bundle 解析，不一定是打开 Review 后卡顿的第一根因，排在后续处理。

### 3.3 Performance trace 基线（2026-08-14）

| 指标 | 打开 Review | 连续滚动 | 搜索 |
| --- | ---: | ---: | ---: |
| 记录时长 | 12.05s | 48.68s | 54.11s |
| `>200ms` Renderer RunTask | 10 | 27 | 23 |
| DOM 节点峰值 | 10,707 | 41,562 | 30,097 |
| JS heap 峰值 | 78.6MiB | 118.5MiB | 118.8MiB |
| `ReviewFileBlock` render | 70 | 224 | 168 |
| `findNextMatchSync` CPU sample | 571ms | 5,611ms | 3,360ms |
| `#execCore` CPU sample | 129ms | 2,639ms | 2,037ms |

交互解释：滚动 trace 的 153 次 wheel handler 总计仅 45.2ms、单次最大 9.3ms；搜索 trace 的 6 次 input 单次最大 71.8ms。主要阻塞发生在事件触发后的异步 diff 加载、高亮、React render 和布局，而不是 handler 本身。

限制：滚动和搜索记录混入点击、弹窗及侧边栏活动；原始 `RunTask > 50ms` 总量不能直接当作纯 Review TBT。它们适合发现热点，不作为最终 before/after 硬门。下一轮必须用相同 fixture 分别录制 10–20 秒的单动作 trace，并加入 Main/Renderer instrumentation。

## 4. 参考项目“审阅”工作区的性能方法

### 4.1 Review/PR Code 区已确认使用

| 方法 | 参考证据 | 可迁移结论 |
| --- | --- | --- |
| React Compiler 生成的 memo cache | `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/pull-request-code-review-CXBV7ugc.js:170-200` | 打包产物大量出现 `react.memo_cache_sentinel`，说明组件和对象创建经过编译器级 memo；当前项目 `desktop-app/electron.vite.config.ts:37-48` 仅配置普通 React plugin，`desktop-app/package.json:64-117` 也没有 compiler 依赖。先做 scoped feasibility，不直接全局开启。 |
| `ResizeObserver` 测量布局 | 同文件 `:178-200` | 面板宽度由 observer 驱动，不在每次 render 主动查询全部布局。 |
| `contain: strict` 隔离左右面板 | 同文件 `:810-850,939-970` | 对宽度动画区建立 layout/paint containment，并用 React `Activity` 的 visible/hidden 模式控制隐藏面板。 |
| rAF 批量写布局样式 | 同文件 `:1029-1037,1120-1149` | 拖动和布局变化通过 rAF 合并 CSS 变量写入，清理旧 frame，减少同步 layout 抖动。 |
| 关闭浏览器 scroll anchoring | 同文件 `:1944-1953` | diff 滚动容器使用 `[overflow-anchor:none]`，由应用自己的 anchor 逻辑负责定位。 |
| Review query 长缓存 | `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/review-mode-content-CRO4r5jd.js:278-297` | 稳定的 base-branch 类 query 使用 `staleTime: Infinity`，减少重复查询。当前项目已有 generation cache，应扩展而非另建数据层。 |
| Code view 按需加载 | `reference-projects/codex-electron-26.707.72221-beautified/webview/assets/pull-request-route-C0yh7EDE.js:3066-3090` | Code tab 由 `Suspense` 包裹，先显示轻量 shell，再加载重型 code review 组件。 |
| 筛选值延迟下发 | 同文件 `:4705-4734` | 多字段筛选对象经过 `useDeferredValue` 再传给重型结果组件，保证输入优先。 |

### 4.2 明确没有在 Review 中确认的能力

- 参考 Review 的文件 diff 列表在 `pull-request-code-review-CXBV7ugc.js:1916-1941` 仍对当前文件集合执行完整 `map`，没有观察到 Review 专用虚拟列表。
- `thread-virtualizer-CRZHo-Bm.js:27-41,243-266,660-690` 的确存在 overscan、测高和窗口切片，但它服务于线程区域。它可以作为同一应用内的成熟实现思路，不能写成“参考 Review 已做虚拟化”。
- `use-thread-summary-panel-DWmCeaT1.js` 中的 `content-visibility` 同样属于线程区域，不是 Review 已使用的直接证据。

本项目应复制参考 Review 已证实的缓存、延迟、布局隔离和分包手法，同时补上参考 Review 也缺失的 diff stack 窗口化。

## 5. Vercel skill 的适用边界

截至 2026-08-14，官方 skill frontmatter 名称为 `vercel-react-best-practices`、版本 `1.0.0`，包含 70 条规则、8 个类别。对本任务最有用的规则是：

- `async-parallel`：独立读取并行化。
- `bundle-dynamic-imports` / `bundle-conditional`：Review 和重型预览按需加载。
- `rerender-defer-reads` / `rerender-memo` / `rerender-split-combined-hooks`：缩小订阅与重渲染边界。
- `rerender-use-deferred-value` / `rerender-transitions`：让树筛选、来源切换等非紧急更新让位于输入。
- `rendering-content-visibility`：跳过视口外 layout/paint。
- `js-index-maps` / `js-set-map-lookups`：替换热路径上的重复 `flatMap/find`。
- `js-request-idle-callback`：把非关键的预热、LRU 清理和统计放到空闲时段。

不直接适用的规则包括 Next.js/RSC/server action/SSR 类规则；本项目是 Electron + React client。skill 输出只能进入候选清单，必须由本仓 profile、架构边界和测试验证。

官方依据：

- Skills 页面：<https://skills.sh/vercel-labs/agent-skills/react-best-practices>
- Vercel 仓库：<https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices>
- Skill 内容：<https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md>
- React Profiler：<https://react.dev/reference/react/Profiler>
- React `useDeferredValue`：<https://react.dev/reference/react/useDeferredValue>
- React `lazy`：<https://react.dev/reference/react/lazy>
- React Compiler：<https://react.dev/learn/react-compiler>
- `content-visibility`：<https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility>

## 6. 方案选择

### 方案 A：只做 CSS containment、`memo` 和 Vercel skill 审查

- 优点：改动小、交付快。
- 缺点：无法消除 snapshot 的 Git 调用放大和全量 DOM；容易得到“benchmark 几乎不变”的表面优化。
- 结论：仅作为快速补充，不单独采用。

### 方案 B：测量驱动、Renderer 优先、Main 证据门控的分阶段优化（推荐）

- 优点：先处理 trace 已证实的高亮、重渲染和 DOM 热点，同时保留 Main instrumentation；每阶段都能独立回退和验证。
- 缺点：需要先补 perf fixture，并处理虚拟化与滚动锚点的交互复杂度。
- 结论：采用。

### 方案 C：先全局开启 React Compiler 并引入虚拟列表依赖

- 优点：可能快速覆盖大量 memo 场景。
- 缺点：构建面过大，无法解决 Main Git I/O；新增依赖与 compiler 可能引入 Electron/Vite/React 兼容风险。
- 结论：只保留为 P2 scoped experiment，不作为首轮方案。

## 7. 可测试验收标准

性能预算在同一台指定 perf 机器、packaged/dev 二选一的固定模式、固定 Electron 版本和 5 次冷/热运行中取 p95；首轮基线记录机器、OS、commit、fixture hash 和原始 trace，避免跨机器硬比较。

### AC-01 基线可复现

- 新增 50、500、1000 个小文本变更文件和 1 个 2MB 大 diff 的确定性 fixture；相同 seed 生成相同路径和内容。
- 每档输出：snapshot IPC 时长、底层 Git 调用数、Review 首个 header 时间、首个可见 diff 时间、初始 DOM 文件块数、搜索结果时间、滚动 long-task、React commit 次数。
- 基线原始数据和优化后数据使用相同脚本与 fixture，JSON 中包含 schema version 和 fixture SHA-256。
- 本批 3 个 trace 作为热点发现基线保留，但不直接作为最终时间预算；正式 before/after 每个场景单独从空闲状态录制 10–20 秒，不混入侧边栏、弹窗或其他 workspace 操作。
- Renderer mark 必须能区分 controller update、diff parse/highlight、React commit 和 layout；Main mark 必须能区分 snapshot 子阶段及 Git invocation 数。

### AC-02 snapshot 不再随文件数产生无界 Git 子进程

- 1000 文件单一来源下，snapshot 创建不再出现“每文件 2 次以上 Git 调用”；实现测试断言总 Git invocation 数为固定次数或受明确 chunk size 约束，目标不超过 25 次/来源。
- stale snapshot、单文件 revision 漂移、section 原子拒绝测试继续通过；不得用更弱的 mtime-only 标识替代内容/repository state 校验。
- 500 文件 fixture 的 snapshot p95 相比基线至少下降 50%，且指定 perf 机器上目标不超过 1.0s。

### AC-03 初始 DOM 有界

- 1000 文件 fixture 首屏挂载的 `[data-review-path]` 不超过 60；可视窗口上下各保留 4-8 个 overscan item。
- 未进入窗口的 diff 不发 `getFileDiff`；现有最多 4 个并发请求约束保持。
- 滚动遍历后 DOM 文件块数仍受窗口上限控制，不随已访问文件数累积到 1000。
- 对当前 14 文件复现 fixture，连续滚动的 DOM 节点峰值从本批 41,562 降至 15,000 以下；关闭状态的每文件确认 Dialog/菜单内容不挂载。

### AC-04 打开和交互预算

- 500 文件 fixture 中，“点击 Changes -> 首个文件 header” p95 ≤ 1.2s，“点击 -> 首个可见 diff” p95 ≤ 1.5s；若基线已经更快，则不得回退超过 10%。
- 树筛选输入到可见结果更新 p95 ≤ 100ms；Review 内容搜索输入到状态/首个结果更新 p95 ≤ 300ms。
- 连续滚动 5 秒期间不出现 >200ms 单个 long task，>50ms long task 的总阻塞时间相比基线至少下降 60%。
- 搜索 input event p95 ≤ 50ms；结果计算与输入响应分别记录，不能用整段 trace 时长代替。

### AC-05 重渲染和解析受控

- 加载一个 section diff 时，未变化的 `ReviewFileBlock` 不重新 render；用 Profiler/test instrumentation 证明 1000 文件中实际 render 的 block 数量受窗口大小约束。
- 当前 14 文件 fixture 中，单 section 从 loading 变 ready 时 `ReviewFileBlock` render 不超过“变化文件 + 当前窗口”，固定录制目标不超过 4 个，不再出现 14 的整数倍整树 render。
- 只改变 tree filter、active path 或 toolbar pending 状态时，已解析且内容 identity 未变化的 `processFile` 不重新执行。
- `ReviewDiffStack` 的 observer 不因无关 controller 字段变化而重建。
- worker 条件启用后，Renderer 主线程的 `findNextMatchSync` CPU sample time 相比相同 fixture 下降至少 90%，且没有可归因于高亮的 >200ms `RunMicrotasks`；packaged Electron 离线 smoke 和失败回退必须通过。

### AC-06 功能和安全不回退

- 文件树选择、diff 滚动 active path、Jump to file、搜索匹配跳转、展开/折叠、rich preview、viewed 状态继续工作。
- stage/unstage/revert、partial success、stale snapshot 自动刷新和“绝不自动重试写操作”行为保持。
- non-Git、empty repo、untracked、binary、rename/copy/type-change/gitlink、大 diff 和 last-turn 场景继续通过。
- packaged Electron 下 worker、lazy chunk 和 PDF worker 都从本地资源加载，不依赖公网 URL。

## 8. 实施步骤

### Step 0：建立端到端性能基线和可观测性

状态：首批 Renderer trace 已完成热点发现；可重复 fixture、单动作短 trace 和 Main instrumentation 待实现。

目标文件：

- 新增 `desktop-app/tests/e2e/local-git-review-performance.e2e.ts`
- 新增 `desktop-app/tests/e2e/support/localGitReviewPerformanceFixture.ts`
- 新增 `desktop-app/tests/e2e/fixtures/review/performance/README.md`
- 按需在 `desktop-app/src/renderer/src/components/right-workspace/review/ReviewWorkspace.tsx`、`ReviewDiffStack.tsx`、`ReviewFileDiff.tsx` 增加可清理的 `performance.mark/measure`
- 在 `desktop-app/src/main/localGit/gitCli.ts` 的测试/诊断通道统计 Git invocation，不把原始 diff 或敏感路径写入日志

工作内容：

1. 固定 50/500/1000 文件、2MB 单文件、250 capped search 和 last-turn 大 patch 场景。
2. 用 Playwright trace、Chromium `PerformanceObserver` long-task、React `<Profiler>` 或测试 instrumentation 同时采集 Main IPC 与 Renderer 数据；给 Review、Sidebar 和 Workspace root 分别标识，排除跨区域 render 干扰。
3. 每个动作独立从空闲状态录制 10–20 秒：打开、连续滚动、搜索输入各一份；正式 before/after 不复用本批 49–54 秒混合操作 trace。
4. 性能时间预算先在独立 perf job 报告，确定 3 次稳定运行后再转为阻断门；DOM 上限、请求并发和 Git invocation 数首轮即可设为确定性阻断门。

停止条件：能在同一 commit 上重复运行 5 次，关键 p95 波动不超过 15%，并得到 H1-H6 的占比证据。

### Step 1：消除 snapshot 的 Git 调用放大

进入条件：Step 0 的 Main instrumentation 在 500/1000 文件 fixture 中确认 snapshot/Git invocation 是打开 Review 的显著占比。未达到进入条件时保留本步骤，不提前改 Git revision 语义。

目标文件：

- `desktop-app/src/main/localGit/reviewSnapshot.ts`
- `desktop-app/src/main/localGit/gitCli.ts`
- `desktop-app/src/main/localGit/LocalGitService.ts`
- `desktop-app/src/main/localGit/reviewSnapshot.test.ts`
- `desktop-app/src/main/localGit/LocalGitService.test.ts`
- `desktop-app/src/main/localGit/GitManager.integration.test.ts`

工作内容：

1. 用 source-specific 的批量 raw/index/blob/content identity 生成 revision；tracked staged/commit/branch 优先复用 raw diff blob identity，working-tree/untracked 使用可验证的批量内容哈希或受限 chunk，不再无界 `Promise.all(2 × files)` 启动 Git。
2. 若无法在不削弱安全性的前提下单次批量 hash，则把 revision 计算改为固定并发、固定 chunk、可中止队列，并把上限写进测试。
3. `largeDiff` 不再完整 materialize 总 patch 后才比较字节数；改为有 `maxPatchBytes + 1` 上限的流式/截断读取，超过阈值立即停止保留内容。
4. 将 large-diff 判定和 snapshot 其他独立读取并行启动；继续复用 generation cache 和 Git change invalidation。

停止条件：满足 AC-02，且现有 snapshot/mutation 安全测试无回退。

### Step 2：建立稳定索引和重渲染边界

目标文件：

- `desktop-app/src/renderer/src/components/right-workspace/review/useReviewWorkspaceController.ts`
- `desktop-app/src/renderer/src/components/right-workspace/review/reviewWorkspaceTypes.ts`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewWorkspace.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewDiffStack.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileBlock.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewToolbar.tsx`

工作内容：

1. 为 ready snapshot 建立一次性的 `path -> group`、`sectionKey -> section`、`snapshotGeneration + path -> sectionKey` 和 `source -> fileTargets` Map，替换搜索、加载和 section action 热路径的 `flatMap/find`。
2. 修复 `replaceSection()`，只有命中 section 的 group/section 才产生新引用，其他 group 原样返回。
3. 把 controller 分成稳定 actions 和按组件需要的 view props；child 不再接收完整 controller。`ReviewDiffStack` effect 只依赖 `groups/loadSectionDiff/setActivePath` 等稳定项。
4. 给 `ReviewFileBlock`、section actions、toolbar 派生值建立有证据的 memo 边界；不对简单 primitive 计算滥用 memo。
5. 把 `fullContentRequest`、hunk actions、diff option props 改为稳定 identity；`processFile` cache key 只绑定真实内容身份（source/generation/path/revision/full-content），不把纯展示选项误纳入解析 key。
6. 关闭状态下不为每个文件挂载确认 Dialog/菜单内容；只保留轻量 trigger，用户实际触发动作后再挂载交互子树。

停止条件：满足 AC-05；Profiler 证明单 section ready 不再触发全部文件块 render。

### Step 3：窗口化 ReviewDiffStack，并保留完整导航语义

目标文件：

- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewDiffStack.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileBlock.tsx`
- 新增 `desktop-app/src/renderer/src/components/right-workspace/review/useReviewDiffWindow.ts`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewWorkspace.test.tsx`
- `desktop-app/tests/e2e/local-git-review.e2e.ts`

工作内容：

1. 用 `ResizeObserver` 维护动态文件块高度缓存，按 scrollTop、viewport height 和 4-8 项 overscan 计算窗口；使用 top/bottom spacer 保持总滚动高度。
2. 默认实现不新增依赖，参考同一参考应用的 `thread-virtualizer` 思路。若 1 个工作日 spike 无法稳定处理动态 diff 高度和 anchor，再单独决策是否引入 `@tanstack/react-virtual`，不在本阶段静默加包。
3. `setSelectedPath`、Jump to file 和 search match 改走 virtual window 的 `scrollToPath()`，先把目标纳入窗口，再等待 diff/line 出现；不再依赖“所有 `[data-review-path]` 已存在”。
4. 当前选中、焦点、搜索目标和 pending mutation 文件在需要时 pin 到窗口；滚动完成后释放。
5. 滚动容器加入 `overflow-anchor: none`，锚点完全由 height cache/scroll adapter 管理；文件块可补 `content-visibility:auto` 与 `contain-intrinsic-size` 作为低风险二级裁剪，但不能代替窗口化。
6. 保留 `IntersectionObserver` 只观察已挂载窗口项，继续确保 diff 内容按需加载且最多并发 4 个。

停止条件：满足 AC-03，并通过树/搜索/跳转/滚动同步回归。

### Step 4：降低 diff 解析、语法高亮和富预览主线程成本

优先级：P0，与 Step 2 同一轮推进；Trace 已确认 Shiki JavaScript 高亮是首要 Renderer CPU 热点。

目标文件：

- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileDiff.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewRichPreview.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewPdfPreview.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileDiff.test.tsx`
- Electron/Vite worker 与 packaged smoke 配置文件（仅在 worker spike 通过后）

工作内容：

1. 给 `processFile`、Shiki tokenize/highlight、line DOM commit、full-file 扩展和 rich preview 加可清理的 measure，建立与当前 CPU profile 对得上的 before 数据。
2. 对当前 `disableWorkerPool` 做 packaged spike：验证 worker bundle URL、CSP、app.asar、销毁、错误回退和内存，并比较 `shiki-js` 与 `shiki-wasm` 的主线程时间和总体延迟。
3. packaged smoke 通过且满足 AC-05 时条件启用 worker；保留失败时主线程回退，并针对超长行/超大文件设置 `tokenizeMaxLineLength`、`maxLineDiffLength` 或纯文本降级预算，避免病态输入长期占用线程。
4. 修复 memo identity，并仅在复测显示重复 parse 仍明显时采用有容量的 parsed-diff LRU；revision/source/generation 变化自动失效，避免无限内存。
5. PDF、Markdown 等重型 rich preview 保持“用户选中且打开”才加载；必要时用 `React.lazy`/`Suspense` 拆 chunk。

停止条件：`processFile` 对同一内容只执行一次；启用 worker 时所有 packaged 资源离线可用并有主线程回退。

### Step 5：优化高频输入、面板布局和代码分包

优先级：P2。搜索 trace 显示 input 单次最大 71.8ms、`ReviewFindBar` 总 inclusive time 仅 4.8ms；先完成整树 render、高亮和 DOM 治理，再判断 deferred/分包的边际收益。

目标文件：

- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFileTree.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewFindBar.tsx`
- `desktop-app/src/renderer/src/components/right-workspace/review/ReviewToolbar.tsx`
- `desktop-app/src/renderer/src/components/workspace-container/WorkspaceContentRegistry.tsx`

工作内容：

1. 输入框立即更新原始文本，重型 tree/search 派生使用 `useDeferredValue`；不要把受控输入本身放进 transition。
2. tree resize 的 pointermove 改为单帧最多一次 CSS variable/宽度写入，并在 unmount/pointercancel 清理 rAF。
3. toolbar totals、rich-preview availability、collapsed 状态从 controller 的 memo selector 获取，不在每次 toolbar render 重扫 groups。
4. 对 Review workspace 和重型预览做 `React.lazy` + `Suspense`；产物断言主入口不包含 Review 重型 chunk，首次打开仍显示轻量 skeleton。
5. 在 Review 根/左右面板评估 `contain`，只在不破坏 sticky、popover、shadow DOM 和测高的边界上启用。

停止条件：满足 AC-04；bundle analysis 与 packaged smoke 均通过。

### Step 6：可选的 React Compiler 与 Vercel skill 审查

1. 安装 `vercel-react-best-practices` 后，只对本计划涉及的 Review 文件做规则审查，输出“适用/不适用/需 profile”的清单。
2. React Compiler 只做 Review 目录 scoped experiment；先跑 Rules of React、编译诊断、单测、E2E 和 render-count 对比。
3. 如果 compiler 没有带来可复测收益，或与 `@pierre/diffs`/custom elements/Electron 构建不兼容，放弃该分支，不为追求与参考 bundle 一致而全局启用。

停止条件：只合入有独立 benchmark 收益且不扩大构建风险的部分。

## 9. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 虚拟化破坏 `scrollIntoView`、active path 和 search jump | 先抽象 `scrollToPath/scrollToLine`，再切窗口；对动态高度、折叠、wrap/split、full files 建立专项测试。 |
| revision 批量化削弱 stale 安全 | revision 必须继续绑定真实 source/path/content/repository state；所有 mutation 安全测试先锁行为，mtime-only 方案直接否决。 |
| `content-visibility` 影响焦点、测高或辅助技术 | 只作为窗口化后的二级优化；选中/焦点/pinned 项强制 visible，并跑键盘/ARIA/E2E。 |
| worker 在 dev 可用但 packaged/asar 失败 | 必须有 packaged offline smoke、错误回退和资源存在性断言；失败则保持主线程路径。 |
| 性能阈值在共享 CI 波动 | DOM 数、请求数、Git invocation 数作为硬门；时间预算在固定 perf runner 取 p95，保存原始 trace 和环境元数据。 |
| React Compiler 导致大范围行为变化 | 仅 scoped experiment，单独提交和回退点；不作为前四阶段前置条件。 |
| 缓存优化造成内存增长或显示旧 diff | 所有缓存带 generation/revision key 和容量上限；Git change/source change 时失效，记录 hit/miss/eviction。 |

## 10. 验证步骤

### 10.1 定向单元/集成测试

```bash
npm --prefix desktop-app test -- \
  src/renderer/src/components/right-workspace/review/ReviewWorkspace.test.tsx \
  src/renderer/src/components/right-workspace/review/ReviewFileBlock.test.tsx \
  src/renderer/src/components/right-workspace/review/ReviewFileDiff.test.tsx \
  src/renderer/src/components/right-workspace/review/reviewWorkspaceModel.test.ts \
  src/main/localGit/reviewSnapshot.test.ts \
  src/main/localGit/LocalGitService.test.ts \
  src/main/localGit/GitManager.integration.test.ts
```

### 10.2 静态质量门

```bash
npm --prefix desktop-app run lint
npm --prefix desktop-app run typecheck
```

### 10.3 Electron 真实链路

```bash
npm --prefix desktop-app run test:e2e -- --reporter=line
```

重点断言真实 `Renderer -> preload -> main -> GitManager/ReviewSnapshot -> MessagePort/IPC -> Renderer` 路径，以及 packaged worker/lazy chunk/PDF worker 的离线资源。

### 10.4 性能报告

最终变更说明必须包含：

- 50/500/1000 文件与 2MB diff 的 before/after 表。
- snapshot Git invocation 数和 p95。
- 首 header、首 diff、filter、search p95。
- 初始/滚动后 DOM 文件块峰值。
- React commit/render 数、long-task 总量和最大值。
- 未采用的优化及原因，例如“worker 收益不足”或“compiler 风险大于收益”。

## 11. 推荐执行顺序与停止规则

证据更新后的推荐顺序：`Step 0 -> Step 2 与 Step 4 worker spike -> Step 3 -> 按 Main 证据决定 Step 1 -> Step 5 -> Step 6`。

- Step 2 和 Step 4 是 Renderer P0，可在插桩到位后并行，但必须分别产出可独立回退的 before/after 证据。
- Step 1 不再默认抢先实现；只有 Main instrumentation 证明 snapshot/Git 占比显著时才进入。若未证实，记录结果并跳过实现。
- 即使 Step 2/4 已使当前 14 文件交互达标，仍执行 Step 3 的 DOM 上限治理，因为它解决文件数扩张和持续滚动稳定性。
- worker 已从“有额外收益时再做”提升为 P0 spike；`content-visibility`、搜索 deferred、代码分包和 React Compiler 仍只在有独立收益时继续。
- 当 AC-01 至 AC-06 全部满足、质量门通过、性能报告可复测时停止；不为了“把 Vercel 70 条规则全用一遍”继续改代码。

本计划属于明确的性能优化项目；如进入执行，优先使用 `$performance-goal` 维护指标、基线和阶段验收，而不是把 skill 安装本身当作完成条件。
