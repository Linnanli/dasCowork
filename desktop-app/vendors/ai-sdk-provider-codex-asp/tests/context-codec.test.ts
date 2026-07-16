import { describe, expect, it } from "vitest";

import {
    extractComposerContextDirectives,
    restoreComposerContextInputs,
} from "../src/utils/context-codec";

describe("composer context codec", () =>
{
    it("maps all local context directive kinds to their protocol representation", () =>
    {
        const extracted = extractComposerContextDirectives([
            "Review :file[index.ts]{name=%2Frepo%2Fsrc%2Findex.ts}",
            ":folder[src]{name=%2Frepo%2Fsrc}",
            ":chat[Earlier]{name=thread%3A%2F%2Fthread-1}",
            ":agent[Worker]{name=agent%3A%2F%2Fagent-1}",
            ":agentRole[reviewer]{name=subagent%3A%2F%2Freviewer}",
            ":skill[slides]{name=%2Fskills%2Fslides%2FSKILL.md}",
            ":app[google-drive]{name=app%3A%2F%2Fapp-123}",
            ":plugin[sample]{name=plugin%3A%2F%2Fsample%40local}",
        ].join(" "));

        expect(extracted.text).toBe([
            "Review ",
            "",
            "[@Earlier](thread://thread-1)",
            "[@Worker](agent://agent-1)",
            "[@reviewer](subagent://reviewer)",
            "",
            "$google-drive",
            "@sample",
        ].join(" "));
        expect(extracted.inputs).toEqual([
            { type: "skill", name: "slides", path: "/skills/slides/SKILL.md" },
            { type: "mention", name: "google-drive", path: "app://app-123" },
            { type: "mention", name: "sample", path: "plugin://sample@local" },
        ]);
    });

    it("restores scheme-aware mentions without duplicating canonical tokens", () =>
    {
        const restored = restoreComposerContextInputs([
            {
                type: "text",
                text: "Use $github with @sample@local and [src](</repo/src> \"dascowork-folder\").",
                text_elements: [],
            },
            { type: "mention", name: "github", path: "app://github" },
            { type: "mention", name: "sample@local", path: "plugin://sample@local" },
            { type: "mention", name: "Worker", path: "agent://agent-1" },
            { type: "skill", name: "slides", path: "/skills/slides/SKILL.md" },
        ]);

        expect(restored).toBe([
            "Use :app[github]{name=app%3A%2F%2Fgithub}",
            "with :plugin[sample%40local]{name=plugin%3A%2F%2Fsample%40local}",
            "and :folder[src]{name=%2Frepo%2Fsrc}.",
            ":agent[Worker]{name=agent%3A%2F%2Fagent-1}",
            ":skill[slides]{name=%2Fskills%2Fslides%2FSKILL.md}",
        ].join(" ").replace(". :agent", ".\n:agent").replace(" :skill", "\n:skill"));
    });

    it("normalizes legacy thread mentions to the current chat URI", () =>
    {
        expect(restoreComposerContextInputs([
            { type: "mention", name: "thread-123", path: "codex://thread/thread-123" },
        ])).toBe(":chat[thread-123]{name=thread%3A%2F%2Fthread-123}");
    });

    it("leaves invalid and unknown directives as user-visible text", () =>
    {
        const text = ":file[relative]{name=docs%2Freadme.md} :unknown[x]{name=y}";
        expect(extractComposerContextDirectives(text)).toEqual({
            text,
            inputs: [],
            references: [],
        });
    });
});
