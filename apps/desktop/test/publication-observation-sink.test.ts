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
  it("settles every duplicate delivery after one pending event is retried", async () => {
    const durableInbox = inbox();
    durableInbox.append.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const notify = vi.fn();
    const queue = new PublicationObservationQueue(
      { recordObservation: vi.fn() },
      durableInbox,
      notify,
      vi.fn(),
      vi.fn(),
    );
    const first = queue.accept(event);
    const second = queue.accept(event);
    queue.retryPending();
    await Promise.all([first, second]);
    expect(notify).toHaveBeenCalledOnce();
    expect(queue.pendingCount).toBe(0);
  });
  it("retries a failed inbox removal after projection and resolves the original delivery", async () => {
    const durableInbox = inbox();
    durableInbox.remove.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const recordObservation = vi.fn();
    const onPersisted = vi.fn();
    const onDeferred = vi.fn();
    const onError = vi.fn();
    const sink = new PublicationObservationQueue(
      { recordObservation },
      durableInbox,
      onPersisted,
      onDeferred,
      onError,
    );
    const delivery = sink.accept(event);
    expect(sink.pendingCount).toBe(1);
    expect(onPersisted).not.toHaveBeenCalled();
    expect(onDeferred).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    sink.retryPending();
    await delivery;
    expect(sink.pendingCount).toBe(0);
    expect(recordObservation).toHaveBeenNthCalledWith(
      2,
      event.publicationId,
      event.result,
      event.sequence,
      { accountId: event.accountId, platformId: event.platformId },
    );
    expect(onPersisted).toHaveBeenCalledOnce();
  });

  it("replays an unacknowledged result after restart using its original sequence", async () => {
    const events = new Map<string, PublishObservationEvent>();
    const durableInbox = {
      list: () => [...events.values()],
      append: (value: PublishObservationEvent) => {
        events.set(value.eventId, value);
      },
      remove: vi.fn((id: string) => {
        events.delete(id);
      }),
    };
    durableInbox.remove.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    let lastSequence = 0;
    let transitions = 0;
    const persistence = {
      recordObservation: (
        _id: string,
        _result: PublishObservationEvent["result"],
        sequence: number,
      ) => {
        if (sequence <= lastSequence) return;
        lastSequence = sequence;
        transitions += 1;
      },
    };
    const first = new PublicationObservationQueue(
      persistence,
      durableInbox,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    void first.accept(event);
    expect(events.size).toBe(1);
    const notify = vi.fn();
    const restarted = new PublicationObservationQueue(
      persistence,
      durableInbox,
      notify,
      vi.fn(),
      vi.fn(),
    );
    restarted.replayPersisted();
    restarted.replayPersisted();
    expect(events.size).toBe(0);
    expect(transitions).toBe(1);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("stops startup replay on projection failure and preserves the inbox", () => {
    const durableInbox = inbox();
    durableInbox.list.mockReturnValue([
      event,
      { ...event, eventId: "event-2", sequence: 2 },
    ]);
    const recordObservation = vi.fn(() => {
      throw new Error("unavailable");
    });
    const notify = vi.fn();
    const sink = new PublicationObservationQueue(
      { recordObservation },
      durableInbox,
      notify,
      vi.fn(),
      vi.fn(),
    );
    expect(() => sink.replayPersisted()).toThrow("unavailable");
    expect(recordObservation).toHaveBeenCalledOnce();
    expect(durableInbox.remove).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

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
      { accountId: event.accountId, platformId: event.platformId },
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
