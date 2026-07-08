import type {
    JSONValue,
    LanguageModelV3FinishReason,
    LanguageModelV3StreamPart,
    LanguageModelV3Usage,
} from "@ai-sdk/provider";

import { stripUndefined } from "../utils/object";
import type { AgentMessageDeltaNotification } from "./app-server-protocol/v2/AgentMessageDeltaNotification";
import type { ItemCompletedNotification } from "./app-server-protocol/v2/ItemCompletedNotification";
import type { ItemGuardianApprovalReviewCompletedNotification } from "./app-server-protocol/v2/ItemGuardianApprovalReviewCompletedNotification";
import type { ItemGuardianApprovalReviewStartedNotification } from "./app-server-protocol/v2/ItemGuardianApprovalReviewStartedNotification";
import type { ItemStartedNotification } from "./app-server-protocol/v2/ItemStartedNotification";
import type { McpToolCallProgressNotification } from "./app-server-protocol/v2/McpToolCallProgressNotification";
import type { ReasoningSummaryPartAddedNotification } from "./app-server-protocol/v2/ReasoningSummaryPartAddedNotification";
import type { ThreadTokenUsageUpdatedNotification } from "./app-server-protocol/v2/ThreadTokenUsageUpdatedNotification";
import type { TurnCompletedNotification } from "./app-server-protocol/v2/TurnCompletedNotification";
import type { TurnDiffUpdatedNotification } from "./app-server-protocol/v2/TurnDiffUpdatedNotification";
import type { TurnPlanUpdatedNotification } from "./app-server-protocol/v2/TurnPlanUpdatedNotification";
import type { TurnStartedNotification } from "./app-server-protocol/v2/TurnStartedNotification";
import type { TurnStatus } from "./app-server-protocol/v2/TurnStatus";
import { withProviderMetadata } from "./provider-metadata";
import {
    type CodexRenderableThreadItem,
    type CodexThreadItemToolInvocation,
    stringifyToolInput,
    toolInvocationForItem,
    webSearchHasContent,
} from "./shared-item-extractors";
import type { CodexDynamicToolCallItem } from "./types";

export interface CodexEventMapperInput
{
    method: string;
    params?: unknown;
}

/** Shared shape for reasoning/plan/fileChange delta params. */
interface DeltaParams
{
    itemId?: string;
    delta?: string;
}

type DynamicToolCallItem = CodexDynamicToolCallItem;
type CodexThreadItemToolStart = Pick<CodexThreadItemToolInvocation, "toolCallId" | "toolName" | "input">;
type AutoApprovalReviewItem = Record<string, unknown> & {
    id: string;
    type: "automaticApprovalReview";
    status: "inProgress" | "completed";
    outcome: string | null;
    startedAtMs: number;
    completedAtMs?: number;
    targetItemId: string | null;
    review: ItemGuardianApprovalReviewStartedNotification["review"];
    action: ItemGuardianApprovalReviewStartedNotification["action"];
    decisionSource?: ItemGuardianApprovalReviewCompletedNotification["decisionSource"];
};

type AutoApprovalReviewNotification =
    | ItemGuardianApprovalReviewStartedNotification
    | ItemGuardianApprovalReviewCompletedNotification;

const EMPTY_USAGE: LanguageModelV3Usage = {
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
};

const TURN_DIFF_PREVIEW_CHAR_LIMIT = 50_000;

function toFinishReason(status: TurnStatus | undefined): LanguageModelV3FinishReason
{
    switch (status)
    {
        case "completed":
            return { unified: "stop", raw: "completed" };
        case "failed":
            return { unified: "error", raw: "failed" };
        case "interrupted":
            return { unified: "other", raw: "interrupted" };
        default:
            return { unified: "other", raw: undefined };
    }
}

function turnErrorMessage(completed: TurnCompletedNotification): string | undefined
{
    const message = completed.turn?.error?.message?.trim();
    return message || undefined;
}

function autoApprovalReviewItem(
    notification: AutoApprovalReviewNotification,
    status: AutoApprovalReviewItem["status"],
): AutoApprovalReviewItem
{
    return stripUndefined({
        id: notification.reviewId,
        type: "automaticApprovalReview" as const,
        status,
        outcome: notification.review.status,
        startedAtMs: notification.startedAtMs,
        completedAtMs: "completedAtMs" in notification ? notification.completedAtMs : undefined,
        targetItemId: notification.targetItemId,
        review: notification.review,
        action: notification.action,
        decisionSource: "decisionSource" in notification ? notification.decisionSource : undefined,
    });
}

function autoApprovalReviewInvocation(item: AutoApprovalReviewItem): CodexThreadItemToolStart & {
    result: { item: AutoApprovalReviewItem };
}
{
    return {
        toolCallId: item.id,
        toolName: "codex_automatic_approval_review",
        input: stripUndefined({
            targetItemId: item.targetItemId,
            review: item.review,
            action: item.action,
            startedAtMs: item.startedAtMs,
            completedAtMs: item.completedAtMs,
            decisionSource: item.decisionSource,
        }),
        result: { item },
    };
}

function asToolResult(value: unknown): NonNullable<JSONValue>
{
    return value as NonNullable<JSONValue>;
}

function normalizePlanStatus(status: string): string
{
    if (status === "in_progress")
    {
        return "inProgress";
    }
    return status;
}

function todoListItemForPlanUpdate(notification: TurnPlanUpdatedNotification, itemId: string): Record<string, unknown>
{
    return stripUndefined({
        id: itemId,
        type: "todoList",
        status: "inProgress",
        explanation: notification.explanation ?? undefined,
        items: notification.plan.map((step) => ({
            label: step.step,
            status: normalizePlanStatus(step.status),
        })),
    });
}

function turnDiffItemForNotification(
    notification: TurnDiffUpdatedNotification,
    itemId: string,
    cwd?: string,
): Record<string, unknown>
{
    const truncated = notification.diff.length > TURN_DIFF_PREVIEW_CHAR_LIMIT;
    return stripUndefined({
        id: itemId,
        type: "turnDiff",
        status: "inProgress",
        cwd,
        diff: truncated ? notification.diff.slice(0, TURN_DIFF_PREVIEW_CHAR_LIMIT) : notification.diff,
        truncated,
        originalLength: truncated ? notification.diff.length : undefined,
    });
}

export interface CodexEventMapperOptions
{
    /** Emit plan updates as tool-call/tool-result parts. Default: true. */
    emitPlanUpdates?: boolean;
}

/**
 * Extract threadId from notification params. All codex protocol notifications
 * include threadId as a top-level field. Returns undefined for notifications
 * that don't carry a threadId (e.g. codex/event/* wrappers, account events).
 */
export function extractNotificationThreadId(params: unknown): string | undefined
{
    if (params && typeof params === "object" && "threadId" in params)
    {
        const val = (params as Record<string, unknown>)["threadId"];
        return typeof val === "string" ? val : undefined;
    }
    return undefined;
}

// No-op handler for intentionally ignored events.
const NOOP = (): LanguageModelV3StreamPart[] => [];
export class CodexEventMapper
{
    private readonly options: Required<CodexEventMapperOptions>;
    private streamStarted = false;
    private readonly openTextParts = new Set<string>();
    private readonly textDeltaReceived = new Set<string>();
    private readonly openReasoningParts = new Set<string>();
    private readonly openToolCalls = new Map<string, { toolName: string; item?: Record<string, unknown> }>();
    /**
     * Item IDs for dynamicToolCall items seen in cross-call mode — tracked so
     * item/tool/call dedup fires without adding them to openToolCalls (which
     * would cause handleTurnCompleted to emit spurious error tool-results).
     */
    private readonly _sdkDynamicToolCallIds = new Set<string>();
    /**
     * Set to true by enableCrossCallMode() when PersistentTransport + SDK tools
     * are active. In cross-call mode the mapper stays silent for dynamicToolCall
     * items; the cross-call handler in model.ts owns emission.
     */
    private _crossCallMode = false;
    private readonly planSequenceByTurnId = new Map<string, number>();
    private threadId: string | undefined;
    private turnId: string | undefined;
    private threadPath: string | undefined;
    private threadCwd: string | undefined;
    private latestUsage: LanguageModelV3Usage | undefined;

    private readonly handlers: Record<string, (params: unknown) => LanguageModelV3StreamPart[]>;

    constructor(options?: CodexEventMapperOptions)
    {
        this.options = {
            emitPlanUpdates: options?.emitPlanUpdates ?? true,
        };

        this.handlers = {
            "turn/started": (p) => this.handleTurnStarted(p),
            "item/started": (p) => this.handleItemStarted(p),
            "item/agentMessage/delta": (p) => this.handleAgentMessageDelta(p),
            "item/completed": (p) => this.handleItemCompleted(p),
            "item/autoApprovalReview/started": (p) => this.handleAutoApprovalReviewStarted(p),
            "item/autoApprovalReview/completed": (p) => this.handleAutoApprovalReviewCompleted(p),
            "item/reasoning/textDelta": (p) => this.handleReasoningDelta(p),
            "item/reasoning/summaryTextDelta": (p) => this.handleReasoningDelta(p),
            "item/plan/delta": (p) => this.handleReasoningDelta(p),
            "item/reasoning/summaryPartAdded": (p) => this.handleSummaryPartAdded(p),
            "turn/plan/updated": (p) => this.handlePlanUpdated(p),
            "turn/diff/updated": (p) => this.handleTurnDiffUpdated(p),
            "item/mcpToolCall/progress": (p) => this.handleMcpToolCallProgress(p),
            "item/tool/callStarted": (p) => this.handleToolCallStarted(p),
            "item/tool/callDelta": (p) => this.handleToolCallDelta(p),
            "item/tool/callFinished": (p) => this.handleToolCallFinished(p),
            "item/tool/call": (p) => this.handleToolCall(p),
            "thread/tokenUsage/updated": (p) => this.handleTokenUsageUpdated(p),
            "turn/completed": (p) => this.handleTurnCompleted(p),

            // Intentionally ignored: wrapper/duplicate events handled by their canonical forms above.
            "codex/event/agent_reasoning": NOOP,
            "codex/event/agent_reasoning_section_break": NOOP,
            "codex/event/plan_update": NOOP,
            // Intentionally ignored: web search and MCP wrappers mirror item events.
            "codex/event/web_search_begin": NOOP,
            "codex/event/web_search_end": NOOP,
            "codex/event/mcp_tool_call_begin": NOOP,
            "codex/event/mcp_tool_call_end": NOOP,

            // Intentionally ignored: streaming output deltas — the full output arrives
            // in item/completed (aggregatedOutput), making these redundant.
            "item/commandExecution/outputDelta": NOOP,
            "item/fileChange/outputDelta": NOOP,

            "codex/event/turn_diff": NOOP,
        };
    }

    /**
     * Switches the mapper into cross-call mode. Call this when PersistentTransport
     * and SDK tools are both active so the cross-call handler in model.ts owns
     * dynamicToolCall emission instead of the mapper.
     */
    enableCrossCallMode(): void
    {
        this._crossCallMode = true;
    }

    setThreadId(threadId: string): void
    {
        this.threadId = threadId;
    }

    setThreadPath(threadPath: string | null | undefined): void
    {
        this.threadPath = threadPath ?? undefined;
    }

    setThreadCwd(threadCwd: string | null | undefined): void
    {
        this.threadCwd = threadCwd ?? undefined;
    }

    setTurnId(turnId: string): void
    {
        this.turnId = turnId;
    }

    getTurnId(): string | undefined
    {
        return this.turnId;
    }

    map(event: CodexEventMapperInput): LanguageModelV3StreamPart[]
    {
        const handler = this.handlers[event.method];
        return handler ? handler(event.params) : [];
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private withMeta<T extends LanguageModelV3StreamPart>(part: T, extra?: Record<string, string>): T
    {
        if (part.type === "stream-start")
        {
            return withProviderMetadata(part, this.threadId, this.turnId, this.threadPath, extra);
        }

        return withProviderMetadata(part, this.threadId, this.turnId, undefined, extra);
    }

    private ensureStreamStarted(parts: LanguageModelV3StreamPart[]): void
    {
        if (!this.streamStarted)
        {
            parts.push(this.withMeta({ type: "stream-start", warnings: [] }));
            this.streamStarted = true;
        }
    }

    private emitReasoningDelta(parts: LanguageModelV3StreamPart[], id: string, delta: string): void
    {
        this.ensureStreamStarted(parts);

        if (!this.openReasoningParts.has(id))
        {
            this.openReasoningParts.add(id);
            parts.push(this.withMeta({ type: "reasoning-start", id }));
        }

        if (delta)
        {
            parts.push(this.withMeta({ type: "reasoning-delta", id, delta }));
        }
    }

    private nextPlanSequence(turnId: string): number
    {
        const next = (this.planSequenceByTurnId.get(turnId) ?? 0) + 1;
        this.planSequenceByTurnId.set(turnId, next);
        return next;
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    // turn/started
    private handleTurnStarted(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = params as TurnStartedNotification | undefined;
        if (p?.turn?.id)
        {
            this.turnId = p.turn.id;
        }
        const parts: LanguageModelV3StreamPart[] = [];
        this.ensureStreamStarted(parts);
        return parts;
    }

    // item/started
    private handleItemStarted(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as ItemStartedNotification;
        const item = p.item as CodexRenderableThreadItem | undefined;
        if (!item?.id)
        {
            return [];
        }

        const parts: LanguageModelV3StreamPart[] = [];

        switch (item.type)
        {
            case "agentMessage": {
                this.ensureStreamStarted(parts);
                this.openTextParts.add(item.id);
                parts.push(this.withMeta({ type: "text-start", id: item.id }));
                break;
            }
            case "commandExecution": {
                this.startProviderToolCall(parts, item);
                break;
            }
            case "dynamicToolCall": {
                if (this._crossCallMode)
                {
                    // Cross-call mode: suppress mapper emission. The cross-call handler
                    // in model.ts emits the definitive (non-providerExecuted) tool-call
                    // from the JSON-RPC request. Track the ID so item/tool/call dedup
                    // fires without adding it to openToolCalls (which would cause
                    // handleTurnCompleted to emit a spurious error tool-result).
                    this.ensureStreamStarted(parts);
                    this._sdkDynamicToolCallIds.add(item.id);
                    break;
                }

                // Non-cross-call mode: emit providerExecuted tool-call so telemetry
                // is preserved. item/completed will emit the tool-result.
                this.startProviderToolCall(parts, item);
                break;
            }
            case "fileChange":
            case "mcpToolCall":
            case "sleep":
            case "collabAgentToolCall":
            case "collabToolCall":
            case "imageView":
            case "contextCompaction":
            case "enteredReviewMode":
            case "exitedReviewMode":
            case "hookPrompt":
            case "subAgentActivity":
                this.startProviderToolCall(parts, item, {
                    emitPreliminaryItem: item.type === "mcpToolCall" || item.type === "sleep",
                });
                break;
            case "webSearch":
                this.ensureStreamStarted(parts);
                // Codex usually emits webSearch item/started as an empty placeholder
                // and fills query/action at item/completed. The shared extractor
                // suppresses placeholders here and handleItemCompleted emits the
                // complete call/result pair once content exists.
                this.startProviderToolCall(parts, item);
                break;
            case "reasoning":
            case "plan": {
                this.emitReasoningDelta(parts, item.id, "");
                break;
            }
            default:
                break;
        }

        return parts;
    }

    // item/agentMessage/delta
    private handleAgentMessageDelta(params: unknown): LanguageModelV3StreamPart[]
    {
        const delta = (params ?? {}) as AgentMessageDeltaNotification;
        if (!delta.itemId || !delta.delta)
        {
            return [];
        }

        const parts: LanguageModelV3StreamPart[] = [];
        this.ensureStreamStarted(parts);

        if (!this.openTextParts.has(delta.itemId))
        {
            this.openTextParts.add(delta.itemId);
            parts.push(this.withMeta({ type: "text-start", id: delta.itemId }));
        }

        parts.push(this.withMeta({ type: "text-delta", id: delta.itemId, delta: delta.delta }));
        this.textDeltaReceived.add(delta.itemId);
        return parts;
    }

    // item/completed
    private handleItemCompleted(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as ItemCompletedNotification;
        const item = p.item as CodexRenderableThreadItem | undefined;
        if (!item?.id)
        {
            return [];
        }

        const parts: LanguageModelV3StreamPart[] = [];

        if (item.type === "agentMessage")
        {
            if (!this.textDeltaReceived.has(item.id) && item.text)
            {
                this.ensureStreamStarted(parts);

                if (!this.openTextParts.has(item.id))
                {
                    this.openTextParts.add(item.id);
                    parts.push(this.withMeta({ type: "text-start", id: item.id }));
                }

                parts.push(this.withMeta({ type: "text-delta", id: item.id, delta: item.text }));
            }

            if (this.openTextParts.has(item.id))
            {
                parts.push(this.withMeta({ type: "text-end", id: item.id }));
                this.openTextParts.delete(item.id);
            }
        }
        else if (this.openToolCalls.has(item.id))
        {
            const tracked = this.openToolCalls.get(item.id)!;
            const invocation = toolInvocationForItem(item);
            if (!invocation)
            {
                return parts;
            }

            // A replayed completion (adopted from a previous step) can be the
            // first part of this stream — make sure stream-start precedes it.
            this.ensureStreamStarted(parts);

            parts.push(this.withMeta({
                type: "tool-result",
                toolCallId: item.id,
                toolName: tracked.toolName,
                result: invocation.result,
            }));

            this.openToolCalls.delete(item.id);
        }
        else if (item.type === "webSearch" && webSearchHasContent(item.query, item.action))
        {
            // webSearch item/started was a contentless placeholder suppressed in
            // handleItemStarted; the real query/action arrive here. Emit the full
            // provider-executed call + result now (the search ran to completion).
            this.ensureStreamStarted(parts);
            const invocation = toolInvocationForItem(item);
            if (!invocation)
            {
                return parts;
            }
            parts.push(this.withMeta({
                type: "tool-call",
                toolCallId: invocation.toolCallId,
                toolName: invocation.toolName,
                input: stringifyToolInput(invocation.input),
                providerExecuted: true,
                dynamic: true,
            }));
            parts.push(this.withMeta({
                type: "tool-result",
                toolCallId: invocation.toolCallId,
                toolName: invocation.toolName,
                result: invocation.result,
            }));
        }
        else if (this.openReasoningParts.has(item.id))
        {
            parts.push(this.withMeta({ type: "reasoning-end", id: item.id }));
            this.openReasoningParts.delete(item.id);
        }
        else if (item.type === "imageGeneration" && item.result)
        {
            this.ensureStreamStarted(parts);

            const extra = {
                ...(item.revisedPrompt && { revisedPrompt: item.revisedPrompt }),
                ...(item.savedPath && { savedPath: item.savedPath }),
            };

            parts.push(this.withMeta(
                { type: "file" as const, mediaType: "image/png", data: item.result },
                Object.keys(extra).length > 0 ? extra : undefined,
            ));
        }

        return parts;
    }

    // item/reasoning/textDelta, item/reasoning/summaryTextDelta, item/plan/delta
    private handleReasoningDelta(params: unknown): LanguageModelV3StreamPart[]
    {
        const delta = (params ?? {}) as DeltaParams;
        if (!delta.itemId || !delta.delta)
        {
            return [];
        }
        const parts: LanguageModelV3StreamPart[] = [];
        this.emitReasoningDelta(parts, delta.itemId, delta.delta);
        return parts;
    }

    // item/reasoning/summaryPartAdded
    private handleSummaryPartAdded(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as ReasoningSummaryPartAddedNotification;
        if (!p.itemId)
        {
            return [];
        }
        const parts: LanguageModelV3StreamPart[] = [];
        this.emitReasoningDelta(parts, p.itemId, "\n\n");
        return parts;
    }

    // turn/plan/updated
    private handlePlanUpdated(params: unknown): LanguageModelV3StreamPart[]
    {
        if (!this.options.emitPlanUpdates)
        {
            return [];
        }

        const p = (params ?? {}) as TurnPlanUpdatedNotification;
        const turnId = p.turnId;
        const plan = p.plan;
        if (!turnId || !plan)
        {
            return [];
        }

        const parts: LanguageModelV3StreamPart[] = [];
        this.ensureStreamStarted(parts);
        const planSequence = this.nextPlanSequence(turnId);
        const toolCallId = `plan:${turnId}:${planSequence}`;
        const toolName = "codex_todo_list";
        const item = todoListItemForPlanUpdate(p, toolCallId);

        parts.push(this.withMeta({
            type: "tool-call",
            toolCallId,
            toolName,
            input: JSON.stringify({ explanation: p.explanation ?? undefined }),
            providerExecuted: true,
            dynamic: true,
        }));

        parts.push(this.withMeta({
            type: "tool-result",
            toolCallId,
            toolName,
            result: asToolResult({ item }),
        }));

        return parts;
    }

    // turn/diff/updated
    private handleTurnDiffUpdated(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as TurnDiffUpdatedNotification;
        if (!p.turnId || typeof p.diff !== "string")
        {
            return [];
        }

        const parts: LanguageModelV3StreamPart[] = [];
        this.ensureStreamStarted(parts);
        const toolCallId = `turn-diff:${p.turnId}:${this.nextPlanSequence(`diff:${p.turnId}`)}`;
        const toolName = "codex_turn_diff";
        const item = turnDiffItemForNotification(p, toolCallId, this.threadCwd);

        parts.push(this.withMeta({
            type: "tool-call",
            toolCallId,
            toolName,
            input: JSON.stringify({ turnId: p.turnId }),
            providerExecuted: true,
            dynamic: true,
        }));

        parts.push(this.withMeta({
            type: "tool-result",
            toolCallId,
            toolName,
            result: asToolResult({ item }),
        }));

        return parts;
    }

    // item/mcpToolCall/progress
    private handleMcpToolCallProgress(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as McpToolCallProgressNotification;
        if (!p.itemId || !p.message)
        {
            return [];
        }
        const tracked = this.openToolCalls.get(p.itemId);
        if (!tracked)
        {
            return [];
        }
        // preliminary: true causes the AI SDK to replace the previous tool-result
        // with this one, so each progress message overwrites the last rather than
        // accumulating. p.message is just the current status (e.g. "Searching...").
        return [this.withMeta({
            type: "tool-result",
            toolCallId: p.itemId,
            toolName: tracked.toolName,
            result: asToolResult(stripUndefined({ output: p.message, item: tracked.item })),
            preliminary: true,
        })];
    }

    // item/autoApprovalReview/started
    private handleAutoApprovalReviewStarted(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as ItemGuardianApprovalReviewStartedNotification;
        if (!p.reviewId)
        {
            return [];
        }

        const parts: LanguageModelV3StreamPart[] = [];
        const item = autoApprovalReviewItem(p, "inProgress");
        this.startProviderToolCall(parts, autoApprovalReviewInvocation(item), {
            item,
            emitPreliminaryItem: true,
        });
        return parts;
    }

    // item/autoApprovalReview/completed
    private handleAutoApprovalReviewCompleted(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as ItemGuardianApprovalReviewCompletedNotification;
        if (!p.reviewId)
        {
            return [];
        }

        const parts: LanguageModelV3StreamPart[] = [];
        const item = autoApprovalReviewItem(p, "completed");
        const invocation = autoApprovalReviewInvocation(item);
        if (!this.openToolCalls.has(invocation.toolCallId))
        {
            this.startProviderToolCall(parts, invocation, { item });
        }

        this.ensureStreamStarted(parts);
        parts.push(this.withMeta({
            type: "tool-result",
            toolCallId: invocation.toolCallId,
            toolName: invocation.toolName,
            result: asToolResult(invocation.result),
        }));
        this.openToolCalls.delete(invocation.toolCallId);
        return parts;
    }

    // item/tool/callStarted
    private handleToolCallStarted(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as { callId?: string; tool?: string };
        if (!p.callId || !p.tool)
        {
            return [];
        }
        const parts: LanguageModelV3StreamPart[] = [];
        this.ensureStreamStarted(parts);
        parts.push(this.withMeta({ type: "tool-input-start", id: p.callId, toolName: p.tool, dynamic: true }));
        return parts;
    }

    // item/tool/callDelta
    private handleToolCallDelta(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as { callId?: string; delta?: string };
        if (!p.callId || !p.delta)
        {
            return [];
        }
        return [this.withMeta({ type: "tool-input-delta", id: p.callId, delta: p.delta })];
    }

    // item/tool/callFinished
    private handleToolCallFinished(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as { callId?: string };
        if (!p.callId)
        {
            return [];
        }
        return [this.withMeta({ type: "tool-input-end", id: p.callId })];
    }

    // item/tool/call
    private handleToolCall(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as { callId?: string; tool?: string; arguments?: unknown };
        if (!p.callId || !p.tool)
        {
            return [];
        }
        // SDK dynamic tools (dynamicToolCall items) are handled by the cross-call
        // handler in model.ts — suppress the mapper's duplicate emission.
        if (this._sdkDynamicToolCallIds.has(p.callId))
        {
            return [];
        }
        return this.startDynamicToolCall({
            id: p.callId,
            tool: p.tool,
            arguments: p.arguments ?? {},
        });
    }

    private startDynamicToolCall(item: Pick<DynamicToolCallItem, "id" | "tool" | "arguments">): LanguageModelV3StreamPart[]
    {
        if (!item.id || !item.tool)
        {
            return [];
        }

        if (this.openToolCalls.has(item.id))
        {
            return [];
        }

        const parts: LanguageModelV3StreamPart[] = [];
        this.startProviderToolCall(parts, {
            toolCallId: item.id,
            toolName: item.tool,
            input: item.arguments ?? {},
        });

        return parts;
    }

    private startProviderToolCall(
        parts: LanguageModelV3StreamPart[],
        itemOrInvocation: CodexRenderableThreadItem | CodexThreadItemToolStart,
        options: { item?: Record<string, unknown>; emitPreliminaryItem?: boolean } = {},
    ): void
    {
        const invocation = "toolCallId" in itemOrInvocation
            ? itemOrInvocation
            : toolInvocationForItem(itemOrInvocation);
        if (!invocation || this.openToolCalls.has(invocation.toolCallId))
        {
            return;
        }

        this.ensureStreamStarted(parts);
        const item = options.item ?? (!("toolCallId" in itemOrInvocation) ? itemOrInvocation : undefined);
        this.openToolCalls.set(
            invocation.toolCallId,
            item ? { toolName: invocation.toolName, item } : { toolName: invocation.toolName },
        );
        parts.push(this.withMeta({
            type: "tool-call",
            toolCallId: invocation.toolCallId,
            toolName: invocation.toolName,
            input: stringifyToolInput(invocation.input),
            providerExecuted: true,
            dynamic: true,
        }));

        if (options.emitPreliminaryItem && item)
        {
            parts.push(this.withMeta({
                type: "tool-result",
                toolCallId: invocation.toolCallId,
                toolName: invocation.toolName,
                result: asToolResult({ item }),
                preliminary: true,
            }));
        }
    }

    // thread/tokenUsage/updated
    private handleTokenUsageUpdated(params: unknown): LanguageModelV3StreamPart[]
    {
        const p = (params ?? {}) as ThreadTokenUsageUpdatedNotification;
        const last = p.tokenUsage?.last;
        if (last)
        {
            this.latestUsage = {
                inputTokens: {
                    total: last.inputTokens,
                    noCache: undefined,
                    cacheRead: last.cachedInputTokens,
                    cacheWrite: undefined,
                },
                outputTokens: {
                    total: last.outputTokens,
                    text: undefined,
                    reasoning: last.reasoningOutputTokens,
                },
            };
        }
        return [];
    }

    /** Snapshots provider-executed tool calls still awaiting item/completed, for parking across a cross-call step boundary. */
    takeOpenToolCalls(): Array<{ itemId: string; toolName: string }>
    {
        return [...this.openToolCalls].map(([itemId, tracked]) => ({ itemId, toolName: tracked.toolName }));
    }

    /** Adopts parked open tool calls from a previous step so their late item/completed emits the real tool-result here. */
    adoptOpenToolCalls(calls: Array<{ itemId: string; toolName: string }>): void
    {
        for (const call of calls)
        {
            this.openToolCalls.set(call.itemId, { toolName: call.toolName });
        }
    }

    /** Emits synthetic error tool-results for all still-open provider-executed calls and clears them. */
    closeOpenToolCalls(reason: string): LanguageModelV3StreamPart[]
    {
        const parts: LanguageModelV3StreamPart[] = [];

        for (const [itemId, tracked] of this.openToolCalls)
        {
            parts.push(this.withMeta({
                type: "tool-result",
                toolCallId: itemId,
                toolName: tracked.toolName,
                result: { error: reason },
                isError: true,
            }));
        }
        this.openToolCalls.clear();

        return parts;
    }

    // turn/completed
    private handleTurnCompleted(params: unknown): LanguageModelV3StreamPart[]
    {
        const parts: LanguageModelV3StreamPart[] = [];
        this.ensureStreamStarted(parts);

        for (const itemId of this.openTextParts)
        {
            parts.push(this.withMeta({ type: "text-end", id: itemId }));
        }
        this.openTextParts.clear();

        for (const itemId of this.openReasoningParts)
        {
            parts.push(this.withMeta({ type: "reasoning-end", id: itemId }));
        }
        this.openReasoningParts.clear();

        parts.push(...this.closeOpenToolCalls("Tool call did not complete before turn ended"));
        this._sdkDynamicToolCallIds.clear();

        const completed = (params ?? {}) as TurnCompletedNotification;
        if (completed.turn?.id)
        {
            this.planSequenceByTurnId.delete(completed.turn.id);
            this.planSequenceByTurnId.delete(`diff:${completed.turn.id}`);
        }
        const usage = this.latestUsage ?? EMPTY_USAGE;
        const errorMessage = turnErrorMessage(completed);
        if (errorMessage)
        {
            parts.push(this.withMeta({ type: "error", error: new Error(errorMessage) }));
        }
        parts.push(this.withMeta({ type: "finish", finishReason: toFinishReason(completed.turn?.status), usage }));
        return parts;
    }
}
