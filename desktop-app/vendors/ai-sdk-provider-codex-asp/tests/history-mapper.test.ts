import { describe, expect, it } from "vitest";

import {
    buildFilesMentionedContext,
    type CodexThreadForUi,
    type LoadedToolThreadItem,
    mapCodexThreadItemToUiPart,
    mapCodexThreadToUiMessages,
    toolInvocationForItem,
} from "../src";
import { unifiedDiffForFileChangeBatches } from "../src/protocol/turn-diff";
import type { ThreadItem } from "../src/protocol/types";

function historicalTurnDiffItem(thread: CodexThreadForUi): Record<string, unknown> | undefined
{
    const dynamicParts = mapCodexThreadToUiMessages(thread)
        .flatMap((message) => message.parts)
        .filter((part) => part.type === "dynamic-tool" && part.toolName === "codex_turn_diff");
    const output = (dynamicParts.at(-1) as { output?: unknown } | undefined)?.output;
    return output && typeof output === "object"
        ? ((output as Record<string, unknown>)["item"] as Record<string, unknown> | undefined)
        : undefined;
}

describe("history mapper", () =>
{
    it("maps a full thread history to UI messages without dropping tool items", () =>
    {
        const commandActions = [
            {
                type: "read" as const,
                command: "cat package.json",
                name: "cat",
                path: "/repo/package.json",
            },
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
                metadata: { codexSource: { turnId: "turn_1" } },
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
                metadata: { codexSource: { turnId: "turn_1" } },
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
                                patchBatches: [
                                    {
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
                                    },
                                ],
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

        expect(
            unifiedDiffForFileChangeBatches([
                {
                    cwd: "/repo/a",
                    changes: [change("@@ -1 +1 @@\n-before\n+after\n"), change("@@ -3 +3 @@\n-old\n+new\n")],
                },
                {
                    cwd: "/repo/b",
                    changes: [change("@@ -1 +1 @@\n-before-b\n+after-b\n")],
                },
            ]),
        ).toBe(
            [
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
            ].join("\n"),
        );
    });

    it("converts absolute file-change paths to paths relative to their working directory", () =>
    {
        expect(
            unifiedDiffForFileChangeBatches([
                {
                    cwd: "/repo",
                    changes: [
                        {
                            path: "/repo/src/app.ts",
                            kind: { type: "update" as const, move_path: null },
                            diff: "@@ -1 +1 @@\n-before\n+after\n",
                        },
                    ],
                },
            ]),
        ).toBe(
            [
                "diff --git a/src/app.ts b/src/app.ts",
                "--- a/src/app.ts",
                "+++ b/src/app.ts",
                "@@ -1 +1 @@",
                "-before",
                "+after",
                "",
            ].join("\n"),
        );
    });

    it("restores historical action patch batches in fileChange order with their cwd", () =>
    {
        const firstChange = {
            path: "src/a.ts",
            kind: { type: "update" as const, move_path: null },
            diff: "@@ -1 +1 @@\n-old\n+new\n",
        };
        const secondChange = {
            path: "src/b.ts",
            kind: { type: "add" as const },
            diff: "created\n",
        };
        const thread = {
            id: "thr",
            turns: [
                {
                    id: "turn_batches",
                    durationMs: null,
                    items: [
                        {
                            type: "commandExecution",
                            id: "cmd_a",
                            command: "edit a",
                            cwd: "/repo/a",
                            processId: null,
                            source: "agent",
                            status: "completed",
                            commandActions: [],
                            aggregatedOutput: null,
                            exitCode: 0,
                            durationMs: null,
                        },
                        {
                            type: "fileChange",
                            id: "file_a",
                            status: "completed",
                            changes: [firstChange],
                        },
                        {
                            type: "fileChange",
                            id: "file_failed",
                            status: "failed",
                            changes: [
                                {
                                    path: "failed.ts",
                                    kind: { type: "add" as const },
                                    diff: "failed\n",
                                },
                            ],
                        },
                        {
                            type: "commandExecution",
                            id: "cmd_b",
                            command: "edit b",
                            cwd: "/repo/b",
                            processId: null,
                            source: "agent",
                            status: "completed",
                            commandActions: [],
                            aggregatedOutput: null,
                            exitCode: 0,
                            durationMs: null,
                        },
                        {
                            type: "fileChange",
                            id: "file_b",
                            status: "completed",
                            changes: [secondChange],
                        },
                    ],
                },
            ],
        } satisfies CodexThreadForUi;

        expect(historicalTurnDiffItem(thread)).toMatchObject({
            status: "completed",
            cwd: "/repo/a",
            patchBatches: [
                {
                    cwd: "/repo/a",
                    diff: [
                        "diff --git a/src/a.ts b/src/a.ts",
                        "--- a/src/a.ts",
                        "+++ b/src/a.ts",
                        "@@ -1 +1 @@",
                        "-old",
                        "+new",
                        "",
                    ].join("\n"),
                },
                {
                    cwd: "/repo/b",
                    diff: [
                        "diff --git a/src/b.ts b/src/b.ts",
                        "new file mode 100644",
                        "--- /dev/null",
                        "+++ b/src/b.ts",
                        "@@ -0,0 +1,1 @@",
                        "+created",
                        "",
                    ].join("\n"),
                },
            ],
        });
    });

    it("keeps full historical action patches when only the preview is truncated", () =>
    {
        const largeContent = `${"x".repeat(60_000)}\n`;
        const thread = {
            id: "thr",
            cwd: "/repo",
            turns: [
                {
                    id: "turn_truncated_preview",
                    durationMs: null,
                    items: [
                        {
                            type: "fileChange",
                            id: "file_large_preview",
                            status: "completed",
                            changes: [
                                {
                                    path: "large-preview.txt",
                                    kind: { type: "add" as const },
                                    diff: largeContent,
                                },
                            ],
                        },
                    ],
                },
            ],
        } satisfies CodexThreadForUi;

        const item = historicalTurnDiffItem(thread);
        expect(item).toMatchObject({
            status: "completed",
            truncated: true,
        });
        expect(item?.["originalLength"]).toEqual(expect.any(Number));
        const patchBatches = item?.["patchBatches"];
        expect(Array.isArray(patchBatches)).toBe(true);
        const firstBatch: unknown = Array.isArray(patchBatches) ? patchBatches[0] : undefined;
        expect(firstBatch).toMatchObject({ cwd: "/repo" });
        expect(
            firstBatch && typeof firstBatch === "object"
                ? (firstBatch as Record<string, unknown>)["diff"]
                : undefined,
        ).toEqual(expect.stringContaining(largeContent));
        expect((item?.["diff"] as string).length).toBe(50_000);
    });

    it("disables historical action patches when the complete patch exceeds the action limit", () =>
    {
        const thread = {
            id: "thr",
            cwd: "/repo",
            turns: [
                {
                    id: "turn_huge_patch",
                    durationMs: null,
                    items: [
                        {
                            type: "fileChange",
                            id: "file_huge",
                            status: "completed",
                            changes: [
                                {
                                    path: "huge.txt",
                                    kind: { type: "add" as const },
                                    diff: `${"x".repeat(2 * 1024 * 1024 + 1)}\n`,
                                },
                            ],
                        },
                    ],
                },
            ],
        } satisfies CodexThreadForUi;

        const item = historicalTurnDiffItem(thread);
        expect(item).toMatchObject({
            status: "completed",
            truncated: true,
            patchUnavailableReason: "patch-too-large",
        });
        expect(item).not.toHaveProperty("patchBatches");
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

    it("restores a failed turn on its final assistant message", () =>
    {
        const turnError = {
            message: "The model stream disconnected.",
            codexErrorInfo: null,
            additionalDetails: "response.completed was not received",
        };
        const thread = {
            id: "thr",
            turns: [
                {
                    id: "turn_failed",
                    durationMs: 1250,
                    status: "failed",
                    error: turnError,
                    items: [
                        {
                            type: "agentMessage",
                            id: "agent_before_user",
                            text: "Earlier assistant segment",
                            phase: "commentary",
                            memoryCitation: null,
                        },
                        {
                            type: "userMessage",
                            id: "user_1",
                            clientId: "client_1",
                            content: [{ type: "text", text: "Continue", text_elements: [] }],
                        },
                        {
                            type: "agentMessage",
                            id: "agent_partial",
                            text: "Partial answer",
                            phase: "final_answer",
                            memoryCitation: null,
                        },
                    ],
                },
            ],
        } as CodexThreadForUi;

        const messages = mapCodexThreadToUiMessages(thread);
        expect(messages).toMatchObject([
            {
                id: "assistant:turn_failed:agent_before_user",
                role: "assistant",
            },
            {
                id: "client_1",
                role: "user",
            },
            {
                id: "assistant:turn_failed:agent_partial",
                role: "assistant",
                parts: [{ type: "text", text: "Partial answer" }],
                metadata: {
                    codexSource: { turnId: "turn_failed" },
                    codexTurn: {
                        turnId: "turn_failed",
                        status: "failed",
                        error: turnError,
                    },
                },
            },
        ]);
        expect(messages[0]).toMatchObject({ metadata: { codexSource: { turnId: "turn_failed" } } });
    });

    it("creates a terminal assistant message when a failed turn has no assistant output", () =>
    {
        const thread = {
            id: "thr",
            turns: [
                {
                    id: "turn_failed_empty",
                    durationMs: null,
                    status: "failed",
                    error: {
                        message: "",
                        codexErrorInfo: null,
                        additionalDetails: null,
                    },
                    items: [
                        {
                            type: "userMessage",
                            id: "user_1",
                            clientId: null,
                            content: [{ type: "text", text: "Start", text_elements: [] }],
                        },
                    ],
                },
            ],
        } as CodexThreadForUi;

        expect(mapCodexThreadToUiMessages(thread)).toEqual([
            {
                id: "user_1",
                role: "user",
                parts: [{ type: "text", text: "Start", state: "done" }],
            },
            {
                id: "assistant:turn_failed_empty:terminal",
                role: "assistant",
                parts: [],
                metadata: {
                    codexSource: { turnId: "turn_failed_empty" },
                    codexTurn: {
                        turnId: "turn_failed_empty",
                        status: "failed",
                        error: {
                            message: "The model request failed before completion.",
                            codexErrorInfo: null,
                            additionalDetails: null,
                        },
                    },
                },
            },
        ]);
    });

    it("restores interrupted turns without inventing a model error", () =>
    {
        const thread = {
            id: "thr",
            turns: [
                {
                    id: "turn_interrupted",
                    durationMs: null,
                    status: "interrupted",
                    error: {
                        message: "This must not be displayed as a model error.",
                        codexErrorInfo: null,
                        additionalDetails: null,
                    },
                    items: [
                        {
                            type: "agentMessage",
                            id: "agent_partial",
                            text: "Stopped here",
                            phase: null,
                            memoryCitation: null,
                        },
                    ],
                },
            ],
        } as CodexThreadForUi;

        expect(mapCodexThreadToUiMessages(thread)[0]).toEqual({
            id: "assistant:turn_interrupted:agent_partial",
            role: "assistant",
            parts: [{ type: "text", text: "Stopped here", state: "done" }],
            metadata: {
                codexSource: { turnId: "turn_interrupted" },
                codexTurn: {
                    turnId: "turn_interrupted",
                    status: "interrupted",
                },
            },
        });
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

    it("restores context mentions and degrades server history file context to path mentions", () =>
    {
        const thread = {
            id: "thr",
            turns: [
                {
                    id: "turn_context",
                    durationMs: null,
                    items: [
                        {
                            type: "userMessage",
                            id: "user_context",
                            clientId: null,
                            content: [
                                {
                                    type: "text",
                                    text: buildFilesMentionedContext(
                                        [
                                            { type: "file", label: "report.pdf", path: "/tmp/report.pdf" },
                                            { type: "folder", label: "workspace", path: "/tmp/workspace" },
                                        ],
                                        "Use $github and @sample@local.",
                                    ),
                                    text_elements: [],
                                },
                                { type: "mention", name: "github", path: "app://github" },
                                { type: "mention", name: "sample@local", path: "plugin://sample@local" },
                            ],
                        },
                    ],
                },
            ],
        } as unknown as CodexThreadForUi;

        expect(mapCodexThreadToUiMessages(thread)).toEqual([
            {
                id: "user_context",
                role: "user",
                parts: [
                    {
                        type: "text",
                        text: [
                            ":file[report.pdf]{name=%2Ftmp%2Freport.pdf}",
                            ":file[workspace]{name=%2Ftmp%2Fworkspace}",
                            "Use :app[github]{name=app%3A%2F%2Fgithub} and :plugin[sample%40local]{name=plugin%3A%2F%2Fsample%40local}.",
                        ].join("\n"),
                        state: "done",
                    },
                ],
            },
        ]);
    });
});
