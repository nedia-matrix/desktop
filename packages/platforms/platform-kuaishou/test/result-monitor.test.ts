import type {
  ObservedHttpResponse,
  PublishMonitorContext,
  PublishResultEvent,
} from "@nedia-matrix/platform-core";
import { describe, expect, it, vi } from "vitest";

import { createKuaishouPublishResultMonitor } from "../src/result-monitor.js";

const publishRefreshUrl =
  "https://cp.kuaishou.com/rest/cp/works/v2/video/pc/publish/refresh";

function fixture(options?: { advanceClock?: boolean }) {
  let responseListener: ((response: ObservedHttpResponse) => void) | undefined;
  let closeListener: (() => void) | undefined;
  let now = 0;
  const context: PublishMonitorContext = {
    contentForm: "video",
    session: {
      responses: {
        subscribe(listener) {
          responseListener = listener;
          return () => {
            responseListener = undefined;
          };
        },
      },
      page: {
        isTextVisible: async () => false,
        subscribeClose(listener) {
          closeListener = listener;
          return () => {
            closeListener = undefined;
          };
        },
      },
    },
    clock: {
      now: () => now,
      sleep: async (milliseconds) => {
        if (options?.advanceClock) now += milliseconds;
        else await new Promise<void>(() => undefined);
      },
    },
    diagnostics: { report: vi.fn() },
  };
  return {
    context,
    emit(
      body: unknown,
      overrides?: { url?: string; status?: number; text?: string },
    ) {
      responseListener?.({
        method: "POST",
        url: overrides?.url ?? publishRefreshUrl,
        status: overrides?.status ?? 200,
        headers: {},
        readText: async () => overrides?.text ?? JSON.stringify(body),
      });
    },
    close: () => closeListener?.(),
  };
}

async function flushResponseQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Kuaishou publish result monitor", () => {
  it("waits for status 2 and publishes status 4 with a work id", async () => {
    const test = fixture();
    test.context.contentForm = "imageText";
    const monitor = createKuaishouPublishResultMonitor(test.context);
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));

    await monitor.ready();
    monitor.arm();
    test.emit({ data: { list: [{ publishStatus: 2, workId: null }] } });
    await flushResponseQueue();
    expect(events).toEqual([expect.objectContaining({ kind: "verifying" })]);

    test.emit({
      data: { list: [{ publishStatus: 4, workId: " new-id " }] },
    });
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        kind: "published",
        contentId: "new-id",
        contentUrl: "https://www.kuaishou.com/short-video/new-id",
      });
    });
  });

  it("treats status 4 without a valid work id as uncertain", async () => {
    const test = fixture();
    const monitor = createKuaishouPublishResultMonitor(test.context);
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();

    test.emit({ data: { list: [{ publishStatus: 4, workId: null }] } });
    await vi.waitFor(() => {
      expect(events).toContainEqual(
        expect.objectContaining({ kind: "uncertain" }),
      );
    });
  });

  it("prioritizes a valid work id over an unknown publish status", async () => {
    const test = fixture();
    const monitor = createKuaishouPublishResultMonitor(test.context);
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();

    test.emit({ data: { list: [{ publishStatus: 10, workId: "work-10" }] } });
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        kind: "published",
        contentId: "work-10",
        contentUrl: "https://www.kuaishou.com/short-video/work-10",
      });
    });
  });

  it("treats a status other than 2 or 4 as uncertain", async () => {
    const test = fixture();
    const monitor = createKuaishouPublishResultMonitor(test.context);
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();

    test.emit({ data: { list: [{ publishStatus: 3, workId: null }] } });
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        kind: "uncertain",
        message: "快手返回未知发布状态：3",
      });
    });
  });

  it("only evaluates data.list[0]", async () => {
    const test = fixture();
    const monitor = createKuaishouPublishResultMonitor(test.context);
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();

    test.emit({
      data: {
        list: [
          { publishStatus: 2, workId: null },
          { publishStatus: 4, workId: "must-not-be-used" },
        ],
      },
    });
    await flushResponseQueue();
    expect(events).toEqual([expect.objectContaining({ kind: "verifying" })]);
    monitor.stop();
  });

  it("ignores the former works-list endpoint", async () => {
    const test = fixture();
    const monitor = createKuaishouPublishResultMonitor(test.context);
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();

    test.emit(
      { data: { list: [{ publishStatus: 4, workId: "old-endpoint" }] } },
      {
        url: "https://cp.kuaishou.com/rest/cp/works/v2/video/pc/photo/list",
      },
    );
    await flushResponseQueue();
    expect(events).toEqual([]);
    monitor.stop();
  });

  it("treats an HTTP error or malformed matching response as uncertain", async () => {
    const httpFailure = fixture();
    const httpMonitor = createKuaishouPublishResultMonitor(httpFailure.context);
    const httpEvents: PublishResultEvent[] = [];
    httpMonitor.subscribe((event) => httpEvents.push(event));
    await httpMonitor.ready();
    httpMonitor.arm();
    httpFailure.emit(null, { status: 500 });
    await vi.waitFor(() => {
      expect(httpEvents).toContainEqual(
        expect.objectContaining({ kind: "uncertain" }),
      );
    });

    const malformed = fixture();
    const malformedMonitor = createKuaishouPublishResultMonitor(
      malformed.context,
    );
    const malformedEvents: PublishResultEvent[] = [];
    malformedMonitor.subscribe((event) => malformedEvents.push(event));
    await malformedMonitor.ready();
    malformedMonitor.arm();
    malformed.emit(null, { text: "not-json" });
    await vi.waitFor(() => {
      expect(malformedEvents).toContainEqual(
        expect.objectContaining({ kind: "uncertain" }),
      );
    });
  });

  it("reports an armed window close as uncertain", async () => {
    const test = fixture();
    const monitor = createKuaishouPublishResultMonitor(test.context);
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();
    test.close();
    expect(events).toEqual([expect.objectContaining({ kind: "uncertain" })]);
  });

  it("times out an automatic submission without a terminal refresh", async () => {
    const test = fixture({ advanceClock: true });
    test.context.submissionMode = "automatic";
    const monitor = createKuaishouPublishResultMonitor(test.context);
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();

    monitor.arm();
    await vi.waitFor(() => {
      expect(events).toContainEqual(
        expect.objectContaining({ kind: "uncertain" }),
      );
    });
    expect(events[0]).toMatchObject({ kind: "verifying" });
  });
});
