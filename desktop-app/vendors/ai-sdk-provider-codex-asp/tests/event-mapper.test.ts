import { describe, expect, it } from "vitest";

import { CodexEventMapper } from "../src/protocol/event-mapper";

const EMPTY_USAGE = {
    inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
    },
    outputTokens: {
        total: undefined,
        text: undefined,
        reasoning: undefined,
    },
};

describe("CodexEventMapper", () =>
{
    it("maps agent message lifecycle to text stream parts", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: { type: "agentMessage", id: "item1", text: "" },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/agentMessage/delta",
                params: { threadId: "thr", turnId: "turn", itemId: "item1", delta: "Hello" },
            },
            {
                method: "item/completed",
                params: {
                    item: { type: "agentMessage", id: "item1", text: "Hello" },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "item1" },
            { type: "text-delta", id: "item1", delta: "Hello" },
            { type: "text-end", id: "item1" },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("preserves commentary phase metadata across the agent message stream", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: {
                        type: "agentMessage",
                        id: "commentary_1",
                        text: "",
                        phase: "commentary" as const,
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/agentMessage/delta",
                params: {
                    threadId: "thr",
                    turnId: "turn",
                    itemId: "commentary_1",
                    delta: "Collecting evidence",
                },
            },
            {
                method: "item/completed",
                params: {
                    item: {
                        type: "agentMessage",
                        id: "commentary_1",
                        text: "Collecting evidence",
                        phase: "commentary" as const,
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));
        const providerMetadata = {
            "@janole/ai-sdk-provider-codex-asp": {
                turnId: "turn",
                messagePhase: "commentary",
            },
        };

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "commentary_1", providerMetadata },
            {
                type: "text-delta",
                id: "commentary_1",
                delta: "Collecting evidence",
                providerMetadata,
            },
            { type: "text-end", id: "commentary_1", providerMetadata },
        ]);
    });

    it("attaches the completed turn duration to finish metadata", () =>
    {
        const mapper = new CodexEventMapper();
        mapper.setThreadId("thr");

        const parts = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: {
                        id: "turn",
                        items: [],
                        status: "completed" as const,
                        error: null,
                        durationMs: 1250,
                    },
                },
            },
        ].flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            {
                type: "stream-start",
                warnings: [],
                providerMetadata: {
                    "@janole/ai-sdk-provider-codex-asp": { threadId: "thr", turnId: "turn" },
                },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
                providerMetadata: {
                    "@janole/ai-sdk-provider-codex-asp": {
                        threadId: "thr",
                        turnId: "turn",
                        turnDurationMs: 1250,
                    },
                },
            },
        ]);
    });

    it("maps reasoning and progress notifications to reasoning stream parts", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: { type: "reasoning", id: "reason_1", summary: [], content: [] },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/reasoning/textDelta",
                params: { threadId: "thr", turnId: "turn", itemId: "reason_1", delta: "Thinking", contentIndex: 0 },
            },
            {
                method: "item/plan/delta",
                params: { threadId: "thr", turnId: "turn", itemId: "plan_1", delta: "1. Inspect code" },
            },
            {
                method: "item/completed",
                params: {
                    item: { type: "reasoning", id: "reason_1", summary: [], content: [] },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            { type: "reasoning-start", id: "reason_1" },
            { type: "reasoning-delta", id: "reason_1", delta: "Thinking" },
            { type: "reasoning-start", id: "plan_1" },
            { type: "reasoning-delta", id: "plan_1", delta: "1. Inspect code" },
            { type: "reasoning-end", id: "reason_1" },
            { type: "reasoning-end", id: "plan_1" },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("maps fileChange lifecycle to provider-executed tool parts", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: {
                        type: "fileChange",
                        id: "file_1",
                        status: "inProgress",
                        changes: [],
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/completed",
                params: {
                    item: {
                        type: "fileChange",
                        id: "file_1",
                        status: "completed",
                        changes: [],
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "tool-call",
                toolCallId: "file_1",
                toolName: "codex_file_change",
                input: JSON.stringify({ changes: [], status: "inProgress" }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-result",
                toolCallId: "file_1",
                toolName: "codex_file_change",
                result: { item: { type: "fileChange", id: "file_1", status: "completed", changes: [] } },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("maps commandExecution to provider-executed tool-call and tool-result stream", () =>
    {
        const mapper = new CodexEventMapper();
        const commandActions = [
            { type: "search" as const, command: "rg test", query: "test", path: null },
        ];

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: {
                        type: "commandExecution",
                        id: "cmd_1",
                        command: "npm test",
                        cwd: "/project",
                        processId: null,
                        status: "inProgress",
                        commandActions,
                        aggregatedOutput: null,
                        exitCode: null,
                        durationMs: null,
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/completed",
                params: {
                    item: {
                        type: "commandExecution",
                        id: "cmd_1",
                        command: "npm test",
                        cwd: "/project",
                        processId: "123",
                        status: "completed",
                        commandActions,
                        aggregatedOutput: "PASS src/test.ts",
                        exitCode: 0,
                        durationMs: 1500,
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "tool-call",
                toolCallId: "cmd_1",
                toolName: "codex_command_execution",
                input: JSON.stringify({ command: "npm test", cwd: "/project", commandActions }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-result",
                toolCallId: "cmd_1",
                toolName: "codex_command_execution",
                result: {
                    item: {
                        type: "commandExecution",
                        id: "cmd_1",
                        command: "npm test",
                        cwd: "/project",
                        processId: "123",
                        status: "completed",
                        commandActions,
                        aggregatedOutput: "PASS src/test.ts",
                        exitCode: 0,
                        durationMs: 1500,
                    },
                },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("cleans up orphaned command tool calls on turn/completed", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: {
                        type: "commandExecution",
                        id: "cmd_orphan",
                        command: "ls -la",
                        cwd: "/tmp",
                        processId: null,
                        status: "inProgress",
                        commandActions: [],
                        aggregatedOutput: null,
                        exitCode: null,
                        durationMs: null,
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "tool-call",
                toolCallId: "cmd_orphan",
                toolName: "codex_command_execution",
                input: JSON.stringify({ command: "ls -la", cwd: "/tmp" }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-result",
                toolCallId: "cmd_orphan",
                toolName: "codex_command_execution",
                result: { error: "Tool call did not complete before turn ended" },
                isError: true,
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("maps webSearch and collabAgentToolCall to provider-executed tool parts", () =>
    {
        const mapper = new CodexEventMapper();

        // Real codex flow: item/started carries an empty placeholder (query: "",
        // action: {type:"other"}); the real query + action only arrive at
        // item/completed. The placeholder is suppressed at start and the full
        // provider-executed call + result are emitted from item/completed.
        const completedItem = {
            type: "webSearch",
            id: "ws_1",
            query: "di.gg API documentation",
            action: {
                type: "search",
                query: "di.gg API documentation",
                queries: ["di.gg API documentation", "site:di.gg api", "di.gg developer docs"],
            },
        };

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: { type: "webSearch", id: "ws_1", query: "", action: { type: "other" } },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/started",
                params: {
                    item: {
                        type: "collabAgentToolCall",
                        id: "collab_1",
                        tool: { type: "ask" },
                        status: "inProgress",
                        senderThreadId: "thr",
                        receiverThreadIds: [],
                        prompt: null,
                        agentsStates: {},
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/completed",
                params: {
                    item: completedItem,
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/completed",
                params: {
                    item: {
                        type: "collabAgentToolCall",
                        id: "collab_1",
                        tool: { type: "ask" },
                        status: "completed",
                        senderThreadId: "thr",
                        receiverThreadIds: [],
                        prompt: null,
                        agentsStates: {},
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        // The empty webSearch placeholder at item/started is suppressed; the
        // tool-call carries the real query/action from item/completed.
        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "tool-call",
                toolCallId: "collab_1",
                toolName: "codex_collab_agent",
                input: JSON.stringify({
                    tool: { type: "ask" },
                    status: "inProgress",
                    senderThreadId: "thr",
                    receiverThreadIds: [],
                }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-call",
                toolCallId: "ws_1",
                toolName: "codex_web_search",
                input: JSON.stringify({ query: completedItem.query, action: completedItem.action }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-result",
                toolCallId: "ws_1",
                toolName: "codex_web_search",
                result: { item: completedItem },
            },
            {
                type: "tool-result",
                toolCallId: "collab_1",
                toolName: "codex_collab_agent",
                result: {
                    item: {
                        type: "collabAgentToolCall",
                        id: "collab_1",
                        tool: { type: "ask" },
                        status: "completed",
                        senderThreadId: "thr",
                        receiverThreadIds: [],
                        prompt: null,
                        agentsStates: {},
                    },
                },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("maps non-text operational ThreadItems to provider-executed tool parts", () =>
    {
        const mapper = new CodexEventMapper();
        const cases = [
            {
                item: { type: "imageView", id: "image_view_1", path: "/tmp/plot.png" },
                toolName: "codex_image_view",
                input: { path: "/tmp/plot.png" },
            },
            {
                item: { type: "contextCompaction", id: "compact_1" },
                toolName: "codex_context_compaction",
                input: {},
            },
            {
                item: {
                    type: "hookPrompt",
                    id: "hook_1",
                    fragments: [{ text: "AGENTS.md instructions", hookRunId: "hook-run-1" }],
                },
                toolName: "codex_hook_prompt",
                input: { fragments: [{ text: "AGENTS.md instructions", hookRunId: "hook-run-1" }] },
            },
            {
                item: {
                    type: "subAgentActivity",
                    id: "subagent_1",
                    kind: "started",
                    agentThreadId: "thr_agent",
                    agentPath: "/repo",
                },
                toolName: "codex_sub_agent_activity",
                input: { kind: "started", agentThreadId: "thr_agent", agentPath: "/repo" },
            },
            {
                item: { type: "enteredReviewMode", id: "review_enter_1", review: "Review current diff" },
                toolName: "codex_review_mode_entered",
                input: { review: "Review current diff" },
            },
            {
                item: { type: "exitedReviewMode", id: "review_exit_1", review: "Review current diff" },
                toolName: "codex_review_mode_exited",
                input: { review: "Review current diff" },
            },
        ];

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            ...cases.flatMap(({ item }) => [
                { method: "item/started", params: { item, threadId: "thr", turnId: "turn" } },
                { method: "item/completed", params: { item, threadId: "thr", turnId: "turn" } },
            ]),
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            ...cases.flatMap(({ item, toolName, input }) => [
                {
                    type: "tool-call",
                    toolCallId: item.id,
                    toolName,
                    input: JSON.stringify(input),
                    providerExecuted: true,
                    dynamic: true,
                },
                {
                    type: "tool-result",
                    toolCallId: item.id,
                    toolName,
                    result: { item },
                },
            ]),
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("drops an abandoned webSearch placeholder that never completes", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: { type: "webSearch", id: "ws_ghost", query: "", action: { type: "other" } },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        // The placeholder is suppressed at item/started and never completes, so it
        // produces no tool-call and — crucially — no synthesized "did not complete"
        // error on turn/completed.
        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("ignores codex/event web search wrappers", () =>
    {
        const mapper = new CodexEventMapper();

        const parts = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "codex/event/web_search_begin",
                params: { threadId: "thr", turnId: "turn", msg: { call_id: "ws_dup" } },
            },
            {
                method: "codex/event/web_search_end",
                params: {
                    threadId: "thr",
                    turnId: "turn",
                    msg: { call_id: "ws_dup", query: "vitest docs", action: { type: "search", query: "vitest docs" } },
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ].flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("emits providerExecuted tool parts for dynamicToolCall in non-cross-call mode", () =>
    {
        const mapper = new CodexEventMapper(); // enableCrossCallMode() NOT called

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: {
                        type: "dynamicToolCall",
                        id: "call_nc",
                        tool: "myTool",
                        arguments: { x: 1 },
                        status: "inProgress",
                        contentItems: null,
                        success: null,
                        durationMs: null,
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/completed",
                params: {
                    item: {
                        type: "dynamicToolCall",
                        id: "call_nc",
                        tool: "myTool",
                        arguments: { x: 1 },
                        status: "completed",
                        contentItems: [{ type: "inputText", text: "result" }],
                        success: true,
                        durationMs: 10,
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "tool-call",
                toolCallId: "call_nc",
                toolName: "myTool",
                input: JSON.stringify({ x: 1 }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-result",
                toolCallId: "call_nc",
                toolName: "myTool",
                result: {
                    item: {
                        type: "dynamicToolCall",
                        id: "call_nc",
                        tool: "myTool",
                        arguments: { x: 1 },
                        status: "completed",
                        contentItems: [{ type: "inputText", text: "result" }],
                        success: true,
                        durationMs: 10,
                    },
                },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("mapper is silent for dynamicToolCall lifecycle in cross-call mode", () =>
    {
        const mapper = new CodexEventMapper();
        mapper.enableCrossCallMode();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: {
                        type: "dynamicToolCall",
                        id: "call_1",
                        tool: "readGithubFile",
                        arguments: { owner: "acme", repo: "widgets", path: "README.md" },
                        status: "inProgress",
                        contentItems: null,
                        success: null,
                        durationMs: null,
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            // item/tool/call fires for the same ID — mapper must stay silent (dedup via _sdkDynamicToolCallIds)
            {
                method: "item/tool/call",
                params: {
                    threadId: "thr",
                    turnId: "turn",
                    callId: "call_1",
                    tool: "readGithubFile",
                    arguments: { owner: "acme", repo: "widgets", path: "README.md" },
                },
            },
            {
                method: "item/completed",
                params: {
                    item: {
                        type: "dynamicToolCall",
                        id: "call_1",
                        tool: "readGithubFile",
                        arguments: { owner: "acme", repo: "widgets", path: "README.md" },
                        status: "completed",
                        contentItems: [{ type: "inputText", text: "file content" }],
                        success: true,
                        durationMs: 123,
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        // In cross-call mode the mapper is fully silent for dynamicToolCall items
        // (including the item/tool/call dedup). The cross-call handler in model.ts
        // emits the definitive tool-call (no providerExecuted) + finish.
        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("maps item/tool/call to provider-executed tool-call", () =>
    {
        const mapper = new CodexEventMapper();

        const parts = mapper.map({
            method: "item/tool/call",
            params: {
                threadId: "thr",
                turnId: "turn",
                callId: "call_2",
                tool: "lookup",
                arguments: { id: "ABC-1" },
            },
        });

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "tool-call",
                toolCallId: "call_2",
                toolName: "lookup",
                input: JSON.stringify({ id: "ABC-1" }),
                providerExecuted: true,
                dynamic: true,
            },
        ]);
    });

    it("populates finish usage from thread/tokenUsage/updated", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: { type: "agentMessage", id: "item1", text: "" },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/agentMessage/delta",
                params: { threadId: "thr", turnId: "turn", itemId: "item1", delta: "Hi" },
            },
            {
                method: "thread/tokenUsage/updated",
                params: {
                    threadId: "thr",
                    turnId: "turn",
                    tokenUsage: {
                        total: { totalTokens: 2000, inputTokens: 1500, cachedInputTokens: 500, outputTokens: 500, reasoningOutputTokens: 100 },
                        last: { totalTokens: 800, inputTokens: 600, cachedInputTokens: 200, outputTokens: 200, reasoningOutputTokens: 50 },
                        modelContextWindow: 128000,
                    },
                },
            },
            {
                method: "item/completed",
                params: {
                    item: { type: "agentMessage", id: "item1", text: "Hi" },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        const finish = parts.find((p) => p.type === "finish");
        expect(finish).toEqual({
            type: "finish",
            finishReason: { unified: "stop", raw: "completed" },
            usage: {
                inputTokens: {
                    total: 600,
                    noCache: undefined,
                    cacheRead: 200,
                    cacheWrite: undefined,
                },
                outputTokens: {
                    total: 200,
                    text: undefined,
                    reasoning: 50,
                },
            },
        });
    });

    it("maps mcpToolCall item/started and item/completed with nested shape", () =>
    {
        const mapper = new CodexEventMapper();
        const startedItem = {
            type: "mcpToolCall",
            id: "mcp_1",
            server: "docs-server",
            tool: "search",
            status: "inProgress",
            arguments: { query: "test" },
            appContext: {
                connectorId: "docs-connector",
                linkId: null,
                resourceUri: "app://docs",
            },
            mcpAppResourceUri: "app://docs",
            pluginId: "docs-plugin",
            result: null,
            error: null,
            durationMs: null,
        };

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: startedItem,
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/mcpToolCall/progress",
                params: { threadId: "thr", turnId: "turn", itemId: "mcp_1", message: "Searching..." },
            },
            {
                method: "item/completed",
                params: {
                    item: {
                        type: "mcpToolCall",
                        id: "mcp_1",
                        server: "docs-server",
                        tool: "search",
                        status: "completed",
                        arguments: { query: "test" },
                        appContext: {
                            connectorId: "docs-connector",
                            linkId: null,
                            resourceUri: "app://docs",
                        },
                        mcpAppResourceUri: "app://docs",
                        pluginId: "docs-plugin",
                        result: { content: [{ type: "text", text: "found" }], isError: false },
                        error: null,
                        durationMs: 250,
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "tool-call",
                toolCallId: "mcp_1",
                toolName: "mcp:docs-server/search",
                input: JSON.stringify({ query: "test" }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-result",
                toolCallId: "mcp_1",
                toolName: "mcp:docs-server/search",
                result: { item: startedItem },
                preliminary: true,
            },
            {
                type: "tool-result",
                toolCallId: "mcp_1",
                toolName: "mcp:docs-server/search",
                result: { output: "Searching...", item: startedItem },
                preliminary: true,
            },
            {
                type: "tool-result",
                toolCallId: "mcp_1",
                toolName: "mcp:docs-server/search",
                result: {
                    item: {
                        type: "mcpToolCall",
                        id: "mcp_1",
                        server: "docs-server",
                        tool: "search",
                        status: "completed",
                        arguments: { query: "test" },
                        appContext: {
                            connectorId: "docs-connector",
                            linkId: null,
                            resourceUri: "app://docs",
                        },
                        mcpAppResourceUri: "app://docs",
                        pluginId: "docs-plugin",
                        result: { content: [{ type: "text", text: "found" }], isError: false },
                        error: null,
                        durationMs: 250,
                    },
                },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("maps sleep item lifecycle to provider-executed tool parts", () =>
    {
        const mapper = new CodexEventMapper();
        const item = { type: "sleep", id: "sleep_1", durationMs: 5000 };

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            { method: "item/started", params: { item, threadId: "thr", turnId: "turn" } },
            { method: "item/completed", params: { item, threadId: "thr", turnId: "turn" } },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "tool-call",
                toolCallId: "sleep_1",
                toolName: "codex_sleep",
                input: JSON.stringify({ durationMs: 5000 }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-result",
                toolCallId: "sleep_1",
                toolName: "codex_sleep",
                result: { item },
                preliminary: true,
            },
            {
                type: "tool-result",
                toolCallId: "sleep_1",
                toolName: "codex_sleep",
                result: { item },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("maps automatic approval review notifications to provider-executed tool parts", () =>
    {
        const mapper = new CodexEventMapper();
        const review = {
            status: "inProgress",
            riskLevel: "high",
            userAuthorization: "low",
            rationale: "Command can delete files",
        };
        const action = {
            type: "command",
            source: "shell",
            command: "rm -rf build",
            cwd: "/repo",
        };
        const startedItem = {
            id: "review_1",
            type: "automaticApprovalReview",
            status: "inProgress",
            outcome: "inProgress",
            startedAtMs: 1,
            targetItemId: "cmd_1",
            review,
            action,
        };
        const completedReview = { ...review, status: "denied" };
        const completedItem = {
            ...startedItem,
            status: "completed",
            outcome: "denied",
            completedAtMs: 2,
            review: completedReview,
            decisionSource: "agent",
        };

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/autoApprovalReview/started",
                params: {
                    threadId: "thr",
                    turnId: "turn",
                    startedAtMs: 1,
                    reviewId: "review_1",
                    targetItemId: "cmd_1",
                    review,
                    action,
                },
            },
            {
                method: "item/autoApprovalReview/completed",
                params: {
                    threadId: "thr",
                    turnId: "turn",
                    startedAtMs: 1,
                    completedAtMs: 2,
                    reviewId: "review_1",
                    targetItemId: "cmd_1",
                    decisionSource: "agent",
                    review: completedReview,
                    action,
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "tool-call",
                toolCallId: "review_1",
                toolName: "codex_automatic_approval_review",
                input: JSON.stringify({
                    targetItemId: "cmd_1",
                    review,
                    action,
                    startedAtMs: 1,
                }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-result",
                toolCallId: "review_1",
                toolName: "codex_automatic_approval_review",
                result: { item: startedItem },
                preliminary: true,
            },
            {
                type: "tool-result",
                toolCallId: "review_1",
                toolName: "codex_automatic_approval_review",
                result: { item: completedItem },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("ignores legacy turn diff wrapper notifications", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn_1" } } },
            {
                method: "codex/event/turn_diff",
                params: {
                    id: "turn_1",
                    msg: { type: "turn_diff", unified_diff: "@@ -1,1 +1,1 @@" },
                    conversationId: "thr",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn_1", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("maps reasoning section break via canonical event and skips wrapper duplicate", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn_1" } } },
            {
                method: "item/reasoning/summaryTextDelta",
                params: {
                    threadId: "thr",
                    turnId: "turn_1",
                    itemId: "rs_1",
                    delta: "First section",
                },
            },
            {
                method: "item/reasoning/summaryPartAdded",
                params: {
                    threadId: "thr",
                    turnId: "turn_1",
                    itemId: "rs_1",
                    summaryIndex: 1,
                },
            },
            {
                // Wrapper duplicate of summaryPartAdded — should be ignored.
                method: "codex/event/agent_reasoning_section_break",
                params: {
                    id: "turn_1",
                    msg: {
                        type: "agent_reasoning_section_break",
                        item_id: "rs_1",
                        summary_index: 2,
                    },
                    conversationId: "thr",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn_1", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        // Only one "\n\n" — the wrapper duplicate is skipped.
        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            { type: "reasoning-start", id: "rs_1" },
            { type: "reasoning-delta", id: "rs_1", delta: "First section" },
            { type: "reasoning-delta", id: "rs_1", delta: "\n\n" },
            { type: "reasoning-end", id: "rs_1" },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("ignores codex/event/agent_reasoning wrapper events", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn_ar" } } },
            {
                method: "codex/event/agent_reasoning",
                params: {
                    id: "turn_ar",
                    msg: { type: "agent_reasoning", text: "**Planning update**" },
                    conversationId: "thr",
                },
            },
            {
                method: "codex/event/agent_reasoning",
                params: {
                    id: "turn_ar",
                    msg: { type: "agent_reasoning", text: "Looking at event counts." },
                    conversationId: "thr",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn_ar", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("falls back to item/completed agent text when no deltas were emitted", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn_fb" } } },
            {
                method: "item/started",
                params: {
                    item: { type: "agentMessage", id: "msg_fb", text: "" },
                    threadId: "thr",
                    turnId: "turn_fb",
                },
            },
            // No item/agentMessage/delta events arrive.
            {
                method: "item/completed",
                params: {
                    item: { type: "agentMessage", id: "msg_fb", text: "Final answer text", phase: "final_answer" },
                    threadId: "thr",
                    turnId: "turn_fb",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn_fb", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "msg_fb" },
            // Fallback: full text emitted from item/completed since no deltas arrived.
            {
                type: "text-delta",
                id: "msg_fb",
                delta: "Final answer text",
                providerMetadata: {
                    "@janole/ai-sdk-provider-codex-asp": {
                        turnId: "turn_fb",
                        messagePhase: "final_answer",
                    },
                },
            },
            {
                type: "text-end",
                id: "msg_fb",
                providerMetadata: {
                    "@janole/ai-sdk-provider-codex-asp": {
                        turnId: "turn_fb",
                        messagePhase: "final_answer",
                    },
                },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("maps plan updates as tool-call/tool-result pairs", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn_plan" } } },
            {
                method: "turn/plan/updated",
                params: {
                    threadId: "thr",
                    turnId: "turn_plan",
                    explanation: "Updating files",
                    plan: [
                        { step: "Read config", status: "completed" },
                        { step: "Update mapper", status: "inProgress" },
                    ],
                },
            },
            {
                method: "turn/plan/updated",
                params: {
                    threadId: "thr",
                    turnId: "turn_plan",
                    explanation: "Almost done",
                    plan: [
                        { step: "Read config", status: "completed" },
                        { step: "Update mapper", status: "completed" },
                    ],
                },
            },
            // Wrapper duplicate — should be silently dropped.
            {
                method: "codex/event/plan_update",
                params: {
                    id: "turn_plan",
                    msg: { type: "plan_update", plan: [] },
                    conversationId: "thr",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn_plan", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            // First plan update: tool-call + tool-result
            {
                type: "tool-call",
                toolCallId: "plan:turn_plan:1",
                toolName: "codex_todo_list",
                input: JSON.stringify({ explanation: "Updating files" }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-result",
                toolCallId: "plan:turn_plan:1",
                toolName: "codex_todo_list",
                result: {
                    item: {
                        id: "plan:turn_plan:1",
                        type: "todoList",
                        status: "inProgress",
                        explanation: "Updating files",
                        items: [
                            { label: "Read config", status: "completed" },
                            { label: "Update mapper", status: "inProgress" },
                        ],
                    },
                },
            },
            // Second plan update: new tool-call + tool-result pair
            {
                type: "tool-call",
                toolCallId: "plan:turn_plan:2",
                toolName: "codex_todo_list",
                input: JSON.stringify({ explanation: "Almost done" }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-result",
                toolCallId: "plan:turn_plan:2",
                toolName: "codex_todo_list",
                result: {
                    item: {
                        id: "plan:turn_plan:2",
                        type: "todoList",
                        status: "inProgress",
                        explanation: "Almost done",
                        items: [
                            { label: "Read config", status: "completed" },
                            { label: "Update mapper", status: "completed" },
                        ],
                    },
                },
            },
            // codex/event/plan_update wrapper produces nothing.
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("maps turn diff updates to capped turnDiff tool items with thread cwd", () =>
    {
        const mapper = new CodexEventMapper();
        mapper.setThreadCwd("/repo");
        const diff = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${"+new\n".repeat(12_000)}`;

        const parts = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn_diff" } } },
            {
                method: "turn/diff/updated",
                params: {
                    threadId: "thr",
                    turnId: "turn_diff",
                    diff,
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn_diff", items: [], status: "completed" as const, error: null },
                },
            },
        ].flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "tool-call",
                toolCallId: "turn-diff:turn_diff:1",
                toolName: "codex_turn_diff",
                input: JSON.stringify({ turnId: "turn_diff" }),
                providerExecuted: true,
                dynamic: true,
            },
            {
                type: "tool-result",
                toolCallId: "turn-diff:turn_diff:1",
                toolName: "codex_turn_diff",
                result: {
                    item: {
                        id: "turn-diff:turn_diff:1",
                        type: "turnDiff",
                        status: "inProgress",
                        cwd: "/repo",
                        diff: diff.slice(0, 50_000),
                        truncated: true,
                        originalLength: diff.length,
                    },
                },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("suppresses plan updates when emitPlanUpdates is false", () =>
    {
        const mapper = new CodexEventMapper({ emitPlanUpdates: false });

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn_plan2" } } },
            {
                method: "turn/plan/updated",
                params: {
                    threadId: "thr",
                    turnId: "turn_plan2",
                    explanation: "Planning",
                    plan: [{ step: "Do stuff", status: "inProgress" }],
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn_plan2", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        // No tool-call/tool-result parts — plan updates are suppressed.
        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("ignores codex/event MCP wrapper events", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn_mcp" } } },
            {
                method: "codex/event/mcp_tool_call_begin",
                params: {
                    id: "turn_mcp",
                    msg: {
                        type: "mcp_tool_call_begin",
                        call_id: "call_mcp_1",
                        invocation: {
                            server: "github",
                            tool: "get_file_contents",
                            arguments: { owner: "acme", repo: "test", path: "README.md" },
                        },
                    },
                    conversationId: "thr",
                },
            },
            {
                method: "codex/event/mcp_tool_call_end",
                params: {
                    id: "turn_mcp",
                    msg: {
                        type: "mcp_tool_call_end",
                        call_id: "call_mcp_1",
                        invocation: {
                            server: "github",
                            tool: "get_file_contents",
                            arguments: { owner: "acme", repo: "test", path: "README.md" },
                        },
                        result: {
                            Ok: {
                                content: [
                                    { type: "text", text: "# Test Repo" },
                                ],
                            },
                        },
                    },
                    conversationId: "thr",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn_mcp", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("emits file stream part for imageGeneration item", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: {
                        type: "imageGeneration",
                        id: "img_1",
                        status: "inProgress",
                        revisedPrompt: null,
                        result: "",
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/completed",
                params: {
                    item: {
                        type: "imageGeneration",
                        id: "img_1",
                        status: "completed",
                        revisedPrompt: "a beautiful mountain landscape at sunrise",
                        result: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "file",
                mediaType: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                providerMetadata: {
                    "@janole/ai-sdk-provider-codex-asp": {
                        turnId: "turn",
                        revisedPrompt: "a beautiful mountain landscape at sunrise",
                    },
                },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("emits file stream part without providerMetadata when revisedPrompt is null", () =>
    {
        const mapper = new CodexEventMapper();

        const events = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/completed",
                params: {
                    item: {
                        type: "imageGeneration",
                        id: "img_2",
                        status: "completed",
                        revisedPrompt: null,
                        result: "abc123",
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "turn/completed",
                params: {
                    threadId: "thr",
                    turn: { id: "turn", items: [], status: "completed" as const, error: null },
                },
            },
        ];

        const parts = events.flatMap((event) => mapper.map(event));

        expect(parts).toEqual([
            { type: "stream-start", warnings: [] },
            {
                type: "file",
                mediaType: "image/png",
                data: "abc123",
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: EMPTY_USAGE,
            },
        ]);
    });

    it("emits an error stream part when a completed turn carries an error", () =>
    {
        const mapper = new CodexEventMapper();

        const parts = mapper.map({
            method: "turn/completed",
            params: {
                threadId: "thread-1",
                turn: {
                    id: "turn-1",
                    items: [],
                    itemsView: "notLoaded",
                    error: {
                        message: "The free quota has been exhausted.",
                        codexErrorInfo: "usageLimitExceeded",
                        additionalDetails: null,
                    },
                    status: "failed",
                    startedAt: 1,
                    completedAt: 2,
                    durationMs: 1,
                },
            },
        });

        expect(parts.map((part) => part.type)).toEqual(["stream-start", "error", "finish"]);
        const errorPart = parts.find((part) => part.type === "error");
        expect(errorPart?.error).toBeInstanceOf(Error);
        expect(errorPart?.error).toMatchObject({ message: "The free quota has been exhausted." });
    });
});
