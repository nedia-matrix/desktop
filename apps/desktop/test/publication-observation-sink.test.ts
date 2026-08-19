import type { PublishObservationEvent } from "../src/main/publishing/publish-observation-host.js";
import { PublicationObservationSink } from "../src/main/publishing/publication-observation-sink.js";
import { describe, expect, it, vi } from "vitest";

const event: PublishObservationEvent = {
  observationId: "observation-1",
  publicationId: "publication-1",
  accountId: "account-1",
  platformId: "douyin",
  result: {
    kind: "published",
    contentId: "work-1",
    contentUrl: "https://www.douyin.com/video/work-1",
  },
};

describe("PublicationObservationSink", () => {
  it("notifies the renderer only after the observation is durable", () => {
    const recordObservation = vi.fn();
    const onPersisted = vi.fn();
    const sink = new PublicationObservationSink(
      { recordObservation },
      onPersisted,
      vi.fn(),
      vi.fn(),
    );

    sink.accept(event);

    expect(recordObservation).toHaveBeenCalledWith(
      event.publicationId,
      event.result,
    );
    expect(recordObservation.mock.invocationCallOrder[0]).toBeLessThan(
      onPersisted.mock.invocationCallOrder[0] ?? 0,
    );
    expect(onPersisted).toHaveBeenCalledWith(event);
  });

  it("reports a deferred result and retries it without losing the event", () => {
    const recordObservation = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("disk full");
      })
      .mockImplementationOnce(() => undefined);
    const onPersisted = vi.fn();
    const onDeferred = vi.fn();
    const sink = new PublicationObservationSink(
      { recordObservation },
      onPersisted,
      onDeferred,
      vi.fn(),
    );

    sink.accept(event);
    expect(sink.pendingCount).toBe(1);
    expect(onPersisted).not.toHaveBeenCalled();
    expect(onDeferred).toHaveBeenCalledWith(event);

    sink.retryPending();
    expect(sink.pendingCount).toBe(0);
    expect(onPersisted).toHaveBeenCalledWith(event);
  });
});
