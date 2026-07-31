import { describe, expect, it, vi } from "vitest";

import { AppServerClient } from "../src/client/app-server-client";
import type { JsonRpcMessage, JsonRpcRequest } from "../src/client/transport";
import { CodexCommandClient } from "../src/command-client";
import { MockTransport } from "./helpers/mock-transport";

describe("CodexCommandClient", () =>
{
    it("initializes once and aggregates streamed output for one command", async () =>
    {
        const { client, commandClient, transport } = await connectedCommandClient();

        const resultPromise = commandClient.exec({ command: ["printf", "hello"] });
        const commandRequest = await waitForRequest(transport, "command/exec");
        const processId = commandProcessId(commandRequest);

        emitOutput(transport, "ignored-process", "stdout", "wrong");
        emitOutput(transport, processId, "stdout", "hello");
        emitOutput(transport, processId, "stderr", "warn", true);
        transport.emitMessage({
            id: commandRequest.id,
            result: { exitCode: 0, stdout: "", stderr: "" },
        });

        await expect(resultPromise).resolves.toEqual({
            processId,
            exitCode: 0,
            stdout: "hello",
            stderr: "warn",
            stdoutCapReached: false,
            stderrCapReached: true,
        });

        await commandClient.connect();
        expect(commandClient.serverInfo).toEqual({ name: "mock-codex", version: "1.0.0" });
        expect(methods(transport).filter((method) => method === "initialize")).toHaveLength(1);
        await client.disconnect();
    });

    it("writes optional stdin through command/exec/write", async () =>
    {
        const { client, commandClient, transport } = await connectedCommandClient();

        const resultPromise = commandClient.exec({
            command: ["cat"],
            stdin: "input\n",
        });
        const commandRequest = await waitForRequest(transport, "command/exec");
        const processId = commandProcessId(commandRequest);
        const writeRequest = await waitForRequest(transport, "command/exec/write");

        expect(writeRequest.params).toEqual({
            processId,
            deltaBase64: Buffer.from("input\n").toString("base64"),
            closeStdin: true,
        });

        transport.emitMessage({ id: writeRequest.id, result: {} });
        transport.emitMessage({
            id: commandRequest.id,
            result: { exitCode: 0, stdout: "input\n", stderr: "" },
        });

        await expect(resultPromise).resolves.toMatchObject({
            stdout: "input\n",
            stderr: "",
        });
        await client.disconnect();
    });

    it("terminates the process and rejects when the abort signal fires", async () =>
    {
        const { client, commandClient, transport } = await connectedCommandClient();
        const controller = new AbortController();

        const resultPromise = commandClient.exec({
            command: ["sleep", "60"],
            signal: controller.signal,
        });
        const commandRequest = await waitForRequest(transport, "command/exec");
        const processId = commandProcessId(commandRequest);

        controller.abort();
        const terminateRequest = await waitForRequest(transport, "command/exec/terminate");

        expect(terminateRequest.params).toEqual({ processId });
        await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
        await client.disconnect();
    });

    it("isolates streamed output for concurrent processes", async () =>
    {
        const { client, commandClient, transport } = await connectedCommandClient();

        const firstPromise = commandClient.exec({ command: ["one"] });
        const firstRequest = await waitForRequest(transport, "command/exec");
        const firstProcessId = commandProcessId(firstRequest);

        const secondPromise = commandClient.exec({ command: ["two"] });
        const secondRequest = await waitForNthRequest(transport, "command/exec", 2);
        const secondProcessId = commandProcessId(secondRequest);

        emitOutput(transport, secondProcessId, "stdout", "two");
        emitOutput(transport, firstProcessId, "stdout", "one");
        transport.emitMessage({
            id: secondRequest.id,
            result: { exitCode: 0, stdout: "", stderr: "" },
        });
        transport.emitMessage({
            id: firstRequest.id,
            result: { exitCode: 0, stdout: "", stderr: "" },
        });

        await expect(firstPromise).resolves.toMatchObject({ processId: firstProcessId, stdout: "one" });
        await expect(secondPromise).resolves.toMatchObject({
            processId: secondProcessId,
            stdout: "two",
        });
        expect(firstProcessId).not.toBe(secondProcessId);
        await client.disconnect();
    });

    it("passes timeout and output cap settings to command/exec", async () =>
    {
        const { client, commandClient, transport } = await connectedCommandClient();

        const resultPromise = commandClient.exec({
            command: ["bounded"],
            timeoutMs: 1234,
            outputBytesCap: 56,
            sandboxPolicy: { type: "readOnly", networkAccess: false },
        });
        const commandRequest = await waitForRequest(transport, "command/exec");

        expect(commandRequest.params).toMatchObject({
            timeoutMs: 1234,
            outputBytesCap: 56,
            streamStdoutStderr: true,
            sandboxPolicy: { type: "readOnly", networkAccess: false },
        });

        transport.emitMessage({
            id: commandRequest.id,
            result: { exitCode: 0, stdout: "", stderr: "" },
        });
        await resultPromise;
        await client.disconnect();
    });

    it("rejects an active command when the connection closes", async () =>
    {
        const { client, commandClient, transport } = await connectedCommandClient();

        const resultPromise = commandClient.exec({ command: ["long-running"] });
        await waitForRequest(transport, "command/exec");

        transport.emitClose(1, null);

        await expect(resultPromise).rejects.toThrow("App Server transport closed unexpectedly");
        await client.disconnect();
    });

    it("recreates the logical client after transport close and succeeds on the next exec", async () =>
    {
        const { commandClient, clients, transports } = reconnectableCommandClient();

        const firstPromise = commandClient.exec({ command: ["first"] });
        const firstTransport = await waitForTransport(transports, 0);
        await initializeTransport(firstTransport);
        const firstRequest = await waitForRequest(firstTransport, "command/exec");
        transportSuccess(firstTransport, firstRequest.id, "first");
        await expect(firstPromise).resolves.toMatchObject({ stdout: "first" });

        firstTransport.emitClose(1, null);
        await vi.waitFor(() =>
        {
            expect(commandClient.serverInfo).toBeUndefined();
        });

        const secondPromise = commandClient.exec({ command: ["second"] });
        await vi.waitFor(() =>
        {
            expect(clients).toHaveLength(2);
            expect(transports).toHaveLength(2);
        });
        const secondTransport = await waitForTransport(transports, 1);
        await initializeTransport(secondTransport);
        const secondRequest = await waitForRequest(secondTransport, "command/exec");
        transportSuccess(secondTransport, secondRequest.id, "second");

        await expect(secondPromise).resolves.toMatchObject({ stdout: "second" });
        expect(requests(firstTransport, "initialize")).toHaveLength(1);
        expect(requests(secondTransport, "initialize")).toHaveLength(1);
        await Promise.all(clients.map((client) => client.disconnect().catch(() => undefined)));
    });

    it("fails only the active command on close and reconnects for the next exec", async () =>
    {
        const { commandClient, clients, transports } = reconnectableCommandClient();

        const activePromise = commandClient.exec({ command: ["long-running"] });
        const firstTransport = await waitForTransport(transports, 0);
        await initializeTransport(firstTransport);
        await waitForRequest(firstTransport, "command/exec");
        firstTransport.emitClose(1, null);

        await expect(activePromise).rejects.toThrow("App Server transport closed unexpectedly");

        const retryPromise = commandClient.exec({ command: ["retry"] });
        await vi.waitFor(() =>
        {
            expect(clients).toHaveLength(2);
        });
        const retryTransport = await waitForTransport(transports, 1);
        await initializeTransport(retryTransport);
        const retryRequest = await waitForRequest(retryTransport, "command/exec");
        transportSuccess(retryTransport, retryRequest.id, "retry");

        await expect(retryPromise).resolves.toMatchObject({ stdout: "retry" });
        await Promise.all(clients.map((client) => client.disconnect().catch(() => undefined)));
    });

    it("shares one replacement connection across concurrent exec retries after close", async () =>
    {
        const { commandClient, clients, transports } = reconnectableCommandClient();

        const connectPromise = commandClient.connect();
        const firstTransport = await waitForTransport(transports, 0);
        await initializeTransport(firstTransport);
        await connectPromise;
        firstTransport.emitClose(1, null);
        await vi.waitFor(() =>
        {
            expect(commandClient.serverInfo).toBeUndefined();
        });

        const firstPromise = commandClient.exec({ command: ["one"] });
        const secondPromise = commandClient.exec({ command: ["two"] });
        await vi.waitFor(() =>
        {
            expect(clients).toHaveLength(2);
        });

        const retryTransport = await waitForTransport(transports, 1);
        await initializeTransport(retryTransport);
        await waitForNthRequest(retryTransport, "command/exec", 2);
        const [firstRequest, secondRequest] = requests(retryTransport, "command/exec") as [
            JsonRpcRequest,
            JsonRpcRequest,
        ];
        transportSuccess(retryTransport, firstRequest.id, "one");
        transportSuccess(retryTransport, secondRequest.id, "two");

        await expect(firstPromise).resolves.toMatchObject({ stdout: "one" });
        await expect(secondPromise).resolves.toMatchObject({ stdout: "two" });
        expect(requests(retryTransport, "initialize")).toHaveLength(1);
        await Promise.all(clients.map((client) => client.disconnect().catch(() => undefined)));
    });
});

async function connectedCommandClient(): Promise<{
    client: AppServerClient
    commandClient: CodexCommandClient
    transport: MockTransport
}>
{
    const transport = new MockTransport();
    const client = new AppServerClient(transport, { requestTimeoutMs: 1000 });
    const commandClient = new CodexCommandClient({ createClient: () => client });

    const connectPromise = commandClient.connect();
    const initializeRequest = await waitForRequest(transport, "initialize");
    transport.emitMessage({
        id: initializeRequest.id,
        result: { serverInfo: { name: "mock-codex", version: "1.0.0" } },
    });
    await connectPromise;

    return { client, commandClient, transport };
}

function reconnectableCommandClient(): {
    clients: AppServerClient[]
    commandClient: CodexCommandClient
    transports: MockTransport[]
}
{
    const clients: AppServerClient[] = [];
    const transports: MockTransport[] = [];
    const commandClient = new CodexCommandClient({
        createClient: () =>
        {
            const transport = new MockTransport();
            const client = new AppServerClient(transport, { requestTimeoutMs: 1000 });
            transports.push(transport);
            clients.push(client);
            return client;
        },
    });

    return { clients, commandClient, transports };
}

async function initializeTransport(transport: MockTransport): Promise<void>
{
    const initializeRequest = await waitForRequest(transport, "initialize");
    transport.emitMessage({
        id: initializeRequest.id,
        result: { serverInfo: { name: "mock-codex", version: "1.0.0" } },
    });
}

async function waitForTransport(
    transports: MockTransport[],
    index: number,
): Promise<MockTransport>
{
    await vi.waitFor(() =>
    {
        expect(transports[index]).toBeDefined();
    });
    return transports[index]!;
}

function transportSuccess(transport: MockTransport, id: JsonRpcRequest["id"], stdout: string): void
{
    transport.emitMessage({
        id,
        result: { exitCode: 0, stdout, stderr: "" },
    });
}

async function waitForRequest(transport: MockTransport, method: string): Promise<JsonRpcRequest>
{
    return waitForNthRequest(transport, method, 1);
}

async function waitForNthRequest(
    transport: MockTransport,
    method: string,
    count: number,
): Promise<JsonRpcRequest>
{
    await vi.waitFor(() =>
    {
        expect(requests(transport, method)).toHaveLength(count);
    });

    return requests(transport, method)[count - 1]!;
}

function requests(transport: MockTransport, method: string): JsonRpcRequest[]
{
    return transport.sentMessages.filter(
        (message): message is JsonRpcRequest =>
            "id" in message && "method" in message && message.method === method,
    );
}

function commandProcessId(request: JsonRpcRequest): string
{
    if (!request.params || typeof request.params !== "object" || !("processId" in request.params))
    {
        throw new Error("Expected command request processId.");
    }

    const { processId } = request.params as { processId?: unknown };
    if (typeof processId !== "string")
    {
        throw new Error("Expected command request processId string.");
    }

    return processId;
}

function emitOutput(
    transport: MockTransport,
    processId: string,
    stream: "stdout" | "stderr",
    text: string,
    capReached = false,
): void
{
    transport.emitMessage({
        method: "command/exec/outputDelta",
        params: {
            processId,
            stream,
            deltaBase64: Buffer.from(text).toString("base64"),
            capReached,
        },
    });
}

function methods(transport: MockTransport): string[]
{
    return transport.sentMessages.flatMap((message: JsonRpcMessage) =>
        "method" in message ? [message.method] : [],
    );
}
