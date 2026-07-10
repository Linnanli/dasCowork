import { pathToFileURL } from "node:url";

import type { UIMessage } from "ai";

import type { Thread } from "./protocol/app-server-protocol/v2/Thread";
import type { ThreadItem } from "./protocol/app-server-protocol/v2/ThreadItem";
import type { Turn } from "./protocol/app-server-protocol/v2/Turn";
import type { UserInput } from "./protocol/app-server-protocol/v2/UserInput";
import { CODEX_PROVIDER_ID } from "./protocol/provider-metadata";
import {
    type CodexRenderableThreadItem,
    type CodexThreadItemToolInvocation,
    reasoningTextForItem,
    toolInvocationForItem,
    userInputText,
} from "./protocol/shared-item-extractors";
import { stripUndefined } from "./utils/object";

type UiMessagePart = UIMessage["parts"][number];
type DynamicToolUiPart = Extract<UiMessagePart, { type: "dynamic-tool" }>;
type FileUiPart = Extract<UiMessagePart, { type: "file" }>;

export type CodexThreadForUi = Pick<Thread, "id" | "turns">;
export type CodexTurnForUi = Pick<Turn, "id" | "items" | "durationMs">;

export function mapCodexThreadToUiMessages(thread: CodexThreadForUi): UIMessage[]
{
    return thread.turns.flatMap((turn) => mapCodexTurnToUiMessages(turn));
}

export function mapCodexTurnToUiMessages(turn: CodexTurnForUi): UIMessage[]
{
    const messages: UIMessage[] = [];
    let assistantParts: UIMessage["parts"] = [];
    let assistantMessageId: string | undefined;

    const flushAssistant = (): void =>
    {
        if (assistantParts.length === 0)
        {
            return;
        }

        messages.push({
            id: assistantMessageId ?? `${turn.id}:assistant`,
            role: "assistant",
            parts: assistantParts,
        });

        assistantParts = [];
        assistantMessageId = undefined;
    };

    const appendAssistantPart = (part: UiMessagePart): void =>
    {
        assistantMessageId ??= `${turn.id}:assistant`;
        assistantParts.push(part);
    };

    for (const item of turn.items as CodexRenderableThreadItem[])
    {
        switch (item.type)
        {
            case "userMessage": {
                flushAssistant();
                const parts = userMessageParts(item);
                if (parts.length > 0)
                {
                    messages.push({
                        id: item.clientId ?? item.id,
                        role: "user",
                        parts,
                    });
                }
                break;
            }
            case "agentMessage": {
                const text = item.text.trim();
                if (text)
                {
                    appendAssistantPart(agentMessagePart(item, text, turn.durationMs));
                }
                break;
            }
            case "plan":
            case "reasoning": {
                const text = reasoningTextForItem(item);
                if (text)
                {
                    appendAssistantPart({ type: "reasoning", text, state: "done" });
                }
                break;
            }
            case "commandExecution":
            case "fileChange":
            case "mcpToolCall":
            case "dynamicToolCall":
            case "collabAgentToolCall":
            case "collabToolCall":
            case "subAgentActivity":
            case "webSearch":
            case "imageView":
            case "sleep":
            case "enteredReviewMode":
            case "exitedReviewMode":
            case "contextCompaction":
            case "hookPrompt": {
                const invocation = toolInvocationForItem(item);
                if (invocation)
                {
                    appendAssistantPart(dynamicToolPartForInvocation(invocation));
                }
                break;
            }
            case "imageGeneration": {
                if (item.result)
                {
                    appendAssistantPart(imageGenerationFilePart(item));
                }
                break;
            }
            default:
                assertNever(item);
        }
    }

    flushAssistant();
    return messages;
}

export function mapCodexThreadItemToUiPart(item: CodexRenderableThreadItem): UiMessagePart | null
{
    switch (item.type)
    {
        case "agentMessage": {
            const text = item.text.trim();
            return text ? agentMessagePart(item, text) : null;
        }
        case "plan":
        case "reasoning": {
            const text = reasoningTextForItem(item);
            return text ? { type: "reasoning", text, state: "done" } : null;
        }
        case "commandExecution":
        case "fileChange":
        case "mcpToolCall":
        case "dynamicToolCall":
        case "collabAgentToolCall":
        case "collabToolCall":
        case "subAgentActivity":
        case "webSearch":
        case "imageView":
        case "sleep":
        case "enteredReviewMode":
        case "exitedReviewMode":
        case "contextCompaction":
        case "hookPrompt": {
            const invocation = toolInvocationForItem(item);
            return invocation ? dynamicToolPartForInvocation(invocation) : null;
        }
        case "imageGeneration":
            return item.result ? imageGenerationFilePart(item) : null;
        case "userMessage":
            return null;
        default:
            return assertNever(item);
    }
}

function agentMessagePart(
    item: Extract<CodexRenderableThreadItem, { type: "agentMessage" }>,
    text: string,
    turnDurationMs?: number | null,
): Extract<UiMessagePart, { type: "text" }>
{
    const metadata = stripUndefined({
        messagePhase: item.phase ?? undefined,
        turnDurationMs: turnDurationMs ?? undefined,
    });

    return {
        type: "text",
        text,
        state: "done",
        ...(Object.keys(metadata).length > 0
            ? { providerMetadata: { [CODEX_PROVIDER_ID]: metadata } }
            : {}),
    };
}

function userMessageParts(item: Extract<ThreadItem, { type: "userMessage" }>): UIMessage["parts"]
{
    const parts: UIMessage["parts"] = [];
    const text = userInputText(item.content);
    if (text)
    {
        parts.push({ type: "text", text, state: "done" });
    }

    for (const entry of item.content)
    {
        const filePart = userInputFilePart(entry);
        if (filePart)
        {
            parts.push(filePart);
        }
    }

    return parts;
}

function userInputFilePart(entry: UserInput): FileUiPart | null
{
    switch (entry.type)
    {
        case "image":
            return { type: "file", mediaType: "image/*", url: entry.url };
        case "localImage":
            return { type: "file", mediaType: "image/*", url: pathToFileURL(entry.path).href };
        case "text":
        case "skill":
        case "mention":
            return null;
        default:
            return assertNever(entry);
    }
}

function dynamicToolPartForInvocation(invocation: CodexThreadItemToolInvocation): DynamicToolUiPart
{
    return {
        type: "dynamic-tool",
        toolName: invocation.toolName,
        toolCallId: invocation.toolCallId,
        state: "output-available",
        input: invocation.input,
        output: invocation.result,
        providerExecuted: true,
    };
}

function imageGenerationFilePart(item: Extract<ThreadItem, { type: "imageGeneration" }>): FileUiPart
{
    const providerMetadata = providerMetadataForImageGeneration(item);
    return stripUndefined({
        type: "file" as const,
        mediaType: "image/png",
        url: imageDataUrl(item.result),
        providerMetadata,
    });
}

function providerMetadataForImageGeneration(
    item: Extract<ThreadItem, { type: "imageGeneration" }>,
): FileUiPart["providerMetadata"] | undefined
{
    const metadata = stripUndefined({
        revisedPrompt: item.revisedPrompt ?? undefined,
        savedPath: item.savedPath,
    });

    return Object.keys(metadata).length > 0
        ? { [CODEX_PROVIDER_ID]: metadata }
        : undefined;
}

function imageDataUrl(data: string): string
{
    return data.startsWith("data:") ? data : `data:image/png;base64,${data}`;
}

function assertNever(value: never): never
{
    throw new Error(`Unhandled user input: ${JSON.stringify(value)}`);
}
