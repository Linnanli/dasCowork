import { describe, expect, it } from "vitest";

import {
    type CodexThreadForUi,
    type LoadedToolThreadItem,
    mapCodexThreadItemToUiPart,
    mapCodexThreadToUiMessages,
    toolInvocationForItem,
} from "../src";
import { unifiedDiffForFileChangeBatches } from "../src/protocol/turn-diff";
import type { ThreadItem } from "../src/protocol/types";

describe("history mapper", () =>
{
    it("maps a full thread history to UI messages without dropping tool items", () =>
    {
        const commandActions = [
            { type: "read" as const, command: "cat package.json", name: "cat", path: "/repo/package.json" },
        ];
        const commandItem = {
            type: "commandExecution",
            id: "cmd_1",
            command: "npm test",
            cwd: "/repo",
            processId: null,
            source: "agent",
            status: "completed",
            commandActions,
            aggregatedOutput: "ok",
            exitCode: 0,
            durationMs: 1200,
        } satisfies Extract<ThreadItem, { type: "commandExecution" }>;
        const thread = {
            id: "thr",
            cwd: "/repo",
            turns: [
                {
                    id: "turn_1",
                    items: [
                        {
                            type: "userMessage",
                            id: "user_1",
                            clientId: "client_1",
                            content: [{ type: "text", text: "Run tests", text_elements: [] }],
                        },
                        commandItem,
                        {
                            type: "agentMessage",
                            id: "agent_1",
                            text: "Tests pass",
                            phase: null,
                            memoryCitation: null,
                        },
                    ],
                    itemsView: "full",
                    status: "completed",
                    error: null,
                    startedAt: null,
                    completedAt: null,
                    durationMs: null,
                },
            ],
        } satisfies CodexThreadForUi;

        expect(mapCodexThreadToUiMessages(thread)).toEqual([
            {
                id: "client_1",
                role: "user",
                parts: [{ type: "text", text: "Run tests", state: "done" }],
            },
            {
                id: "assistant:turn_1:cmd_1",
                role: "assistant",
                parts: [
                    {
                        type: "dynamic-tool",
                        toolName: "codex_command_execution",
                        toolCallId: "cmd_1",
                        state: "output-available",
                        input: { command: "npm test", cwd: "/repo", commandActions },
                        output: { item: commandItem },
                        providerExecuted: true,
                    },
                    { type: "text", text: "Tests pass", state: "done" },
                ],
            },
        ]);
    });

    it("rebuilds a historical turn diff from persisted file changes", () =>
    {
        const fileChange = {
            type: "fileChange",
            id: "file_1",
            status: "completed",
            changes: [
                { path: "notes.txt", kind: { type: "add" }, diff: "first line\nsecond line\n" },
                {
                    path: "src/app.ts",
                    kind: { type: "update", move_path: null },
                    diff: "@@ -1 +1 @@\n-before\n+after\n",
                },
                { path: "obsolete.txt", kind: { type: "delete" }, diff: "unused\n" },
            ],
        } satisfies Extract<ThreadItem, { type: "fileChange" }>;
        const thread = {
            id: "thr",
            cwd: "/repo",
            turns: [
                {
                    id: "turn_1",
                    items: [fileChange],
                    itemsView: "full",
                    status: "completed",
                    error: null,
                    startedAt: null,
                    completedAt: null,
                    durationMs: null,
                },
            ],
        } satisfies CodexThreadForUi;

        expect(mapCodexThreadToUiMessages(thread)).toEqual([
            {
                id: "assistant:turn_1:file_1",
                role: "assistant",
                parts: [
                    {
                        type: "dynamic-tool",
                        toolName: "codex_file_change",
                        toolCallId: "file_1",
                        state: "output-available",
                        input: { changes: fileChange.changes, status: "completed" },
                        output: { item: fileChange },
                        providerExecuted: true,
                    },
                    {
                        type: "dynamic-tool",
                        toolName: "codex_turn_diff",
                        toolCallId: "turn-diff:turn_1",
                        state: "output-available",
                        input: { turnId: "turn_1" },
                        output: {
                            item: {
                                id: "turn-diff:turn_1",
                                type: "turnDiff",
                                status: "completed",
                                cwd: "/repo",
                                diff: [
                                    "diff --git a/notes.txt b/notes.txt",
                                    "new file mode 100644",
                                    "--- /dev/null",
                                    "+++ b/notes.txt",
                                    "@@ -0,0 +1,2 @@",
                                    "+first line",
                                    "+second line",
                                    "",
                                    "diff --git a/src/app.ts b/src/app.ts",
                                    "--- a/src/app.ts",
                                    "+++ b/src/app.ts",
                                    "@@ -1 +1 @@",
                                    "-before",
                                    "+after",
                                    "",
                                    "diff --git a/obsolete.txt b/obsolete.txt",
                                    "deleted file mode 100644",
                                    "--- a/obsolete.txt",
                                    "+++ /dev/null",
                                    "@@ -1,1 +0,0 @@",
                                    "-unused",
                                    "",
                                ].join("\n"),
                                truncated: false,
                            },
                        },
                        providerExecuted: true,
                    },
                ],
            },
        ]);
    });

    it("coalesces only updates to the same file in the same working directory", () =>
    {
        const change = (diff: string) => ({
            path: "src/app.ts",
            kind: { type: "update" as const, move_path: null },
            diff,
        });

        expect(unifiedDiffForFileChangeBatches([
            {
                cwd: "/repo/a",
                changes: [
                    change("@@ -1 +1 @@\n-before\n+after\n"),
                    change("@@ -3 +3 @@\n-old\n+new\n"),
                ],
            },
            {
                cwd: "/repo/b",
                changes: [change("@@ -1 +1 @@\n-before-b\n+after-b\n")],
            },
        ])).toBe([
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1 @@",
            "-before",
            "+after",
            "@@ -3 +3 @@",
            "-old",
            "+new",
            "",
            "diff --git a/src/app.ts b/src/app.ts",
            "--- a/src/app.ts",
            "+++ b/src/app.ts",
            "@@ -1 +1 @@",
            "-before-b",
            "+after-b",
            "",
        ].join("\n"));
    });

    it("uses the shared extractor output for history dynamic-tool parts", () =>
    {
        const item = {
            type: "subAgentActivity",
            id: "subagent_1",
            kind: "started",
            agentThreadId: "thr_agent",
            agentPath: "/repo",
        } satisfies Extract<ThreadItem, { type: "subAgentActivity" }>;

        const invocation = toolInvocationForItem(item);
        expect(invocation).not.toBeNull();
        expect(mapCodexThreadItemToUiPart(item)).toEqual({
            type: "dynamic-tool",
            toolName: invocation?.toolName,
            toolCallId: invocation?.toolCallId,
            state: "output-available",
            input: invocation?.input,
            output: invocation?.result,
            providerExecuted: true,
        });
    });

    it("uses the first source item ID for assistant segments separated by a user message", () =>
    {
        const subAgentActivity = {
            type: "subAgentActivity",
            id: "subagent_1",
            kind: "started",
            agentThreadId: "thr_agent",
            agentPath: "/repo",
        } satisfies Extract<ThreadItem, { type: "subAgentActivity" }>;
        const thread = {
            id: "thr",
            cwd: "/repo",
            turns: [
                {
                    id: "turn_1",
                    items: [
                        subAgentActivity,
                        {
                            type: "userMessage",
                            id: "user_1",
                            clientId: "client_1",
                            content: [{ type: "text", text: "Review the working tree", text_elements: [] }],
                        },
                        {
                            type: "agentMessage",
                            id: "agent_1",
                            text: "I found two changes.",
                            phase: "final_answer",
                            memoryCitation: null,
                        },
                    ],
                    itemsView: "full",
                    status: "completed",
                    error: null,
                    startedAt: null,
                    completedAt: null,
                    durationMs: null,
                },
            ],
        } satisfies CodexThreadForUi;

        expect(mapCodexThreadToUiMessages(thread)).toMatchObject([
            {
                id: "assistant:turn_1:subagent_1",
                role: "assistant",
                parts: [{ type: "dynamic-tool", toolCallId: "subagent_1" }],
            },
            {
                id: "client_1",
                role: "user",
                parts: [{ type: "text", text: "Review the working tree" }],
            },
            {
                id: "assistant:turn_1:agent_1",
                role: "assistant",
                parts: [{ type: "text", text: "I found two changes." }],
            },
        ]);
    });

    it("preserves commentary and final-answer phases in historical text parts", () =>
    {
        const thread = {
            id: "thr",
            cwd: "/repo",
            turns: [
                {
                    id: "turn_phases",
                    items: [
                        {
                            type: "agentMessage",
                            id: "commentary",
                            text: "Collecting evidence",
                            phase: "commentary",
                            memoryCitation: null,
                        },
                        {
                            type: "agentMessage",
                            id: "final",
                            text: "Conclusion",
                            phase: "final_answer",
                            memoryCitation: null,
                        },
                    ],
                    itemsView: "full",
                    status: "completed",
                    error: null,
                    startedAt: null,
                    completedAt: null,
                    durationMs: 1250,
                },
            ],
        } satisfies CodexThreadForUi;

        expect(mapCodexThreadToUiMessages(thread)[0]?.parts).toEqual([
            {
                type: "text",
                text: "Collecting evidence",
                state: "done",
                providerMetadata: {
                    "@janole/ai-sdk-provider-codex-asp": {
                        messagePhase: "commentary",
                        turnDurationMs: 1250,
                    },
                },
            },
            {
                type: "text",
                text: "Conclusion",
                state: "done",
                providerMetadata: {
                    "@janole/ai-sdk-provider-codex-asp": {
                        messagePhase: "final_answer",
                        turnDurationMs: 1250,
                    },
                },
            },
        ]);
    });

    it("maps sleep history items through the shared dynamic-tool contract", () =>
    {
        const item = {
            type: "sleep",
            id: "sleep_1",
            durationMs: 1500,
        } satisfies Extract<ThreadItem, { type: "sleep" }>;

        expect(mapCodexThreadItemToUiPart(item)).toEqual({
            type: "dynamic-tool",
            toolName: "codex_sleep",
            toolCallId: "sleep_1",
            state: "output-available",
            input: { durationMs: 1500 },
            output: { item },
            providerExecuted: true,
        });
    });

    it("maps compatible loaded-tool items in historical turns", () =>
    {
        const item = {
            type: "loadedTool",
            id: "loaded_1",
            name: "functions.exec",
            status: "completed",
        } satisfies LoadedToolThreadItem;
        const thread = {
            id: "thr",
            turns: [{ id: "turn_loaded", items: [item], durationMs: null }],
        } satisfies CodexThreadForUi;
        const expectedPart = {
            type: "dynamic-tool",
            toolName: "codex_loaded_tool",
            toolCallId: "loaded_1",
            state: "output-available",
            input: { name: "functions.exec", status: "completed" },
            output: { item },
            providerExecuted: true,
        };

        expect(mapCodexThreadItemToUiPart(item)).toEqual(expectedPart);
        expect(mapCodexThreadToUiMessages(thread)[0]?.parts).toEqual([expectedPart]);
    });

    it("maps imageGeneration history items to file UI parts", () =>
    {
        const item = {
            type: "imageGeneration",
            id: "img_1",
            status: "completed",
            revisedPrompt: "a sunrise",
            result: "abc123",
            savedPath: "/tmp/sunrise.png",
        } satisfies Extract<ThreadItem, { type: "imageGeneration" }>;

        expect(mapCodexThreadItemToUiPart(item)).toEqual({
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,abc123",
            providerMetadata: {
                "@janole/ai-sdk-provider-codex-asp": {
                    revisedPrompt: "a sunrise",
                    savedPath: "/tmp/sunrise.png",
                },
            },
        });
    });
});
