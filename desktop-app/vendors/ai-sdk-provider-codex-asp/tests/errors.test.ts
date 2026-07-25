import { describe, expect, it } from "vitest";

import {
    CODEX_PROVIDER_ERROR_CODES,
    CodexProviderError,
    isCodedCodexProviderError,
    isCodexProviderError,
    isCodexProviderErrorCode,
} from "../src";

describe("CodexProviderError", () =>
{
    it("exposes stable provider recovery error codes through the package root", () =>
    {
        const error = new CodexProviderError("transport closed", {
            code: "app_server_transport_closed",
        });

        expect(CODEX_PROVIDER_ERROR_CODES).toContain("app_server_transport_closed");
        expect(isCodexProviderError(error)).toBe(true);
        expect(isCodexProviderErrorCode(error.code)).toBe(true);
        expect(isCodedCodexProviderError(error)).toBe(true);
        expect(error.code).toBe("app_server_transport_closed");
    });
});
