import { describe, expect, it } from "vitest";

import { streamText } from "../../../node_modules/ai";
import { AppServerClient } from "../src/client/app-server-client";
import type { JsonRpcMessage } from "../src/client/transport";
import { DynamicToolsDispatcher } from "../src/dynamic-tools";
import { CODEX_PROVIDER_ID } from "../src/protocol/provider-metadata";
import { createCodexAppServer } from "../src/provider";
import { MockTransport } from "./helpers/mock-transport";
import { planAssertionsForTest } from "./helpers/plan-assertion";

class ScriptedDynamicTransport extends MockTransport
{
    override async sendMessage(message: JsonRpcMessage): Promise<void>
    {
        await super.sendMessage(message);

        if ("id" in message && message.id === 77 && "result" in message)
        {
            const result = message.result as {
                success?: boolean
                contentItems?: unknown[]
            };

            queueMicrotask(() =>
            {
                this.emitMessage({
                    method: "item/completed",
                    params: {
                        threadId: "thr_1",
                        turnId: "turn_1",
                        item: {
                            type: "dynamicToolCall",
                            id: "call_1",
                            tool: "lookup",
                            arguments: { id: "ABC-1" },
                            status: result.success ? "completed" : "failed",
                            contentItems: result.contentItems ?? [],
                            success: result.success ?? false,
                            durationMs: 1,
                        },
                    },
                });
                this.emitMessage({
                    method: "item/started",
                    params: {
                        threadId: "thr_1",
                        turnId: "turn_1",
                        item: { type: "agentMessage", id: "item_1", text: "" },
                    },
                });
                this.emitMessage({
                    method: "item/agentMessage/delta",
                    params: {
                        threadId: "thr_1",
                        turnId: "turn_1",
                        itemId: "item_1",
                        delta: "Done",
                    },
                });
                this.emitMessage({
                    method: "item/completed",
                    params: {
                        threadId: "thr_1",
                        turnId: "turn_1",
                        item: { type: "agentMessage", id: "item_1", text: "Done" },
                    },
                });
                this.emitMessage({
                    method: "turn/completed",
                    params: {
                        threadId: "thr_1",
                        turn: { id: "turn_1", items: [], status: "completed", error: null },
                    },
                });
            });
            return;
        }

        if (!("id" in message) || message.id === undefined || !("method" in message))
        {
            return;
        }

        if (message.method === "initialize")
        {
            this.emitMessage({
                id: message.id,
                result: { serverInfo: { name: "codex", version: "test" } },
            });
            return;
        }

        if (message.method === "thread/start")
        {
            this.emitMessage({ id: message.id, result: { threadId: "thr_1" } });
            return;
        }

        if (message.method === "turn/start")
        {
            this.emitMessage({ id: message.id, result: { turnId: "turn_1" } });

            queueMicrotask(() =>
            {
                this.emitMessage({
                    method: "turn/started",
                    params: { threadId: "thr_1", turn: { id: "turn_1" } },
                });
                this.emitMessage({
                    method: "item/started",
                    params: {
                        threadId: "thr_1",
                        turnId: "turn_1",
                        item: {
                            type: "dynamicToolCall",
                            id: "call_1",
                            tool: "lookup",
                            arguments: { id: "ABC-1" },
                            status: "inProgress",
                            contentItems: null,
                            success: null,
                            durationMs: null,
                        },
                    },
                });
                this.emitMessage({
                    id: 77,
                    method: "item/tool/call",
                    params: {
                        threadId: "thr_1",
                        turnId: "turn_1",
                        callId: "call_1",
                        tool: "lookup",
                        arguments: { id: "ABC-1" },
                    },
                });
            });
        }
    }
}

async function readAll(stream: ReadableStream<unknown>): Promise<unknown[]>
{
    const reader = stream.getReader();
    const values: unknown[] = [];

    while (true)
    {
        const { done, value } = await reader.read();
        if (done)
        {
            break;
        }
        values.push(value);
    }

    return values;
}

describe("DynamicToolsDispatcher", () =>
{
    it("executes registered handlers for inbound item/tool/call requests", async () =>
    {
        const transport = new MockTransport();
        const client = new AppServerClient(transport);
        const dispatcher = new DynamicToolsDispatcher({
            handlers: {
                lookup: (args) =>
                    Promise.resolve({
                        success: true,
                        contentItems: [{ type: "inputText", text: `ok:${JSON.stringify(args)}` }],
                    }),
            },
            timeoutMs: 100,
        });

        await client.connect();
        dispatcher.attach(client);

        transport.emitMessage({
            id: 42,
            method: "item/tool/call",
            params: { tool: "lookup", arguments: { id: "ABC-1" } },
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(transport.sentMessages.at(-1)).toEqual({
            id: 42,
            result: {
                success: true,
                contentItems: [{ type: "inputText", text: "ok:{\"id\":\"ABC-1\"}" }],
            },
        });
    });

    it("executes tools registered via the tools (schema) API", async () =>
    {
        const transport = new MockTransport();
        const client = new AppServerClient(transport);
        const dispatcher = new DynamicToolsDispatcher({
            tools: {
                lookup: {
                    description: "Look up a record by id.",
                    inputSchema: {
                        type: "object",
                        properties: { id: { type: "string" } },
                        required: ["id"],
                    },
                    execute: (args) =>
                        Promise.resolve({
                            success: true,
                            contentItems: [{ type: "inputText", text: `schema:${JSON.stringify(args)}` }],
                        }),
                },
            },
            timeoutMs: 100,
        });

        await client.connect();
        dispatcher.attach(client);

        transport.emitMessage({
            id: 55,
            method: "item/tool/call",
            params: { tool: "lookup", arguments: { id: "XYZ" } },
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(transport.sentMessages.at(-1)).toEqual({
            id: 55,
            result: {
                success: true,
                contentItems: [{ type: "inputText", text: "schema:{\"id\":\"XYZ\"}" }],
            },
        });
    });

    it("D05 returns a failed tool result when execution times out", async () =>
    {
        const assertD05 = planAssertionsForTest("D05");
        const dispatcher = new DynamicToolsDispatcher({
            handlers: {
                slow: async () =>
                    new Promise((resolve) =>
                    {
                        setTimeout(() => resolve({ success: true, contentItems: [] }), 100);
                    }),
            },
            timeoutMs: 10,
        });

        const result = await dispatcher.dispatch({ tool: "slow", arguments: {} });

        await assertD05("工具超时返回单个失败结果", () =>
        {
            expect(result.success).toBe(false);
            expect(result.contentItems[0]).toEqual(expect.objectContaining({ type: "inputText" }));
            expect(result.contentItems).toHaveLength(1);
        });
    });

    it("returns failure response when handler throws", async () =>
    {
        const dispatcher = new DynamicToolsDispatcher({
            handlers: {
                broken: () => Promise.reject(new Error("boom")),
            },
            timeoutMs: 100,
        });

        const result = await dispatcher.dispatch({ tool: "broken", arguments: {} });

        expect(result).toEqual({
            success: false,
            contentItems: [{ type: "inputText", text: "boom" }],
        });
    });

    it("returns failure response for unknown tool", async () =>
    {
        const dispatcher = new DynamicToolsDispatcher({ handlers: {} });

        const result = await dispatcher.dispatch({ tool: "missing", arguments: {} });

        expect(result.success).toBe(false);
        expect(result.contentItems[0]).toEqual(expect.objectContaining({ type: "inputText" }));
    });
});

describe("CodexLanguageModel dynamic tools wiring", () =>
{
    it("D04 forwards a failed dynamic tool response as an output-error record", async () =>
    {
        const assertD04 = planAssertionsForTest("D04");
        const transport = new ScriptedDynamicTransport();
        const provider = createCodexAppServer({
            experimentalApi: true,
            transportFactory: () => transport,
            tools: {
                lookup: {
                    description: "Look up a record by id.",
                    inputSchema: { type: "object" },
                    execute: () =>
                        Promise.resolve({
                            success: false,
                            contentItems: [{ type: "inputText", text: "upstream tool rejected the request" }],
                        }),
                },
            },
            toolTimeoutMs: 100,
            clientInfo: { name: "test-client", version: "1.0.0" },
        });

        const model = provider.languageModel("gpt-5.5");
        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        });
        const parts = (await readAll(stream)) as Array<{
            type?: string
            isError?: boolean
            result?: { item?: { success?: boolean; contentItems?: unknown[] } }
        }>;

        const toolResult = parts.find((part) => part.type === "tool-result");
        await assertD04("失败动态工具映射为单个 output-error", () =>
        {
            expect(parts.filter((part) => part.type === "tool-result")).toHaveLength(1);
            expect(toolResult?.isError).toBe(true);
            expect(toolResult?.result?.item).toMatchObject({
                success: false,
                contentItems: [{ type: "inputText", text: "upstream tool rejected the request" }],
            });
            expect(transport.sentMessages).toContainEqual({
                id: 77,
                result: {
                    success: false,
                    contentItems: [{ type: "inputText", text: "upstream tool rejected the request" }],
                },
            });
        });
    });

    it("D06 preserves an empty successful tool output as an available result", async () =>
    {
        const assertD06 = planAssertionsForTest("D06");
        const transport = new ScriptedDynamicTransport();
        const provider = createCodexAppServer({
            experimentalApi: true,
            transportFactory: () => transport,
            tools: {
                lookup: {
                    description: "Look up a record by id.",
                    inputSchema: { type: "object" },
                    execute: () => Promise.resolve({ success: true, contentItems: [] }),
                },
            },
            toolTimeoutMs: 100,
            clientInfo: { name: "test-client", version: "1.0.0" },
        });

        const model = provider.languageModel("gpt-5.5");
        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        });
        const parts = (await readAll(stream)) as Array<{
            type?: string
            isError?: boolean
            result?: { item?: { success?: boolean; contentItems?: unknown[] } }
        }>;

        const toolResult = parts.find((part) => part.type === "tool-result");
        await assertD06("空输出作为成功结果保留", () =>
        {
            expect(parts.filter((part) => part.type === "tool-result")).toHaveLength(1);
            expect(toolResult?.result?.item).toMatchObject({ success: true, contentItems: [] });
            expect(toolResult?.isError).not.toBe(true);
            expect(transport.sentMessages).toContainEqual({
                id: 77,
                result: { success: true, contentItems: [] },
            });
        });
    });

    it("D07 preserves a large successful tool output without truncating the tool record", async () =>
    {
        const assertD07 = planAssertionsForTest("D07");
        const largeOutput = "x".repeat(512 * 1024);
        const transport = new ScriptedDynamicTransport();
        const provider = createCodexAppServer({
            experimentalApi: true,
            transportFactory: () => transport,
            tools: {
                lookup: {
                    description: "Look up a record by id.",
                    inputSchema: { type: "object" },
                    execute: () =>
                        Promise.resolve({
                            success: true,
                            contentItems: [{ type: "inputText", text: largeOutput }],
                        }),
                },
            },
            toolTimeoutMs: 100,
            clientInfo: { name: "test-client", version: "1.0.0" },
        });

        const model = provider.languageModel("gpt-5.5");
        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        });
        const parts = (await readAll(stream)) as Array<{
            type?: string
            result?: { contentItems?: Array<{ text?: string }> }
        }>;

        const toolResult = parts.find((part) => part.type === "tool-result");
        const resultItem = (
            toolResult?.result as
        | {
            item?: { contentItems?: Array<{ text?: string }> }
        }
        | undefined
        )?.item;
        await assertD07("超大输出完整保留并回传", () =>
        {
            expect(parts.filter((part) => part.type === "tool-result")).toHaveLength(1);
            expect(resultItem?.contentItems?.[0]?.text).toHaveLength(largeOutput.length);
            expect(resultItem?.contentItems?.[0]?.text).toBe(largeOutput);
            expect(transport.sentMessages).toContainEqual({
                id: 77,
                result: {
                    success: true,
                    contentItems: [{ type: "inputText", text: largeOutput }],
                },
            });
        });
    });

    it("forwards provider-executed dynamic tools into the UI message stream", async () =>
    {
        const transport = new ScriptedDynamicTransport();
        const provider = createCodexAppServer({
            experimentalApi: true,
            transportFactory: () => transport,
            tools: {
                lookup: {
                    description: "Look up a record by id.",
                    inputSchema: {
                        type: "object",
                        properties: { id: { type: "string" } },
                        required: ["id"],
                    },
                    execute: (args) =>
                        Promise.resolve({
                            success: true,
                            contentItems: [{ type: "inputText", text: `lookup:${JSON.stringify(args)}` }],
                        }),
                },
            },
            toolTimeoutMs: 100,
            clientInfo: { name: "test-client", version: "1.0.0" },
        });

        const result = streamText({
            model: provider.languageModel("gpt-5.5"),
            messages: [{ role: "user", content: "hi" }],
        });
        const parts = (await readAll(result.toUIMessageStream())) as Array<{
            type?: string
            toolCallId?: string
            toolName?: string
            output?: { item?: { success?: boolean; contentItems?: unknown[] } }
        }>;

        const toolInputs = parts.filter((part) => part.type === "tool-input-available");
        expect(toolInputs).toHaveLength(1);
        expect(toolInputs[0]).toMatchObject({
            type: "tool-input-available",
            toolCallId: "call_1",
            toolName: "lookup",
        });

        const toolOutputs = parts.filter((part) => part.type === "tool-output-available");
        expect(toolOutputs).toHaveLength(1);
        expect(toolOutputs[0]).toMatchObject({
            type: "tool-output-available",
            toolCallId: "call_1",
            output: {
                item: {
                    success: true,
                    contentItems: [{ type: "inputText", text: "lookup:{\"id\":\"ABC-1\"}" }],
                },
            },
        });
    });

    it("routes inbound tool call through dispatcher during doStream", async () =>
    {
        const transport = new ScriptedDynamicTransport();

        const provider = createCodexAppServer({
            experimentalApi: true,
            transportFactory: () => transport,
            tools: {
                lookup: {
                    description: "Look up a record by id.",
                    inputSchema: {
                        type: "object",
                        properties: { id: { type: "string" } },
                        required: ["id"],
                    },
                    execute: (args) =>
                        Promise.resolve({
                            success: true,
                            contentItems: [{ type: "inputText", text: `lookup:${JSON.stringify(args)}` }],
                        }),
                },
            },
            toolTimeoutMs: 100,
            clientInfo: { name: "test-client", version: "1.0.0" },
        });

        const model = provider.languageModel("gpt-5.5");
        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        });

        const parts = await readAll(stream);

        expect(
            parts.findIndex((part) => (part as { type?: string }).type === "stream-start"),
        ).toBeLessThan(parts.findIndex((part) => (part as { type?: string }).type === "tool-call"));

        expect((parts as { type?: string }[]).find((part) => part.type === "text-delta")).toMatchObject(
            {
                type: "text-delta",
                id: "item_1",
                delta: "Done",
                providerMetadata: { [CODEX_PROVIDER_ID]: { threadId: "thr_1" } },
            },
        );

        const toolCalls = parts.filter((part) => (part as { type?: string }).type === "tool-call");
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0]).toMatchObject({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "lookup",
            input: "{\"id\":\"ABC-1\"}",
            providerExecuted: true,
            providerMetadata: {
                [CODEX_PROVIDER_ID]: {
                    threadId: "thr_1",
                    turnId: "turn_1",
                    sourceItemId: "call_1",
                },
            },
        });
        const toolResults = parts.filter((part) => (part as { type?: string }).type === "tool-result");
        expect(toolResults).toHaveLength(1);
        expect(toolResults[0]).toMatchObject({
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "lookup",
            result: {
                item: {
                    success: true,
                    contentItems: [{ type: "inputText", text: "lookup:{\"id\":\"ABC-1\"}" }],
                },
            },
            providerMetadata: {
                [CODEX_PROVIDER_ID]: {
                    threadId: "thr_1",
                    turnId: "turn_1",
                    sourceItemId: "call_1",
                },
            },
        });

        const toolResponse = transport.sentMessages.find(
            (message) => "id" in message && message.id === 77,
        );

        expect(toolResponse).toEqual({
            id: 77,
            result: {
                success: true,
                contentItems: [{ type: "inputText", text: "lookup:{\"id\":\"ABC-1\"}" }],
            },
        });
    });

    it("includes dynamicTools definitions in thread/start params", async () =>
    {
        const transport = new ScriptedDynamicTransport();

        const provider = createCodexAppServer({
            experimentalApi: true,
            transportFactory: () => transport,
            tools: {
                lookup: {
                    description: "Look up a record by id.",
                    inputSchema: {
                        type: "object",
                        properties: { id: { type: "string" } },
                        required: ["id"],
                    },
                    execute: (args) =>
                        Promise.resolve({
                            success: true,
                            contentItems: [{ type: "inputText", text: `lookup:${JSON.stringify(args)}` }],
                        }),
                },
            },
            toolTimeoutMs: 100,
            clientInfo: { name: "test-client", version: "1.0.0" },
        });

        const model = provider.languageModel("gpt-5.5");
        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        });

        await readAll(stream);

        const threadStartMsg = transport.sentMessages.find(
            (m) => "method" in m && m.method === "thread/start",
        );

        expect(threadStartMsg).toBeDefined();
        expect(
            (threadStartMsg as { params?: { dynamicTools?: unknown[] } }).params?.dynamicTools,
        ).toEqual([
            {
                name: "lookup",
                description: "Look up a record by id.",
                inputSchema: {
                    type: "object",
                    properties: { id: { type: "string" } },
                    required: ["id"],
                },
            },
        ]);
    });
});
