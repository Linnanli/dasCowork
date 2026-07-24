# Test Plan 2 U4 证据记录补齐计划

## 1. 需求摘要

本计划只补齐 `.omx/plans/test-plan2-unfinished-items-development-plan.md` 的 U4“证据与范围真实性”记录缺口，不改变 U1–U3 已实现的行为、测试语义或 coverage 状态。原计划要求完整 HEAD、`git status --short`、所有受影响文件逐文件 SHA-256、完整命令与退出码，以及两个定向 E2E 的独立产物目录（原计划第 3 节 U4，见 `test-plan2-unfinished-items-development-plan.md:71-79`；第 6 节的命令口径见 `:154-234`）。

审查确认：U1–U3 及两组定向 E2E 已有实现和结果，但 `docs/test-plan2.md:83-105` 只概述非净工作树、只列 source/test/manifest 指纹，并未逐项保留完整命令和退出码。因此本计划的可交付物是一个可复核的、单独的验证账本，以及指向它的简短文档索引。

### 范围与约束

- 只修改 `.omx/` 计划/证据文件与 `docs/test-plan2.md` 的验证记录；不修改产品、preload、renderer、provider、测试代码、manifest 或依赖。
- 只重跑原计划已列出的受影响模块验证；不执行 Provider/Desktop 全量门禁、全量 Mock E2E、`test:e2e:stability`、同 SHA CI 或 packaged real-LLM R01–R06（原计划 `:34-42,236-245`）。
- R01–R06 必须继续是 `partial`，不得用本地 Mock E2E 重新定义为发布验收（原计划 `:9-13,74-76`）。
- 禁止修改 `codex/codex-rs/app-server/`；若边界检查发现任何改动，停止并保留 U4 未完成（原计划 `:12,78,257-263`）。

## 2. 决策：唯一自排除的验证账本

新建 `.omx/evidence/test-plan2-u4-verification-ledger-2026-07-23.md` 作为唯一的“记录容器”。它不对自身内容求 SHA-256；除此之外，逐文件记录本轮最终受影响的计划、文档、source、test 和 manifest 的 SHA-256，并记录完整 `git status --short --untracked-files=all` 输出。

这是必要且可审计的例外：任何文件都不可能在自身内容中稳定地记录自己的加密哈希。账本先以固定路径创建，使最终 `git status` 能包含该 untracked 账本；随后冻结其他受影响文件、计算它们的哈希，最后只写入账本。`docs/test-plan2.md` 和两个计划文件不再被排除，均属于账本哈希集合。

## 3. 可测试验收标准

1. `docs/test-plan2.md` 的 2026-07-23 记录链接到唯一账本，且不再声称 docs/plan 因为“记录容器”而被排除（当前不完整措辞在 `docs/test-plan2.md:83-95`）。
2. 账本包含完整 `HEAD`、完整 `git status --short --untracked-files=all` 输出、生成时间与工作目录；状态中可见账本本身，且账本是唯一明示的自排除项。
3. 账本逐行列出以下最终 SHA-256，并与 `shasum -a 256` 的重新计算逐字一致：
   - `.omx/plans/test-plan2-unfinished-items-development-plan.md`；
   - 本补齐计划；
   - `docs/test-plan2.md`；
   - `desktop-app/tests/e2e/support/messagePortStreamProbes.ts`、`messagePortStreamProbes.test.ts`、`app.ts`、`app.test.ts`、`fault-injection.e2e.ts`；
   - `desktop-app/src/preload/chatStreamBridge.test.ts`、`desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts`、`desktop-app/tests/test-plan-coverage.json`。
4. 账本为每个本轮实际执行的验证命令记录：完整命令、工作目录、开始/结束时间、退出码和可判读摘要（例如 `34/34`、`14/14`、`134/134`、`10/10`）。
5. 定向验证全部以退出码 0 完成：原计划中的 ESLint、Prettier、四个 Vitest 文件、coverage validator、`test:plan-coverage`，以及两个互不覆盖输出目录的 10 次 E2E（原计划 `:154-206`）。
6. 账本记录 manifest 分组统计为 scenarios `134 covered`、mockE2E `12 covered`、releaseE2E `6 partial`，并列出未执行的全量/CI/发布项。
7. `git diff --check HEAD` 退出码为 0；`git diff --name-only HEAD -- codex/codex-rs/app-server` 和 `git status --short --untracked-files=all -- codex/codex-rs/app-server` 都没有输出。

## 4. 实施步骤

### 步骤 1：固定账本边界，再冻结记录文本

涉及文件：

- `.omx/evidence/test-plan2-u4-verification-ledger-2026-07-23.md`（新建）；
- `docs/test-plan2.md:81-105`；
- `.omx/plans/test-plan2-unfinished-items-development-plan.md:71-79`（只在需要时追加账本链接和 U4 已核验状态）；
- `.omx/plans/test-plan2-u4-evidence-record-closure-plan.md`。

1. 先创建账本的固定路径与简短自排除说明；此时不写运行结果或哈希。
2. 更新 `docs/test-plan2.md`：保留已有测试结果与明确排除项，但将其改为链接账本，不再使用“文档与计划本身不纳入自身哈希”的表述。
3. 若要在原计划中写入 U4 状态或链接，必须在哈希采集前完成；之后禁止修改上述三个非账本文件。
4. 确认账本是唯一可以不列自身哈希的文件；它仍必须出现在随后捕获的完整工作区状态中。

完成条件：后续写账本不会再要求改动 docs 或任一计划，因此 docs/plan 的哈希可成为最终、可复算的证据。

### 步骤 2：按原范围重新执行验证并捕获每个退出码

从原计划指定的工作目录和参数执行，不增加 retry、不改变 `--grep`，并使用两个不同的 `--output` 目录（原计划 `:192-206`）。每一条命令由同一记录器包裹，记录原样 argv、cwd、UTC 开始/结束时间、stdout/stderr 摘要和退出码；失败即停止，保留失败输出，不继续写“通过”结论。

在 `desktop-app/` 执行：

```bash
npx eslint tests/e2e/support/messagePortStreamProbes.ts tests/e2e/support/messagePortStreamProbes.test.ts tests/e2e/support/app.ts tests/e2e/support/app.test.ts tests/e2e/fault-injection.e2e.ts src/preload/chatStreamBridge.test.ts src/renderer/src/lib/ElectronIpcChatTransport.test.ts
npx prettier --check tests/e2e/support/messagePortStreamProbes.ts tests/e2e/support/messagePortStreamProbes.test.ts tests/e2e/support/app.ts tests/e2e/support/app.test.ts tests/e2e/fault-injection.e2e.ts src/preload/chatStreamBridge.test.ts src/renderer/src/lib/ElectronIpcChatTransport.test.ts tests/test-plan-coverage.json ../docs/test-plan2.md ../.omx/plans/test-plan2-unfinished-items-development-plan.md ../.omx/plans/test-plan2-u4-evidence-record-closure-plan.md ../.omx/evidence/test-plan2-u4-verification-ledger-2026-07-23.md
npx vitest run tests/e2e/support/messagePortStreamProbes.test.ts tests/e2e/support/app.test.ts src/preload/chatStreamBridge.test.ts src/renderer/src/lib/ElectronIpcChatTransport.test.ts
npx playwright test tests/e2e/fault-injection.e2e.ts --grep 'cleans twelve real MessagePort streams' --repeat-each=10 --workers=1 --retries=0 --reporter=line --output test-results/message-port-probes
npx playwright test tests/e2e/chat.e2e.ts --grep 'preserves a workspace reference, local file, folder and image after conversation switch and reload' --repeat-each=10 --workers=1 --retries=0 --reporter=line --output test-results/chat-attachments
```

从仓库根目录执行：

```bash
node --test desktop-app/scripts/tests/verify-test-plan-coverage.node-test.mjs
npm --prefix desktop-app run test:plan-coverage
node -e 'const fs=require("node:fs");const m=JSON.parse(fs.readFileSync("desktop-app/tests/test-plan-coverage.json","utf8"));for(const [label,rows] of [["scenarios",m.scenarios],["mockE2E",m.mockE2E],["releaseE2E",m.releaseE2E]]){const counts=rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});console.log(label,rows.length,counts)}'
git diff --check HEAD
git diff --name-only HEAD -- codex/codex-rs/app-server
git status --short --untracked-files=all -- codex/codex-rs/app-server
```

完成条件：所有上述退出码为 0；两个 path-scoped app-server 命令输出为空；E2E 的 `.last-run.json` 均为 `passed` 且 `failedTests` 为空。

### 步骤 3：捕获最终状态和哈希，再写入账本

1. 确认步骤 1 的 docs/plan 已冻结后，执行并原样保存：

```bash
git rev-parse HEAD
git status --short --untracked-files=all
shasum -a 256 .omx/plans/test-plan2-unfinished-items-development-plan.md .omx/plans/test-plan2-u4-evidence-record-closure-plan.md docs/test-plan2.md desktop-app/tests/e2e/support/messagePortStreamProbes.ts desktop-app/tests/e2e/support/messagePortStreamProbes.test.ts desktop-app/tests/e2e/support/app.ts desktop-app/tests/e2e/support/app.test.ts desktop-app/tests/e2e/fault-injection.e2e.ts desktop-app/src/preload/chatStreamBridge.test.ts desktop-app/src/renderer/src/lib/ElectronIpcChatTransport.test.ts desktop-app/tests/test-plan-coverage.json
```

2. 将步骤 2 和步骤 3 的每条命令均记录为账本条目：完整命令、cwd、开始/结束时间、退出码和结果摘要；另执行并记录：

```bash
node -e 'const fs=require("node:fs");for(const file of ["desktop-app/test-results/message-port-probes/.last-run.json","desktop-app/test-results/chat-attachments/.last-run.json"]){const run=JSON.parse(fs.readFileSync(file,"utf8"));if(run.status!=="passed"||run.failedTests.length!==0)throw new Error(`${file} is not a clean pass`);console.log(`${file}: passed, failedTests=0`)}'
find desktop-app/test-results/message-port-probes -mindepth 1 -maxdepth 1 -type d | wc -l
find desktop-app/test-results/chat-attachments -mindepth 1 -maxdepth 1 -type d | wc -l
```

3. 将步骤 2 的命令条目、步骤 3 的完整输出、E2E 产物路径和排除项写入账本。写账本本身后不再修改任何被哈希文件。
4. 用同一 `shasum` 文件列表重算一次，与账本逐行比较；只要有一个不一致，重新从步骤 1 冻结文本，而不是手改哈希。
5. 在账本中记录两个 `.last-run.json` 均为 `passed`、`failedTests=0`，以及两个输出目录均为 10 个运行目录。

完成条件：账本中的 status 与哈希经独立重算完全匹配；账本明确说明自身为唯一自排除容器，而不是遗漏。

### 步骤 4：独立审查与完成判定

由未编写账本的审查者只读复核：

1. 账本链接存在，且 docs、原计划、补齐计划的哈希均被列出；
2. 完整 `git status` 不被摘要替代；
3. 每条实际运行命令都有 cwd、完整参数、退出码和结果摘要；
4. R01–R06 仍为 `partial`，所有排除项未被隐瞒；
5. app-server 的 diff/status 两项检查为空。

只有审查者给出“U4 完成”后，才把原计划的完成结论从“U1–U3 已完成、U4 记录待补”更新为“受影响模块的本地证据缺口已闭环”。

## 5. 风险与缓解

| 风险                                  | 缓解                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| 修改 docs/plan 后再求哈希导致账本失效 | 先冻结所有非账本文本；账本最后写入；对相同清单二次 `shasum` 比较。                       |
| 把账本自身遗漏误解为漏证据            | 在账本头部声明唯一自排除原因，并确保它出现在完整 `git status` 中。                       |
| 非净工作树使结果被误解为同 SHA CI     | 完整保留 `git status --short --untracked-files=all`，明确说明未运行 CI、未形成固定提交。 |
| 重跑 E2E 覆盖或清理另一组产物         | 固定并保留 `message-port-probes` 与 `chat-attachments` 两个不同的 `--output` 路径。      |
| 范围扩大到发布或全量门禁              | 命令白名单仅含本计划第 4 步；R01–R06、全量/CI 命令列为明确未执行。                       |

## 6. 停止条件

- 任一受影响模块命令非零、任一 10 次 E2E 出现失败、coverage 分组偏离 `134/12/6`，或 app-server 路径出现变更：停止，账本记录失败事实，不宣称 U4 完成。
- 若修改 docs、原计划或本补齐计划后无法保持其哈希与账本一致：停止在步骤 3，重新冻结文本并完整重采集，不手工修补 hash。
- 不以旧 `.last-run.json` 替代本轮命令退出码，也不以一次重试替代任意一次 10 次运行失败。
