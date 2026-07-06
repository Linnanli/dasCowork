import { describe, expect, it } from "vitest";

import {
    type CodexThreadForUi,
    mapCodexThreadItemToUiPart,
    mapCodexThreadToUiMessages,
    toolInvocationForItem,
} from "../src";
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
                id: "turn_1:assistant",
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
