import type {
  ObservedHttpResponse,
  PublishObservationSession,
  PublishResultEvent,
} from "@nedia-matrix/platform-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createXiaohongshuPublishResultMonitor } from "../src/result-monitor.js";

function fakeSession(): {
  session: PublishObservationSession;
  respond(body: unknown): void;
  respondWithText(text: Promise<string>): void;
  close(): void;
} {
  let responseListener: ((response: ObservedHttpResponse) => void) | undefined;
  let closeListener: (() => void) | undefined;
  return {
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
    respond(body) {
      responseListener?.({
        method: "POST",
        url: "https://edith.xiaohongshu.com/web_api/sns/v2/note",
        status: 200,
        headers: { "content-type": "application/json" },
        readText: async () => JSON.stringify(body),
      });
    },
    respondWithText(text) {
      responseListener?.({
        method: "POST",
        url: "https://edith.xiaohongshu.com/web_api/sns/v2/note",
        status: 200,
        headers: { "content-type": "application/json" },
        readText: () => text,
      });
    },
    close: () => closeListener?.(),
  };
}

const diagnostics = () => ({ report: vi.fn() });

const clock = {
  now: () => Date.now(),
  sleep: (milliseconds: number) =>
    new Promise<void>((resolve) =>
      globalThis.setTimeout(resolve, milliseconds),
    ),
};

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
};

describe("Xiaohongshu result monitor", () => {
  afterEach(() => vi.useRealTimers());

  it("publishes the identity returned by the note endpoint", async () => {
    const fake = fakeSession();
    const monitor = createXiaohongshuPublishResultMonitor({
      contentForm: "imageText",
      session: fake.session,
      clock,
      diagnostics: diagnostics(),
    });
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();
    fake.respond({
      success: true,
      result: 0,
      data: { id: "66f1234567890abc12345678" },
    });
    await flush();
    expect(events).toEqual([
      {
        kind: "published",
        contentId: "66f1234567890abc12345678",
        contentUrl:
          "https://www.xiaohongshu.com/explore/66f1234567890abc12345678",
      },
    ]);
  });

  it("becomes uncertain when verification times out or the page closes", async () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    const monitor = createXiaohongshuPublishResultMonitor({
      contentForm: "imageText",
      session: fake.session,
      clock,
      diagnostics: diagnostics(),
    });
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();
    fake.respond({ success: true, result: 0 });
    await vi.advanceTimersByTimeAsync(100_000);
    expect(events.map((event) => event.kind)).toEqual([
      "verifying",
      "uncertain",
    ]);

    const closing = fakeSession();
    const closingMonitor = createXiaohongshuPublishResultMonitor({
      contentForm: "imageText",
      session: closing.session,
      clock,
      diagnostics: diagnostics(),
    });
    const closingEvents: PublishResultEvent[] = [];
    closingMonitor.subscribe((event) => closingEvents.push(event));
    await closingMonitor.ready();
    closingMonitor.arm();
    closing.respond({ success: true, result: 0 });
    await vi.advanceTimersByTimeAsync(0);
    closing.close();
    expect(closingEvents.at(-1)?.kind).toBe("uncertain");
  });

  it("ignores responses that arrived before arming even if processed later", async () => {
    const fake = fakeSession();
    const monitor = createXiaohongshuPublishResultMonitor({
      contentForm: "imageText",
      session: fake.session,
      clock,
      diagnostics: diagnostics(),
    });
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();

    fake.respond({
      success: true,
      result: 0,
      data: { id: "66f1234567890abc12345678" },
    });
    monitor.arm();
    await flush();
    expect(events).toEqual([]);

    fake.respond({
      success: true,
      result: 0,
      data: { id: "66f1234567890abc12345678" },
    });
    await flush();
    expect(events.at(-1)?.kind).toBe("published");
  });

  it("reports response read failures without exposing raw data", async () => {
    const responseFailure = fakeSession();
    const responseDiagnostics = diagnostics();
    const monitor = createXiaohongshuPublishResultMonitor({
      contentForm: "video",
      session: responseFailure.session,
      clock,
      diagnostics: responseDiagnostics,
    });
    await monitor.ready();
    monitor.arm();
    responseFailure.respondWithText(
      Promise.reject(new Error("secret publish response")),
    );
    await flush();
    expect(responseDiagnostics.report).toHaveBeenCalledWith({
      stage: "response",
      code: "publish_response_read_failed",
      message: "无法读取小红书发布响应，将继续等待明确的发布结果",
    });
    monitor.stop();
  });
});
