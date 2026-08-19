import type {
  PublishResultEvent,
  PublishResultMonitor,
} from "@nedia-matrix/platform-core";
import { describe, expect, it, vi } from "vitest";

import {
  PublishObservationHost,
  toPublishResultUpdate,
} from "../src/main/publishing/publish-observation-host.js";

function fakeMonitor() {
  const listeners = new Set<(event: PublishResultEvent) => void>();
  const monitor: PublishResultMonitor = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ready: vi.fn(async () => undefined),
    arm: vi.fn(),
    stop: vi.fn(),
  };
  return {
    monitor,
    emit: (event: PublishResultEvent) => {
      for (const listener of listeners) listener(event);
    },
  };
}

describe("PublishObservationHost", () => {
  it("adds host identity without leaking it into the platform monitor", async () => {
    const onEvent = vi.fn();
    const host = new PublishObservationHost(onEvent);
    const fake = fakeMonitor();
    const hosted = host.attach({
      publicationId: "publication-1",
      accountId: "account-1",
      platformId: "platform-1",
      monitor: fake.monitor,
    });

    await hosted.ready();
    hosted.arm();
    fake.emit({ kind: "verifying", message: "checking" });

    expect(fake.monitor.ready).toHaveBeenCalledOnce();
    expect(fake.monitor.arm).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({
      observationId: hosted.id,
      publicationId: "publication-1",
      accountId: "account-1",
      platformId: "platform-1",
      result: { kind: "verifying", message: "checking" },
    });
  });

  it("stops the previous observation for the same account", () => {
    const host = new PublishObservationHost(vi.fn());
    const first = fakeMonitor();
    const second = fakeMonitor();
    host.attach({
      publicationId: "publication-1",
      accountId: "a",
      platformId: "p",
      monitor: first.monitor,
    });
    host.attach({
      publicationId: "publication-2",
      accountId: "a",
      platformId: "p",
      monitor: second.monitor,
    });
    expect(first.monitor.stop).toHaveBeenCalledOnce();
  });

  it("reports an armed observation as uncertain when its browser closes", () => {
    const onEvent = vi.fn();
    const host = new PublishObservationHost(onEvent);
    const fake = fakeMonitor();
    const hosted = host.attach({
      publicationId: "publication-1",
      accountId: "a",
      platformId: "p",
      monitor: fake.monitor,
    });
    hosted.arm();

    host.stop("a");

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        publicationId: "publication-1",
        result: expect.objectContaining({ kind: "uncertain" }),
      }),
    );
  });

  it("releases its publication lease after a terminal result", () => {
    const onFinished = vi.fn();
    const host = new PublishObservationHost(vi.fn());
    const fake = fakeMonitor();
    const hosted = host.attach({
      publicationId: "publication-1",
      accountId: "a",
      platformId: "p",
      monitor: fake.monitor,
      onFinished,
    });
    hosted.arm();

    fake.emit({ kind: "failed", message: "rejected" });
    hosted.stop();

    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("maps platform results to renderer updates at the host boundary", () => {
    expect(
      toPublishResultUpdate({
        observationId: "observation-1",
        publicationId: "publication-1",
        accountId: "account-1",
        platformId: "douyin",
        result: {
          kind: "published",
          contentId: "work-1",
          contentUrl: "https://example.com/work-1",
        },
      }),
    ).toEqual({
      observationId: "observation-1",
      publicationId: "publication-1",
      accountId: "account-1",
      status: "published",
      message: "发布成功",
      platformContentId: "work-1",
      platformContentUrl: "https://example.com/work-1",
    });
  });
});
