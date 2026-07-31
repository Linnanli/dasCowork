import { describe, expect, it } from "vitest";

import { fileChangeDiffBatchesForOrderedItems } from "../src/protocol/turn-diff";

describe("fileChangeDiffBatchesForOrderedItems", () =>
{
    it("uses only successful non-empty file changes and carries forward non-empty command cwd values", () =>
    {
        const firstChange = {
            path: "src/a.ts",
            kind: { type: "add" as const },
            diff: "first\n",
        };
        const secondChange = {
            path: "src/b.ts",
            kind: { type: "add" as const },
            diff: "second\n",
        };
        const items = [
            { type: "commandExecution", cwd: "/repo/a" },
            { type: "fileChange", status: "completed", changes: [firstChange] },
            { type: "commandExecution", cwd: "" },
            { type: "fileChange", status: "failed", changes: [secondChange] },
            { type: "fileChange", status: "declined", changes: [secondChange] },
            { type: "fileChange", status: "completed", changes: [] },
            { type: "commandExecution", cwd: "/repo/b" },
            { type: "fileChange", status: "completed", changes: [secondChange] },
        ] as never;

        expect(fileChangeDiffBatchesForOrderedItems(items, "/repo")).toEqual([
            { cwd: "/repo/a", changes: [firstChange] },
            { cwd: "/repo/b", changes: [secondChange] },
        ]);
    });
});
