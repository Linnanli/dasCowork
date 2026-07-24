import { describe, expect, it } from "vitest";

import { TurnLifecycleNormalizer } from "../src/turn-lifecycle";

describe("TurnLifecycleNormalizer", () =>
{
    it("retains the exact completed item for a host-owned recovery journal", () =>
    {
        const normalizer = new TurnLifecycleNormalizer();
        const item = {
            id: "command-1",
            type: "commandExecution",
            command: "pwd",
            cwd: "/repo",
            processId: "pid-1",
            source: "agent",
            commandActions: [],
            aggregatedOutput: "/repo",
            exitCode: 0,
            status: "completed",
            durationMs: 12,
        };

        expect(
            normalizer.normalize("item/completed", {
                threadId: "thread_1",
                turnId: "turn_1",
                item,
            }),
        ).toEqual({
            type: "item-completed",
            sequence: 1,
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "command-1",
            itemType: "commandExecution",
            item,
        });
    });

    it("retains a failed turn's app-server detail for the main-process terminal mapper", () =>
    {
        const normalizer = new TurnLifecycleNormalizer();

        expect(
            normalizer.normalize("turn/completed", {
                threadId: "thread_1",
                turn: {
                    id: "turn_1",
                    status: "failed",
                    error: { message: "The free quota has been exhausted." },
                },
            }),
        ).toEqual({
            type: "turn-completed",
            sequence: 1,
            threadId: "thread_1",
            turnId: "turn_1",
            outcome: "failed",
            error: "The free quota has been exhausted.",
        });
    });
});
