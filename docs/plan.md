# `::code-comment` 对话评论卡片实施计划

## 总体方案

- 参考 Codex Electron 的实现，在 assistant 消息完成后解析行首的 `::code-comment{...}` 指令。
- 有效指令不再作为普通 Markdown 显示，而是聚合为一张评论卡片，追加在该轮最终回答之后。
- 复用现有 `Card`、`CardHeader`、`CardContent`、`CardFooter`、`Button` 和 `HoverCard`。
- 不使用 `Table`：参考项目的评论行本质是整行可点击按钮，采用 Button 行能更贴近附图，并保留更好的键盘操作能力。
- 不修改 provider 或 Codex app-server 协议，全部作为 renderer 端的客户端派生展示能力实现。

## 核心改动

### 1. 指令解析与 Render Unit

在 `desktop-app/src/renderer/src/lib/` 增加纯函数解析模块，并接入 `assistantRenderUnits.ts`：

- 仅识别独占一行、位于行首的 `::code-comment{...}`。
- 必填字段：`title`、`body`、`file`。
- 可选字段：`priority`、`confidence`、`start`、`end`。
- 支持带转义的双引号属性值。
- 规范化规则：
  - 去除字段首尾空白。
  - `start`、`end` 最小为 1，且 `end` 不小于 `start`。
  - 优先级限定为 P0–P3；标题已有 `[P1]` 等前缀时不重复添加。
  - 相同文件、行范围、标题和正文的评论只保留一条。
- 仅处理：
  - 已完成的 `final_answer` 文本。
  - 没有 phase 元数据的历史消息，以兼容旧对话。
- 不处理 commentary、正在流式生成或尚未闭合的指令。
- 有效指令行从 Markdown 正文中删除；无法解析的指令继续按普通文本显示，避免误吞内容。
- 为 `AssistantRenderUnit` 增加独立的 `review-comments` 类型；每条 assistant 消息最多生成一个评论单元，并放在最终回答文本之后。
- 从 `ChatThread` 向 `AssistantMessage` 传递当前会话的 `cwd` 和项目类型，用于路径显示及本地打开判断。

### 2. 评论卡片组件

在 `renderUnitDetails.tsx` 中抽取共享的 `ReviewCommentsCard`，同时服务于新解析单元和现有结构化 `reviewComments` 单元：

- 卡片头部显示评论图标和 `N comments`。
- 默认展示前三条，按 P0、P1、P2、P3、无优先级稳定排序。
- 每行使用全宽 Button，内容依次为：
  - 优先级徽标。
  - 单行截断标题。
  - 文件路径和行号；路径从左侧截断，优先保留文件名及行号。
- 悬停 600ms 后显示 HoverCard，包含完整路径、标题、正文和打开操作。
- 点击整行打开文件；补充清晰的 `aria-label`。
- 超过三条时在 CardFooter 显示“再显示 N 条评论”；展开后显示“收起评论”，并使用 `aria-expanded`。
- 正文不直接出现在列表行中，避免卡片高度失控。
- 保持附图中的深色主题、边框和间距风格，不增加新的基础组件或依赖。

### 3. 文件路径与 IPC

扩展现有 `CodexOpenLocalPathPayload`：

```ts
type CodexOpenLocalPathPayload = {
  path: string
  line?: number
  cwd?: string
}
```

- 绝对本地路径继续按现有方式打开。
- 相对路径必须同时提供绝对本地 `cwd`，由 main process 使用 Node 路径能力解析，renderer 不直接使用 Node API。
- 支持 `desktop-app/...` 和包含工作区目录名的 `dasCowork/desktop-app/...` 两种路径。
- 解析后必须仍位于工作区内；拒绝目录穿越、URL、NUL 字符及其他非本地路径。
- 远程项目中的评论仍可显示，但文件行不可点击，并通过提示说明不能作为本地文件打开。
- 行号继续显示并传入 IPC；当前阶段只保证打开文件，不新增外部编辑器精确跳转到行号的能力。

## 测试与验收

### 单元测试

- 正确解析单条和多条指令。
- 验证转义属性、优先级前缀、行号修正及去重。
- 验证普通 Markdown 顺序不变，有效指令不会显示为原始文本。
- 验证无效指令仍然可见。
- 验证 commentary 和运行中的消息不会生成评论卡片。
- 验证旧历史消息在 phase 缺失时仍能生成卡片。
- 验证相对路径解析、工作区目录名前缀、目录穿越拒绝和远程路径禁用。

### 组件测试

- 五条评论时显示 `5 comments`，默认只显示前三条。
- 评论按优先级稳定排序。
- 展开和收起按钮更新内容及 `aria-expanded`。
- 列表行不直接显示正文，HoverCard 显示完整正文。
- 点击本地评论调用 `openLocalPath`，携带路径、cwd 和起始行号。
- 现有结构化 `reviewComments` 仍通过同一组件正常渲染。

### 端到端验证

- 模拟 app-server 返回包含普通最终回答和五条 `::code-comment` 的 agent message。
- 确认原始指令不可见，普通回答保留，评论卡片正确出现并可展开。
- 执行：
  - `npm --prefix desktop-app run lint`
  - `npm --prefix desktop-app test`
  - `npm --prefix desktop-app run test:e2e -- --reporter=line`

## 明确边界与默认决定

- 本期只实现对话中的评论卡片，不接入 Diff 行内评论、`modelComments` 状态或评论持久化系统。
- 不修改 provider、app-server 或模型输出协议。
- 不实现外部编辑器精确跳转行号。
- 默认采用 `Card + Button 行 + HoverCard`，不采用 `Card + Table`。
- 卡片数量文案保持附图和参考项目中的英文 `N comments`，展开/收起使用中文。
