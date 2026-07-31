import { isAbsolute, relative, sep } from "node:path";

import { stripUndefined } from "../utils/object";
import type { FileUpdateChange } from "./app-server-protocol/v2/FileUpdateChange";
import type { CodexRenderableThreadItem } from "./shared-item-extractors";

export const TURN_DIFF_PREVIEW_CHAR_LIMIT = 50_000;
export const TURN_DIFF_ACTION_PATCH_CHAR_LIMIT = 2 * 1024 * 1024;

export type TurnDiffPatchUnavailableReason = "missing-cwd" | "patch-too-large";

export interface TurnPatchBatch
{
    cwd: string;
    diff: string;
    gitRoot?: string;
}

export interface TurnDiffItem
{
    id: string;
    threadId?: string;
    type: "turnDiff";
    status: "inProgress" | "completed";
    cwd?: string;
    diff: string;
    truncated: boolean;
    originalLength?: number;
    patchBatches?: readonly TurnPatchBatch[];
    patchUnavailableReason?: TurnDiffPatchUnavailableReason;
}

export interface FileChangeDiffBatch
{
    changes: readonly FileUpdateChange[];
    cwd?: string | undefined;
}

/**
 * Derives action-patch batches from the stable order in a completed turn.
 * Commands advance the working directory for later file changes only when
 * they provide one, matching the Codex Electron recovery model.
 */
export function fileChangeDiffBatchesForOrderedItems(
    items: readonly CodexRenderableThreadItem[],
    initialCwd?: string,
): FileChangeDiffBatch[]
{
    const batches: FileChangeDiffBatch[] = [];
    let cwd = initialCwd;

    for (const item of items)
    {
        if (item.type === "commandExecution")
        {
            if (item.cwd)
            {
                cwd = item.cwd;
            }
            continue;
        }

        if (
            item.type === "fileChange" &&
            item.status !== "failed" &&
            item.status !== "declined" &&
            item.changes.length > 0
        )
        {
            batches.push({ changes: item.changes, cwd });
        }
    }

    return batches;
}

export function turnDiffItem({
    id,
    threadId,
    status,
    cwd,
    diff,
    patchBatches,
}: {
    id: string;
    threadId?: string | undefined;
    status: TurnDiffItem["status"];
    cwd?: string | undefined;
    diff: string;
    patchBatches?: readonly FileChangeDiffBatch[] | undefined;
}): TurnDiffItem
{
    const truncated = diff.length > TURN_DIFF_PREVIEW_CHAR_LIMIT;
    const actionPatch = status === "completed" && patchBatches
        ? turnPatchBatchesForFileChanges(patchBatches)
        : undefined;
    return stripUndefined({
        id,
        threadId,
        type: "turnDiff" as const,
        status,
        cwd,
        diff: truncated ? diff.slice(0, TURN_DIFF_PREVIEW_CHAR_LIMIT) : diff,
        truncated,
        originalLength: truncated ? diff.length : undefined,
        patchBatches: actionPatch?.patchBatches,
        patchUnavailableReason: actionPatch?.patchUnavailableReason,
    });
}

export function turnPatchBatchesForFileChanges(
    batches: readonly FileChangeDiffBatch[],
): { patchBatches?: readonly TurnPatchBatch[]; patchUnavailableReason?: TurnDiffPatchUnavailableReason }
{
    const patchBatches: TurnPatchBatch[] = [];
    let totalLength = 0;

    for (const batch of batches)
    {
        if (!batch.cwd)
        {
            return { patchUnavailableReason: "missing-cwd" };
        }

        const diff = unifiedDiffForFileChangeBatches([{ changes: batch.changes, cwd: batch.cwd }]);
        if (!diff)
        {
            continue;
        }

        totalLength += diff.length;
        if (totalLength > TURN_DIFF_ACTION_PATCH_CHAR_LIMIT)
        {
            return { patchUnavailableReason: "patch-too-large" };
        }

        patchBatches.push({ cwd: batch.cwd, diff });
    }

    return patchBatches.length > 0 ? { patchBatches } : {};
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
            const fragment = unifiedDiffFragment(change, cwd);
            if (!fragment)
            {
                continue;
            }

            const path = change.kind.type === "update" && change.kind.move_path
                ? change.kind.move_path
                : change.path;
            const key = `${cwd ?? ""}\0${patchPath(path, cwd)}`;
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

function unifiedDiffFragment(change: FileUpdateChange, cwd?: string): string | null
{
    switch (change.kind.type)
    {
        case "update":
            return updateDiffFragment(
                patchPath(change.path, cwd),
                patchPath(change.kind.move_path ?? change.path, cwd),
                change.diff,
            );
        case "add":
            return addDiffFragment(patchPath(change.path, cwd), change.diff);
        case "delete":
            return deleteDiffFragment(patchPath(change.path, cwd), change.diff);
        default:
            return assertNever(change.kind);
    }
}

/**
 * File-change items commonly use absolute paths while Git patches must be
 * repository-relative. Paths outside the reported working directory stay
 * absolute so the Main-process safety check continues to reject them.
 */
function patchPath(path: string, cwd?: string): string
{
    const normalizedPath = path.replaceAll("\\", "/");
    if (!cwd || !isAbsolute(path))
    {
        return normalizedPath;
    }

    const relativePath = relative(cwd, path);
    if (
        !relativePath ||
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
    )
    {
        return normalizedPath;
    }

    return relativePath.split(sep).join("/");
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
