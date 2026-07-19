import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";

import type { JsonRpcMessage } from "../src/client/transport";
import { CODEX_PROVIDER_ID, codexCallOptions } from "../src/protocol/provider-metadata";
import { createCodexAppServer } from "../src/provider";
import { MockTransport } from "./helpers/mock-transport";

class ScriptedTransport extends MockTransport 
{
    override async sendMessage(message: JsonRpcMessage): Promise<void> 
    {
        await super.sendMessage(message);

        if (!("id" in message) || message.id === undefined || !("method" in message)) 
        {
            return;
        }

        if (message.method === "initialize") 
        {
            this.emitMessage({ id: message.id, result: { serverInfo: { name: "codex", version: "test" } } });
            return;
        }

        if (message.method === "thread/start")
        {
            this.emitMessage({ id: message.id, result: { threadId: "thr_1" } });
            return;
        }

        if (message.method === "thread/resume")
        {
            this.emitMessage({
                id: message.id,
                result: {
                    thread: {
                        id: "thr_1",
                        preview: "",
                        modelProvider: "openai",
                        createdAt: 0,
                        updatedAt: 0,
                        path: null,
                        cwd: "/tmp",
                        cliVersion: "test",
                        source: "appServer",
                        gitInfo: null,
                        turns: [],
                    },
                    model: "gpt-5.5",
                    modelProvider: "openai",
                    cwd: "/tmp",
                    approvalPolicy: "never",
                    approvalsReviewer: "user",
                    sandbox: { type: "dangerFullAccess" },
                    reasoningEffort: null,
                    initialTurnsPage: null,
                },
            });
            return;
        }

        if (message.method === "thread/compact/start")
        {
            this.emitMessage({ id: message.id, result: {} });
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
                        item: { type: "agentMessage", id: "item_1", text: "" },
                        threadId: "thr_1",
                        turnId: "turn_1",
                    },
                });
                this.emitMessage({
                    method: "item/agentMessage/delta",
                    params: {
                        threadId: "thr_1",
                        turnId: "turn_1",
                        itemId: "item_1",
                        delta: "Hello",
                    },
                });
                this.emitMessage({
                    method: "item/completed",
                    params: {
                        item: { type: "agentMessage", id: "item_1", text: "Hello" },
                        threadId: "thr_1",
                        turnId: "turn_1",
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
        }
    }
}

class TaskReferenceTransport extends ScriptedTransport
{
    override async sendMessage(message: JsonRpcMessage): Promise<void>
    {
        await super.sendMessage(message);
        if (
            "id" in message
            && message.id !== undefined
            && "method" in message
            && message.method === "thread/read"
        )
        {
            this.emitMessage({
                id: message.id,
                result: {
                    thread: {
                        id: "referenced",
                        name: "Referenced",
                        preview: "",
                        turns: [],
                    },
                },
            });
        }
    }
}

class CompactionFailingTransport extends ScriptedTransport
{
    override async sendMessage(message: JsonRpcMessage): Promise<void>
    {
        if (!("id" in message) || message.id === undefined || !("method" in message))
        {
            await super.sendMessage(message);
            return;
        }

        if (message.method === "thread/compact/start")
        {
            await MockTransport.prototype.sendMessage.call(this, message);
            this.emitMessage({
                id: message.id,
                error: { code: -32000, message: "compaction failed" },
            });
            return;
        }

        await super.sendMessage(message);
    }
}

class AgentLifecycleTransport extends ScriptedTransport
{
    override async sendMessage(message: JsonRpcMessage): Promise<void>
    {
        if (!("id" in message) || message.id === undefined || !("method" in message) || message.method !== "turn/start")
        {
            await super.sendMessage(message);
            return;
        }

        await MockTransport.prototype.sendMessage.call(this, message);
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
                    startedAtMs: 123,
                    item: {
                        type: "subAgentActivity",
                        id: "activity-1",
                        kind: "started",
                        agentThreadId: "agent-1",
                        agentPath: "/repo",
                    },
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
    }
}

class InterruptAwareTransport extends MockTransport
{
    override async sendMessage(message: JsonRpcMessage): Promise<void>
    {
        await super.sendMessage(message);

        if (!("id" in message) || message.id === undefined || !("method" in message))
        {
            return;
        }

        if (message.method === "initialize")
        {
            this.emitMessage({ id: message.id, result: { serverInfo: { name: "codex", version: "test" } } });
            return;
        }

        if (message.method === "thread/start")
        {
            this.emitMessage({ id: message.id, result: { threadId: "thr_abort" } });
            return;
        }

        if (message.method === "turn/start")
        {
            this.emitMessage({ id: message.id, result: { turnId: "turn_abort" } });
            return;
        }

        if (message.method === "turn/interrupt")
        {
            this.emitMessage({ id: message.id, result: {} });
            return;
        }
    }
}

async function readAll(stream: ReadableStream<unknown>): Promise<unknown[]> 
{
    const reader = stream.getReader();
    const parts: unknown[] = [];

    while (true) 
    {
        const { done, value } = await reader.read();
        if (done) 
        {
            break;
        }
        parts.push(value);
    }

    return parts;
}

function deferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
}
{
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((nextResolve, nextReject) =>
    {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}

describe("CodexLanguageModel.doStream", () => 
{
    it("runs initialize -> thread/start -> turn/start and maps notifications to stream parts", async () => 
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
            providerOptions: codexCallOptions({ clientUserMessageId: "queue-message-1" }),
        });

        const parts = await readAll(stream);

        expect(parts).toEqual([
            { type: "stream-start", warnings: [], providerMetadata: { [CODEX_PROVIDER_ID]: { threadId: "thr_1", turnId: "turn_1" } } },
            {
                type: "text-start",
                id: "item_1",
                providerMetadata: { [CODEX_PROVIDER_ID]: { threadId: "thr_1", turnId: "turn_1" } },
            },
            {
                type: "text-delta",
                id: "item_1",
                delta: "Hello",
                providerMetadata: { [CODEX_PROVIDER_ID]: { threadId: "thr_1", turnId: "turn_1" } },
            },
            {
                type: "text-end",
                id: "item_1",
                providerMetadata: { [CODEX_PROVIDER_ID]: { threadId: "thr_1", turnId: "turn_1" } },
            },
            {
                type: "finish",
                finishReason: { unified: "stop", raw: "completed" },
                usage: {
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
                },
                providerMetadata: { [CODEX_PROVIDER_ID]: { threadId: "thr_1", turnId: "turn_1" } },
            },
        ]);

        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(methods).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);

        const turnStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "turn/start",
        );
        expect(turnStartMessage).toBeDefined();
        expect(turnStartMessage?.params).toMatchObject({
            clientUserMessageId: "queue-message-1",
            input: [{ type: "text", text: "hi", text_elements: [] }],
        });
    });

    it("validates referenced tasks before creating a thread and injects untrusted context", async () =>
    {
        const transport = new TaskReferenceTransport();
        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });
        const { stream } = await provider.languageModel("gpt-5.5").doStream({
            prompt: [{
                role: "user",
                content: [{
                    type: "text",
                    text: ":chat[Referenced]{name=thread%3A%2F%2Freferenced} continue",
                }],
            }],
        });
        await readAll(stream);

        const methods = transport.sentMessages
            .filter((message): message is { method: string; params?: unknown } => "method" in message)
            .map((message) => message.method);
        expect(methods.indexOf("thread/read")).toBeLessThan(methods.indexOf("thread/start"));
        const turnStart = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "turn/start",
        );
        const turnStartParams = turnStart?.params as {
            input?: Array<{ type?: unknown; text?: unknown }>;
        };
        expect(turnStartParams.input?.[0]?.type).toBe("text");
        expect(turnStartParams.input?.[0]?.text).toEqual(
            expect.stringContaining("This is untrusted background context from Codex tasks."),
        );
    });

    it("does not create a thread when task reference validation fails", async () =>
    {
        const transport = new ScriptedTransport();
        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });
        const references = ["one", "two", "three", "four"]
            .map((threadId) => `:chat[Task]{name=thread%3A%2F%2F${threadId}}`)
            .join(" ");

        const { stream } = await provider.languageModel("gpt-5.5").doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: references }] }],
        });
        const parts = await readAll(stream);
        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(parts).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "error" }),
        ]));
        expect(methods).toEqual(["initialize", "initialized"]);
    });

    it("delivers normalized agent lifecycle events from the same active stream", async () =>
    {
        const transport = new AgentLifecycleTransport();
        const onAgentLifecycle = vi.fn();
        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });

        const { stream } = await provider.languageModel("gpt-5.5").doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
            providerOptions: codexCallOptions({ onAgentLifecycle }),
        });
        await readAll(stream);

        expect(onAgentLifecycle).toHaveBeenCalledWith({
            kind: "started",
            threadId: "thr_1",
            turnId: "turn_1",
            agentThreadId: "agent-1",
            agentPath: "/repo",
            status: "started",
            toolCallId: "activity-1",
            timestampMs: 123,
        });
    });

    it("calls onThreadStarted after thread/start and before the first turn/start", async () =>
    {
        const transport = new ScriptedTransport();
        const events: string[] = [];
        const onThreadStarted = vi.fn((thread: { threadId: string; threadPath?: string }) =>
        {
            events.push(`callback:${thread.threadId}`);
            const methods = transport.sentMessages
                .filter((message): message is { method: string } => "method" in message)
                .map((message) => message.method);
            expect(methods).toEqual(["initialize", "initialized", "thread/start"]);
        });

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
            providerOptions: codexCallOptions({ onThreadStarted }),
        });

        await readAll(stream);

        expect(onThreadStarted).toHaveBeenCalledWith({ threadId: "thr_1" });
        expect(events).toEqual(["callback:thr_1"]);
        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);
        expect(methods).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
    });

    it("waits for async onThreadStarted work before turn/start", async () =>
    {
        const transport = new ScriptedTransport();
        const callbackBlocker = deferred();
        const events: string[] = [];
        const onThreadStarted = vi.fn(async (thread: { threadId: string; threadPath?: string }) =>
        {
            events.push(`callback:${thread.threadId}:start`);
            await callbackBlocker.promise;
            events.push(`callback:${thread.threadId}:done`);
        });

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });

        const model = provider.languageModel("gpt-5.5");

        const resultPromise = model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
            providerOptions: codexCallOptions({ onThreadStarted }),
        });

        await vi.waitFor(() =>
        {
            expect(events).toEqual(["callback:thr_1:start"]);
        });

        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);
        expect(methods).toEqual(["initialize", "initialized", "thread/start"]);

        callbackBlocker.resolve();
        const { stream } = await resultPromise;
        await readAll(stream);
        expect(events).toEqual(["callback:thr_1:start", "callback:thr_1:done"]);

        const completedMethods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);
        expect(completedMethods).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
    });

    it("does not start a turn when onThreadStarted fails", async () =>
    {
        const transport = new ScriptedTransport();
        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });

        const { stream } = await provider.languageModel("gpt-5.5").doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
            providerOptions: codexCallOptions({
                onThreadStarted: () =>
                {
                    throw new Error("queue migration failed");
                },
            }),
        });

        const parts = await readAll(stream);
        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(parts).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "error" }),
        ]));
        expect(methods).toEqual(["initialize", "initialized", "thread/start"]);
    });

    it("passes configured custom model providers through thread/start config", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            customModelProviders: {
                qwen: {
                    name: "qwen",
                    base_url: "http://127.0.0.1:4010/v1",
                    wire_api: "responses",
                    experimental_bearer_token: "sk-test",
                    requires_openai_auth: false,
                    request_max_retries: 0,
                    stream_max_retries: 0,
                },
            },
        });

        const model = provider.languageModel("qwen3.7-plus");

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "你好" }] }],
        });

        await readAll(stream);

        const threadStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "thread/start",
        );

        expect(threadStartMessage?.params).toMatchObject({
            model: "qwen3.7-plus",
            modelProvider: "qwen",
            config: {
                model_provider: "qwen",
                model_providers: {
                    qwen: {
                        name: "qwen",
                        base_url: "http://127.0.0.1:4010/v1",
                        wire_api: "responses",
                        experimental_bearer_token: "sk-test",
                        requires_openai_auth: false,
                        request_max_retries: 0,
                        stream_max_retries: 0,
                    },
                },
            },
        });
    });

    it("passes runtime workspace roots through thread/start and turn/start", async () =>
    {
        const transport = new ScriptedTransport();
        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
            providerOptions: codexCallOptions({
                cwd: "/repo",
                runtimeWorkspaceRoots: ["/repo", "/repo/packages/api"],
            }),
        });

        await readAll(stream);

        const threadStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "thread/start",
        );
        const turnStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "turn/start",
        );

        expect(threadStartMessage?.params).toMatchObject({
            cwd: "/repo",
            runtimeWorkspaceRoots: ["/repo", "/repo/packages/api"],
        });
        expect(turnStartMessage?.params).toMatchObject({
            cwd: "/repo",
            runtimeWorkspaceRoots: ["/repo", "/repo/packages/api"],
        });
    });

    it("resumes an existing thread when providerMetadata carries a threadId", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "user", content: [{ type: "text", text: "hi" }] },
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Hello" }],
                    providerOptions: { [CODEX_PROVIDER_ID]: { threadId: "thr_existing" } },
                },
                { role: "user", content: [{ type: "text", text: "continue" }] },
            ],
        });

        await readAll(stream);

        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(methods).toEqual(["initialize", "initialized", "thread/resume", "turn/start"]);

        const resumeMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "thread/resume",
        );
        expect(resumeMessage?.params).toMatchObject({
            threadId: "thr_existing",
            initialTurnsPage: {
                limit: 5,
                itemsView: "full",
                sortDirection: "desc",
            },
        });
        expect(resumeMessage?.params).not.toHaveProperty("persistExtendedHistory");

        const turnStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "turn/start",
        );
        expect(turnStartMessage?.params).toMatchObject({
            input: [{ type: "text", text: "continue", text_elements: [] }],
        });
    });

    it("resumes an existing thread from explicit call options without provider metadata", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "user", content: [{ type: "text", text: "continue" }] },
            ],
            providerOptions: codexCallOptions({
                resumeThreadId: "thr_explicit",
            }),
        });

        await readAll(stream);

        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(methods).toEqual(["initialize", "initialized", "thread/resume", "turn/start"]);

        const resumeMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "thread/resume",
        );
        expect(resumeMessage?.params).toMatchObject({ threadId: "thr_explicit" });
    });

    it("passes runtime workspace roots through thread/resume and turn/start", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "user", content: [{ type: "text", text: "hi" }] },
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Hello" }],
                    providerOptions: { [CODEX_PROVIDER_ID]: { threadId: "thr_existing" } },
                },
                { role: "user", content: [{ type: "text", text: "continue" }] },
            ],
            providerOptions: codexCallOptions({
                cwd: "/repo",
                runtimeWorkspaceRoots: ["/repo"],
            }),
        });

        await readAll(stream);

        const resumeMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "thread/resume",
        );
        const turnStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "turn/start",
        );

        expect(resumeMessage?.params).toMatchObject({
            threadId: "thr_existing",
            cwd: "/repo",
            runtimeWorkspaceRoots: ["/repo"],
        });
        expect(turnStartMessage?.params).toMatchObject({
            threadId: "thr_1",
            cwd: "/repo",
            runtimeWorkspaceRoots: ["/repo"],
        });
    });

    it("resumes a thread when threadId is on content-part providerOptions", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "user", content: [{ type: "text", text: "hi" }] },
                {
                    role: "assistant",
                    content: [
                        {
                            type: "text",
                            text: "Hello",
                            providerOptions: { [CODEX_PROVIDER_ID]: { threadId: "thr_content_part" } },
                        },
                    ],
                },
                { role: "user", content: [{ type: "text", text: "continue" }] },
            ],
        });

        await readAll(stream);

        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(methods).toEqual(["initialize", "initialized", "thread/resume", "turn/start"]);

        const resumeMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "thread/resume",
        );
        expect(resumeMessage?.params).toMatchObject({ threadId: "thr_content_part" });
    });

    it("can compact a resumed thread before turn/start", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            compaction: { shouldCompactOnResume: true },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "user", content: [{ type: "text", text: "hi" }] },
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Hello" }],
                    providerOptions: { [CODEX_PROVIDER_ID]: { threadId: "thr_existing" } },
                },
                { role: "user", content: [{ type: "text", text: "continue" }] },
            ],
        });

        await readAll(stream);

        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(methods).toEqual([
            "initialize",
            "initialized",
            "thread/resume",
            "thread/compact/start",
            "turn/start",
        ]);
    });

    it("continues when non-strict compaction fails", async () =>
    {
        const transport = new CompactionFailingTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            compaction: { shouldCompactOnResume: true },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "user", content: [{ type: "text", text: "hi" }] },
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Hello" }],
                    providerOptions: { [CODEX_PROVIDER_ID]: { threadId: "thr_existing" } },
                },
                { role: "user", content: [{ type: "text", text: "continue" }] },
            ],
        });

        await readAll(stream);

        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(methods).toEqual([
            "initialize",
            "initialized",
            "thread/resume",
            "thread/compact/start",
            "turn/start",
        ]);
    });

    it("supports callback-based compaction decision with resume context", async () =>
    {
        const transport = new ScriptedTransport();
        const shouldCompactOnResume = vi.fn<(context: unknown) => boolean>(() => true);

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            compaction: { shouldCompactOnResume },
        });

        const model = provider.languageModel("gpt-5.5");

        const prompt: LanguageModelV3CallOptions["prompt"] = [
            { role: "user", content: [{ type: "text", text: "hi" }] },
            {
                role: "assistant",
                content: [{ type: "text", text: "Hello" }],
                providerOptions: { [CODEX_PROVIDER_ID]: { threadId: "thr_existing" } },
            },
            { role: "user", content: [{ type: "text", text: "continue" }] },
        ];

        const { stream } = await model.doStream({ prompt });
        await readAll(stream);

        expect(shouldCompactOnResume).toHaveBeenCalledTimes(1);
        const firstCall = shouldCompactOnResume.mock.calls[0];
        expect(firstCall).toBeDefined();
        const typedCallbackContext = firstCall![0] as {
            threadId: string;
            resumeThreadId: string;
            resumeResult: { thread: { id: string } };
            prompt: unknown[];
        };
        expect(typedCallbackContext).toMatchObject({
            threadId: "thr_1",
            resumeThreadId: "thr_existing",
            resumeResult: { thread: { id: "thr_1" } },
        });
        expect(typedCallbackContext.prompt).toEqual(prompt);

        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(methods).toEqual([
            "initialize",
            "initialized",
            "thread/resume",
            "thread/compact/start",
            "turn/start",
        ]);
    });

    it("skips compaction when callback returns false", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            compaction: { shouldCompactOnResume: () => false },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "user", content: [{ type: "text", text: "hi" }] },
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Hello" }],
                    providerOptions: { [CODEX_PROVIDER_ID]: { threadId: "thr_existing" } },
                },
                { role: "user", content: [{ type: "text", text: "continue" }] },
            ],
        });

        await readAll(stream);

        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(methods).toEqual([
            "initialize",
            "initialized",
            "thread/resume",
            "turn/start",
        ]);
    });

    it("continues when callback throws in non-strict mode", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            compaction: { shouldCompactOnResume: () => { throw new Error("decision failed"); } },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "user", content: [{ type: "text", text: "hi" }] },
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Hello" }],
                    providerOptions: { [CODEX_PROVIDER_ID]: { threadId: "thr_existing" } },
                },
                { role: "user", content: [{ type: "text", text: "continue" }] },
            ],
        });

        await readAll(stream);

        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(methods).toEqual([
            "initialize",
            "initialized",
            "thread/resume",
            "turn/start",
        ]);
    });

    it("fails before turn/start when callback throws in strict mode", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            compaction: {
                shouldCompactOnResume: () => { throw new Error("decision failed"); },
                strict: true,
            },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "user", content: [{ type: "text", text: "hi" }] },
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Hello" }],
                    providerOptions: { [CODEX_PROVIDER_ID]: { threadId: "thr_existing" } },
                },
                { role: "user", content: [{ type: "text", text: "continue" }] },
            ],
        });

        const parts = await readAll(stream);
        expect(parts.some((part) => (
            typeof part === "object"
            && part !== null
            && "type" in part
            && (part as { type: string }).type === "error"
        ))).toBe(true);

        const methods = transport.sentMessages
            .filter((message): message is { method: string } => "method" in message)
            .map((message) => message.method);

        expect(methods).toEqual([
            "initialize",
            "initialized",
            "thread/resume",
        ]);
    });

    it("passes system messages as developerInstructions on thread/start", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            experimentalApi: true,
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "system", content: "Be concise." },
                { role: "user", content: [{ type: "text", text: "hello" }] },
            ],
        });

        await readAll(stream);

        const threadStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "thread/start",
        );
        expect(threadStartMessage?.params).toMatchObject({
            developerInstructions: "Be concise.",
        });

        const turnStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "turn/start",
        );
        expect(turnStartMessage?.params).toMatchObject({
            input: [{ type: "text", text: "hello", text_elements: [] }],
        });
    });

    it("passes defaultTurnSettings including rich sandboxPolicy on turn/start", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            defaultTurnSettings: {
                approvalPolicy: "on-request",
                sandboxPolicy: {
                    type: "externalSandbox",
                    networkAccess: "enabled",
                },
            },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        });

        await readAll(stream);

        const turnStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "turn/start",
        );

        expect(turnStartMessage?.params).toMatchObject({
            approvalPolicy: "on-request",
            sandboxPolicy: {
                type: "externalSandbox",
                networkAccess: "enabled",
            },
        });
    });

    it("passes approvalsReviewer defaults through thread/start and turn/start", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            defaultThreadSettings: {
                approvalsReviewer: "guardian_subagent",
            },
            defaultTurnSettings: {
                approvalsReviewer: "guardian_subagent",
            },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        });

        await readAll(stream);

        const threadStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "thread/start",
        );
        const turnStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "turn/start",
        );

        expect(threadStartMessage?.params).toMatchObject({
            approvalsReviewer: "guardian_subagent",
        });
        expect(turnStartMessage?.params).toMatchObject({
            approvalsReviewer: "guardian_subagent",
        });
    });

    it("passes per-call ephemeral through thread/start", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
            providerOptions: {
                [CODEX_PROVIDER_ID]: {
                    ephemeral: true,
                },
            },
        });

        await readAll(stream);

        const threadStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "thread/start",
        );

        expect(threadStartMessage?.params).toMatchObject({
            ephemeral: true,
        });
    });

    it("passes per-call approvalsReviewer overrides through thread/resume and turn/start", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            defaultThreadSettings: {
                approvalsReviewer: "user",
            },
            defaultTurnSettings: {
                approvalsReviewer: "user",
            },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "user", content: [{ type: "text", text: "hi" }] },
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Hello" }],
                    providerOptions: { [CODEX_PROVIDER_ID]: { threadId: "thr_existing" } },
                },
                { role: "user", content: [{ type: "text", text: "continue" }] },
            ],
            providerOptions: {
                [CODEX_PROVIDER_ID]: {
                    approvalsReviewer: "guardian_subagent",
                },
            },
        });

        await readAll(stream);

        const threadResumeMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "thread/resume",
        );
        const turnStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "turn/start",
        );

        expect(threadResumeMessage?.params).toMatchObject({
            approvalsReviewer: "guardian_subagent",
        });
        expect(turnStartMessage?.params).toMatchObject({
            approvalsReviewer: "guardian_subagent",
        });
    });

    it("forwards responseFormat JSON schema to turn/start outputSchema", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
        });

        const model = provider.languageModel("gpt-5.5");

        const schema = {
            type: "object" as const,
            properties: {
                answer: { type: "string" as const },
                confidence: { type: "number" as const },
            },
            required: ["answer"],
            additionalProperties: false,
        };

        const outputSchema: unknown = JSON.parse(JSON.stringify(schema));

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
            responseFormat: {
                type: "json",
                schema,
            },
        });

        await readAll(stream);

        const turnStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "turn/start",
        );

        expect(turnStartMessage?.params).toMatchObject({
            outputSchema,
        });
    });

    it("forwards mcpServers as config on thread/start", async () =>
    {
        const transport = new ScriptedTransport();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            mcpServers: {
                filesystem: {
                    type: "stdio",
                    command: "npx",
                    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                },
            },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        });

        await readAll(stream);

        const threadStartMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "thread/start",
        );

        expect(threadStartMessage?.params).toMatchObject({
            config: {
                mcp_servers: {
                    filesystem: {
                        type: "stdio",
                        command: "npx",
                        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                    },
                },
            },
        });
    });

    it("emits debug events through the logger when logPackets is enabled", async () =>
    {
        const transport = new ScriptedTransport();
        const loggerSpy = vi.fn();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            debug: { logPackets: true, logger: loggerSpy },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        });

        await readAll(stream);

        const debugEvents = loggerSpy.mock.calls
            .map((call: unknown[]) => call[0] as { direction: string; message: unknown })
            .filter((packet) =>
                typeof packet.message === "object"
                && packet.message !== null
                && "debug" in packet.message,
            );

        const debugLabels = debugEvents.map(
            (e) => (e.message as { debug: string }).debug,
        );

        expect(debugLabels).toContain("prompt");
        expect(debugLabels).toContain("extractResumeThreadId");
        expect(debugLabels).toContain("thread/start");
        expect(debugLabels).toContain("turn/start");

        const promptEvent = debugEvents.find(
            (e) => (e.message as { debug: string }).debug === "prompt",
        );
        expect(promptEvent?.direction).toBe("inbound");

        const extractEvent = debugEvents.find(
            (e) => (e.message as { debug: string }).debug === "extractResumeThreadId",
        );
        expect(extractEvent?.direction).toBe("inbound");
        expect((extractEvent?.message as { data: unknown }).data).toEqual({
            resumeThreadId: undefined,
        });

        const threadStartEvent = debugEvents.find(
            (e) => (e.message as { debug: string }).debug === "thread/start",
        );
        expect(threadStartEvent?.direction).toBe("outbound");

        const turnStartEvent = debugEvents.find(
            (e) => (e.message as { debug: string }).debug === "turn/start",
        );
        expect(turnStartEvent?.direction).toBe("outbound");
        expect((turnStartEvent?.message as { data: { threadId: string } }).data).toMatchObject({
            threadId: "thr_1",
        });
    });

    it("emits thread/resume debug event when resuming a thread", async () =>
    {
        const transport = new ScriptedTransport();
        const loggerSpy = vi.fn();

        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
            debug: { logPackets: true, logger: loggerSpy },
        });

        const model = provider.languageModel("gpt-5.5");

        const { stream } = await model.doStream({
            prompt: [
                { role: "user", content: [{ type: "text", text: "hi" }] },
                {
                    role: "assistant",
                    content: [{ type: "text", text: "Hello" }],
                    providerOptions: { [CODEX_PROVIDER_ID]: { threadId: "thr_existing" } },
                },
                { role: "user", content: [{ type: "text", text: "continue" }] },
            ],
        });

        await readAll(stream);

        const debugEvents = loggerSpy.mock.calls
            .map((call: unknown[]) => call[0] as { direction: string; message: unknown })
            .filter((packet) =>
                typeof packet.message === "object"
                && packet.message !== null
                && "debug" in packet.message,
            );

        const debugLabels = debugEvents.map(
            (e) => (e.message as { debug: string }).debug,
        );

        expect(debugLabels).toContain("extractResumeThreadId");
        expect(debugLabels).toContain("thread/resume");
        expect(debugLabels).not.toContain("thread/start");

        const extractEvent = debugEvents.find(
            (e) => (e.message as { debug: string }).debug === "extractResumeThreadId",
        );
        expect((extractEvent?.message as { data: unknown }).data).toEqual({
            resumeThreadId: "thr_existing",
        });

        const resumeEvent = debugEvents.find(
            (e) => (e.message as { debug: string }).debug === "thread/resume",
        );
        expect(resumeEvent?.direction).toBe("outbound");
        expect((resumeEvent?.message as { data: { threadId: string } }).data).toMatchObject({
            threadId: "thr_existing",
        });
    });

    it("sends turn/interrupt when abortSignal is triggered after turn/start", async () =>
    {
        const transport = new InterruptAwareTransport();
        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
        });
        const model = provider.languageModel("gpt-5.5");
        const abortController = new AbortController();

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "interrupt me" }] }],
            abortSignal: abortController.signal,
        });

        await new Promise(resolve => setTimeout(resolve, 0));
        abortController.abort();

        await readAll(stream);

        // turn/interrupt now fires in the background AFTER the stream closes; let it run.
        await new Promise(resolve => setTimeout(resolve, 0));

        const interruptMessage = transport.sentMessages.find(
            (message): message is { method: string; params?: unknown } =>
                "method" in message && message.method === "turn/interrupt",
        );
        expect(interruptMessage).toBeDefined();
        expect(interruptMessage?.params).toMatchObject({
            threadId: "thr_abort",
            turnId: "turn_abort",
        });
    });

    it("closes the stream immediately on abort, without waiting for turn/interrupt to settle", async () =>
    {
        let interruptResolved = false;

        // Acks everything immediately EXCEPT turn/interrupt, whose response is delayed — so a
        // stream that closed before the interrupt settled proves the close no longer blocks on it.
        class DelayedInterruptTransport extends InterruptAwareTransport
        {
            override async sendMessage(message: JsonRpcMessage): Promise<void>
            {
                if ("method" in message && message.method === "turn/interrupt")
                {
                    await MockTransport.prototype.sendMessage.call(this, message);
                    setTimeout(() =>
                    {
                        interruptResolved = true;
                        this.emitMessage({ id: (message as { id: string | number }).id, result: {} });
                    }, 200);
                    return;
                }

                await super.sendMessage(message);
            }
        }

        const transport = new DelayedInterruptTransport();
        const provider = createCodexAppServer({
            transportFactory: () => transport,
            clientInfo: { name: "test-client", version: "1.0.0" },
        });
        const model = provider.languageModel("gpt-5.5");
        const abortController = new AbortController();

        const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "interrupt me" }] }],
            abortSignal: abortController.signal,
        });

        await new Promise(resolve => setTimeout(resolve, 0));
        abortController.abort();

        const parts = await readAll(stream) as Array<{ type?: string; error?: unknown }>;

        // The stream closed before the (delayed) interrupt resolved — the whole point of the fix.
        expect(interruptResolved).toBe(false);

        // …and it ended with an AbortError part rather than hanging.
        const errorPart = parts.find(part => part.type === "error");
        expect(errorPart).toBeDefined();
        expect((errorPart?.error as Error)?.name).toBe("AbortError");

        // The interrupt is still attempted in the background; let it settle so no timer leaks.
        await new Promise(resolve => setTimeout(resolve, 250));
        expect(interruptResolved).toBe(true);

        const interruptMessage = transport.sentMessages.find(
            (message): message is { method: string } =>
                "method" in message && message.method === "turn/interrupt",
        );
        expect(interruptMessage).toBeDefined();
    });
});
