import { describe, expect, it } from "vitest";

import {
    buildFilesMentionedContext,
    extractLocalContextDirectives,
    restoreFilesMentionedContext,
    serializeLocalContextDirective,
    userInputText,
} from "../src";

describe("local context directives", () =>
{
    it("extracts URI-encoded file and folder directives and deduplicates paths", () =>
    {
        const file = serializeLocalContextDirective({
            type: "file",
            label: "报告: \"最终版\" ]}",
            path: "/tmp/含 空格/报告 ]}.md",
        });
        const folder = serializeLocalContextDirective({
            type: "folder",
            label: "资料 {2026}",
            path: "/tmp/资料 {2026}",
        });
        const duplicate = serializeLocalContextDirective({
            type: "file",
            label: "ignored duplicate label",
            path: "/tmp/含 空格/报告 ]}.md",
        });

        expect(extractLocalContextDirectives(`Review ${file} ${folder} ${duplicate} now.`)).toEqual({
            text: "Review    now.",
            references: [
                {
                    type: "file",
                    label: "报告: \"最终版\" ]}",
                    path: "/tmp/含 空格/报告 ]}.md",
                },
                {
                    type: "folder",
                    label: "资料 {2026}",
                    path: "/tmp/资料 {2026}",
                },
            ],
        });
    });

    it("leaves invalid, relative, incomplete, and non-local directives in the request", () =>
    {
        const text = [
            ":file[relative]{name=docs/readme.md}",
            ":file[incomplete]",
            ":tool[keep]{name=/tmp/tool}",
            ":folder[empty]{name=}",
        ].join(" ");

        expect(extractLocalContextDirectives(text)).toEqual({ text, references: [] });
    });

    it("keeps valid legacy raw fields when URI decoding fails", () =>
    {
        const text = [
            ":file[legacy raw]{name=/tmp/raw path}",
            ":folder[bad%ZZ]{name=/tmp/also%ZZvalid}",
        ].join(" ");

        expect(extractLocalContextDirectives(text)).toEqual({
            text: " ",
            references: [
                { type: "file", label: "legacy raw", path: "/tmp/raw path" },
                { type: "folder", label: "bad%ZZ", path: "/tmp/also%ZZvalid" },
            ],
        });
    });

    it("uses JSON strings for model context and restores complete history prefixes", () =>
    {
        const context = buildFilesMentionedContext([
            { type: "folder", label: "目录: \"资料\"", path: "/tmp/资料/项目 }" },
            { type: "file", label: "note ]", path: "/tmp/note ]}.md" },
        ], "Please review.");

        expect(context).toBe([
            "# Files mentioned by the user:",
            "",
            "## \"目录: \\\"资料\\\"\": \"/tmp/资料/项目 }\"",
            "",
            "## \"note ]\": \"/tmp/note ]}.md\"",
            "",
            "## My request for Codex:",
            "Please review.",
        ].join("\n"));
        expect(restoreFilesMentionedContext(context)).toEqual({
            text: [
                ":file[%E7%9B%AE%E5%BD%95%3A%20%22%E8%B5%84%E6%96%99%22]{name=%2Ftmp%2F%E8%B5%84%E6%96%99%2F%E9%A1%B9%E7%9B%AE%20%7D}",
                ":file[note%20%5D]{name=%2Ftmp%2Fnote%20%5D%7D.md}",
                "Please review.",
            ].join("\n"),
            references: [
                { type: "file", label: "目录: \"资料\"", path: "/tmp/资料/项目 }" },
                { type: "file", label: "note ]", path: "/tmp/note ]}.md" },
            ],
        });
    });

    it("does not strip a forged or incomplete Files mentioned heading", () =>
    {
        const forged = [
            "Here is a heading similar to the internal format:",
            "# Files mentioned by the user:",
            "## \"note\": \"/tmp/note.md\"",
            "## My request for Codex:",
            "Keep all of this.",
        ].join("\n");
        const incomplete = [
            "# Files mentioned by the user:",
            "",
            "## \"note\": \"relative/path.md\"",
            "",
            "## My request for Codex:",
            "Keep this too.",
        ].join("\n");

        expect(restoreFilesMentionedContext(forged)).toEqual({ text: forged, references: [] });
        expect(restoreFilesMentionedContext(incomplete)).toEqual({ text: incomplete, references: [] });
    });

    it("restores history user text through the shared extractor with file fallback", () =>
    {
        const context = buildFilesMentionedContext([
            { type: "folder", label: "workspace", path: "/tmp/workspace" },
        ], "Run the tests.");

        expect(userInputText([
            { type: "text", text: context, text_elements: [] },
            { type: "mention", name: "connected-app", path: "app://connected-app" },
        ])).toBe([
            ":file[workspace]{name=%2Ftmp%2Fworkspace}",
            "Run the tests.",
            "@connected-app",
        ].join("\n"));
    });
});
