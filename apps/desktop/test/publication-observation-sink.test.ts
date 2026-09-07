import type { PublishObservationEvent } from "../src/main/publishing/observations/publish-observation-manager.js";
import { PublicationObservationQueue } from "../src/main/publishing/observations/publication-observation-queue.js";
import { describe, expect, it, vi } from "vitest";

const event: PublishObservationEvent = {
  eventId: "event-1",
  observationId: "observation-1",
  publicationId: "publication-1",
  accountId: "account-1",
  platformId: "douyin",
  sequence: 1,
  result: {
    kind: "published",
    contentId: "work-1",
    contentUrl: "https://www.douyin.com/video/work-1",
  },
};

const inbox = () => ({
  list: vi.fn(() => [] as PublishObservationEvent[]),
  append: vi.fn(),
  remove: vi.fn(),
});

describe("PublicationObservationQueue", () => {
  it("notifies the renderer only after the observation is durable", async () => {
    const recordObservation = vi.fn();
    const onPersisted = vi.fn();
    const sink = new PublicationObservationQueue(
      { recordObservation },
      inbox(),
      onPersisted,
      vi.fn(),
      vi.fn(),
    );

    await sink.accept(event);

    expect(recordObservation).toHaveBeenCalledWith(
      event.publicationId,
      event.result,
      event.sequence,
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
    const sink = new PublicationObservationQueue(
      { recordObservation },
      inbox(),
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

  it("keeps an event pending when the durable inbox cannot be written", () => {
    const durableInbox = inbox();
    durableInbox.append
      .mockImplementationOnce(() => {
        throw new Error("inbox unavailable");
      })
      .mockImplementationOnce(() => undefined);
    const onPersisted = vi.fn();
    const sink = new PublicationObservationQueue(
      { recordObservation: vi.fn() },
      durableInbox,
      onPersisted,
      vi.fn(),
      vi.fn(),
    );

    sink.accept(event);
    expect(sink.pendingCount).toBe(1);
    expect(onPersisted).not.toHaveBeenCalled();

    sink.retryPending();
    expect(sink.pendingCount).toBe(0);
    expect(onPersisted).toHaveBeenCalledWith(event);
  });
});
