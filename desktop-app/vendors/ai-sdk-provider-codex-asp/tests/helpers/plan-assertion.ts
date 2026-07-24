import { expect } from "vitest";

// @ts-expect-error Test-only JavaScript recorder has no declaration file.
import { createVitestPlanAssertionRecorder } from "../../../../scripts/lib/test-plan-assertions.mjs";

type Assertion = () => void | Promise<void>;
type PlanAssertionInput = {
    scenarioId: string;
    assertionId: string;
    assertion: Assertion;
};
type PlanAssertionRecorder = {
    planAssert: (input: PlanAssertionInput) => Promise<void>;
};
// The JavaScript helper intentionally has no production declaration file.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call
const planAssertionRecorder = createVitestPlanAssertionRecorder(expect) as PlanAssertionRecorder;

/**
 * Binds a coverage assertion recorder to one concrete Vitest case. Runner
 * identity comes from Vitest itself; callers provide only their scenario and
 * the real, adjacent `expect` callback.
 */
export function planAssertionsForTest(
    scenarioId: string,
): (assertionId: string, assertion: Assertion) => Promise<void>
{
    return async (assertionId, assertion) =>
    {
        await planAssertionRecorder.planAssert({
            scenarioId,
            assertionId,
            assertion,
        });
    };
}
