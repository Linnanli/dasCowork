import { describe, expect, it } from "vitest";

import { CodexEventMapper } from "../src/protocol/event-mapper";
import { CODEX_PROVIDER_ID } from "../src/protocol/provider-metadata";

describe("CodexEventMapper source metadata", () =>
{
    it("attaches source item ids to mapped content parts", () =>
    {
        const mapper = new CodexEventMapper();

        const parts = [
            { method: "turn/started", params: { threadId: "thr", turn: { id: "turn" } } },
            {
                method: "item/started",
                params: {
                    item: { type: "agentMessage", id: "message_1", text: "" },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/agentMessage/delta",
                params: {
                    threadId: "thr",
                    turnId: "turn",
                    itemId: "message_1",
                    delta: "Hello",
                },
            },
            {
                method: "item/completed",
                params: {
                    item: { type: "agentMessage", id: "message_1", text: "Hello" },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/started",
                params: {
                    item: { type: "reasoning", id: "reasoning_1", summary: [], content: [] },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
            {
                method: "item/reasoning/textDelta",
                params: {
                    threadId: "thr",
                    turnId: "turn",
                    itemId: "reasoning_1",
                    delta: "Think",
                },
            },
            {
                method: "item/started",
                params: {
                    item: {
                        type: "commandExecution",
                        id: "command_1",
                        command: "pwd",
                        cwd: "/repo",
                        status: "inProgress",
                        commandActions: [],
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
                        id: "image_1",
                        status: "completed",
                        revisedPrompt: null,
                        result: "abc123",
                    },
                    threadId: "thr",
                    turnId: "turn",
                },
            },
        ].flatMap((event) => mapper.map(event));

        expect(parts.flatMap(sourceItemIdForPart)).toEqual([
            "message_1",
            "message_1",
            "message_1",
            "reasoning_1",
            "reasoning_1",
            "command_1",
            "image_1",
        ]);
    });
});

function sourceItemIdForPart(part: unknown): string[]
{
    if (!part || typeof part !== "object")
    {
        return [];
    }
    const providerMetadata = (part as Record<string, unknown>)["providerMetadata"];
    if (!providerMetadata || typeof providerMetadata !== "object")
    {
        return [];
    }
    const metadata = (providerMetadata as Record<string, unknown>)[CODEX_PROVIDER_ID];
    if (!metadata || typeof metadata !== "object")
    {
        return [];
    }
    const sourceItemId = (metadata as Record<string, unknown>)["sourceItemId"];
    return typeof sourceItemId === "string" ? [sourceItemId] : [];
}
