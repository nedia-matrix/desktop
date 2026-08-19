import { describe, expect, it } from "vitest";

import {
  InvalidPublicationTransitionError,
  createPublication,
  transitionPublication,
} from "../src/index.js";

const basePublication = createPublication({
  id: "publication-1",
  platformId: "douyin",
  accountId: "account-1",
  contentRevisionId: "revision-1",
});

describe("publication state machine", () => {
  it("records a valid transition history", () => {
    const validated = transitionPublication(
      basePublication,
      "validated",
      "2026-08-01T00:00:00.000Z",
    );
    const submitting = transitionPublication(
      validated,
      "submitting",
      "2026-08-01T00:01:00.000Z",
    );

    expect(submitting.state).toBe("submitting");
    expect(submitting.transitions).toHaveLength(2);
    expect(basePublication.state).toBe("draft");
  });

  it("rejects transitions that could create an unsafe retry", () => {
    expect(() =>
      transitionPublication(
        basePublication,
        "published",
        "2026-08-01T00:00:00.000Z",
      ),
    ).toThrow(InvalidPublicationTransitionError);
  });

  it("requires uncertain publications to be verified before retrying", () => {
    const validated = transitionPublication(
      basePublication,
      "validated",
      "2026-08-01T00:00:00.000Z",
    );
    const submitting = transitionPublication(
      validated,
      "submitting",
      "2026-08-01T00:01:00.000Z",
    );
    const verifying = transitionPublication(
      submitting,
      "verifying",
      "2026-08-01T00:02:00.000Z",
    );
    const uncertain = transitionPublication(
      verifying,
      "uncertain",
      "2026-08-01T00:03:00.000Z",
    );

    expect(() =>
      transitionPublication(uncertain, "retrying", "2026-08-01T00:04:00.000Z"),
    ).toThrow(InvalidPublicationTransitionError);
  });

  it("distinguishes draft preparation from waiting for manual submission", () => {
    const validated = transitionPublication(
      basePublication,
      "validated",
      "2026-08-01T00:00:00.000Z",
    );
    const preparing = transitionPublication(
      validated,
      "preparing",
      "2026-08-01T00:01:00.000Z",
    );
    const awaitingConfirmation = transitionPublication(
      preparing,
      "awaiting_confirmation",
      "2026-08-01T00:02:00.000Z",
    );

    expect(awaitingConfirmation.state).toBe("awaiting_confirmation");
    expect(awaitingConfirmation.transitions.map(({ to }) => to)).toEqual([
      "validated",
      "preparing",
      "awaiting_confirmation",
    ]);
  });
});
