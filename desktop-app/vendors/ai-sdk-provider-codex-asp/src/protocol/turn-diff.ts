import { stripUndefined } from "../utils/object";
import type { FileUpdateChange } from "./app-server-protocol/v2/FileUpdateChange";

export const TURN_DIFF_PREVIEW_CHAR_LIMIT = 50_000;

export interface TurnDiffItem
{
    id: string;
    type: "turnDiff";
    status: "inProgress" | "completed";
    cwd?: string;
    diff: string;
    truncated: boolean;
    originalLength?: number;
}

export interface FileChangeDiffBatch
{
    changes: readonly FileUpdateChange[];
    cwd?: string | undefined;
}

export function turnDiffItem({
    id,
    status,
    cwd,
    diff,
}: {
    id: string;
    status: TurnDiffItem["status"];
    cwd?: string | undefined;
    diff: string;
}): TurnDiffItem
{
    const truncated = diff.length > TURN_DIFF_PREVIEW_CHAR_LIMIT;
    return stripUndefined({
        id,
        type: "turnDiff" as const,
        status,
        cwd,
        diff: truncated ? diff.slice(0, TURN_DIFF_PREVIEW_CHAR_LIMIT) : diff,
        truncated,
        originalLength: truncated ? diff.length : undefined,
    });
}

/**
 * Rebuild the turn-level unified diff from the persisted file-change items.
 * This mirrors the Codex Electron history fallback when no live turn diff is
 * available after reopening a thread.
 */
export function unifiedDiffForFileChanges(changes: readonly FileUpdateChange[]): string
{
    return unifiedDiffForFileChangeBatches([{ changes }]);
}

/**
 * The app server persists file changes but not its live turn diff. Rebuild the
 * latter with the same per-working-directory coalescing used by Codex Electron.
 */
export function unifiedDiffForFileChangeBatches(batches: readonly FileChangeDiffBatch[]): string
{
    const fragments: string[] = [];
    const updateFragmentIndexes = new Map<string, number>();

    for (const { changes, cwd } of batches)
    {
        for (const change of changes)
        {
            const fragment = unifiedDiffFragment(change);
            if (!fragment)
            {
                continue;
            }

            const path = change.kind.type === "update" && change.kind.move_path
                ? change.kind.move_path
                : change.path;
            const key = `${cwd ?? ""}\0${path}`;
            const isInPlaceUpdate = change.kind.type === "update" && !change.kind.move_path;
            const existingIndex = isInPlaceUpdate ? updateFragmentIndexes.get(key) : undefined;

            if (existingIndex !== undefined)
            {
                const hunkStart = fragment.startsWith("@@") ? 0 : fragment.indexOf("\n@@");
                if (hunkStart !== -1)
                {
                    fragments[existingIndex] = `${fragments[existingIndex]}\n${fragment.slice(hunkStart === 0 ? 0 : hunkStart + 1)}`;
                    continue;
                }
            }

            fragments.push(fragment);
            if (isInPlaceUpdate)
            {
                updateFragmentIndexes.set(key, fragments.length - 1);
            }
            else
            {
                updateFragmentIndexes.delete(key);
            }
        }
    }

    return fragments.length > 0 ? `${fragments.join("\n\n")}\n` : "";
}

function unifiedDiffFragment(change: FileUpdateChange): string | null
{
    switch (change.kind.type)
    {
        case "update":
            return updateDiffFragment(change.path, change.kind.move_path ?? change.path, change.diff);
        case "add":
            return addDiffFragment(change.path, change.diff);
        case "delete":
            return deleteDiffFragment(change.path, change.diff);
        default:
            return assertNever(change.kind);
    }
}

function updateDiffFragment(sourcePath: string, targetPath: string, diff: string): string
{
    const body = diff.trimStart();
    const includesFileHeaders = /\n?---\s/.test(body);
    const includesGitHeader = /^diff --git /m.test(body);
    const fileHeaders = includesFileHeaders
        ? body
        : `--- a/${sourcePath}\n+++ b/${targetPath}\n${body}`;
    return `${includesGitHeader ? "" : `diff --git a/${sourcePath} b/${targetPath}\n`}${fileHeaders}`.replace(/[\r\n]+$/, "");
}

function addDiffFragment(path: string, content: string): string
{
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const contentLines = lines.at(-1) === "" ? lines.slice(0, -1) : lines;
    const hunk = contentLines.length > 0
        ? `@@ -0,0 +1,${contentLines.length} @@\n${contentLines.map((line) => `+${line}`).join("\n")}\n`
        : "";
    return [
        `diff --git a/${path} b/${path}`,
        "new file mode 100644",
        "--- /dev/null",
        `+++ b/${path}`,
        hunk,
    ].filter(Boolean).join("\n").replace(/[\r\n]+$/, "");
}

function deleteDiffFragment(path: string, content: string): string
{
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const contentLines = lines.at(-1) === "" ? lines.slice(0, -1) : lines;
    const hunk = contentLines.length > 0
        ? `@@ -1,${contentLines.length} +0,0 @@\n${contentLines.map((line) => `-${line}`).join("\n")}\n`
        : "";
    return [
        `diff --git a/${path} b/${path}`,
        "deleted file mode 100644",
        `--- a/${path}`,
        "+++ /dev/null",
        hunk,
    ].filter(Boolean).join("\n").replace(/[\r\n]+$/, "");
}

function assertNever(value: never): never
{
    throw new Error(`Unhandled patch change kind: ${JSON.stringify(value)}`);
}
