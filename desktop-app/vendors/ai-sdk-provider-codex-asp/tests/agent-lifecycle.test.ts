import { describe, expect, it } from "vitest";

import { agentLifecycleEvents } from "../src/agent-lifecycle";

describe("agent lifecycle normalization", () =>
{
    it("maps sub-agent activity from the active notification stream", () =>
    {
        expect(agentLifecycleEvents("item/started", {
            threadId: "parent",
            turnId: "turn-1",
            startedAtMs: 123,
            item: {
                type: "subAgentActivity",
                id: "activity-1",
                kind: "started",
                agentThreadId: "agent-1",
                agentPath: "/repo",
            },
        })).toEqual([{
            kind: "started",
            threadId: "parent",
            turnId: "turn-1",
            agentThreadId: "agent-1",
            agentPath: "/repo",
            status: "started",
            toolCallId: "activity-1",
            timestampMs: 123,
        }]);
    });

    it("keeps completed agents referenceable and removes closed agents", () =>
    {
        const base = {
            threadId: "parent",
            turnId: "turn-1",
            completedAtMs: 456,
            item: {
                type: "collabAgentToolCall",
                id: "collab-1",
                tool: "wait",
                receiverThreadIds: ["agent-1", "agent-2"],
                agentsStates: {
                    "agent-1": { status: "completed", message: null },
                    "agent-2": { status: "shutdown", message: null },
                },
            },
        };

        expect(agentLifecycleEvents("item/completed", base)).toEqual([
            expect.objectContaining({ agentThreadId: "agent-1", kind: "completed", status: "completed" }),
            expect.objectContaining({ agentThreadId: "agent-2", kind: "closed", status: "shutdown" }),
        ]);
    });

    it("keeps interrupted activity as a visible non-running agent state", () =>
    {
        expect(agentLifecycleEvents("item/completed", {
            threadId: "parent",
            turnId: "turn-1",
            item: {
                type: "subAgentActivity",
                id: "activity-2",
                kind: "interrupted",
                agentThreadId: "agent-1",
                agentPath: "/repo",
            },
        })).toEqual([expect.objectContaining({
            kind: "updated",
            status: "interrupted",
            agentThreadId: "agent-1",
        })]);
    });

    it("ignores unrelated and malformed notifications", () =>
    {
        expect(agentLifecycleEvents("turn/completed", {})).toEqual([]);
        expect(agentLifecycleEvents("item/started", { item: { type: "subAgentActivity" } })).toEqual([]);
    });
});
