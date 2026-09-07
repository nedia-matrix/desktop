import type {
  ObservedHttpResponse,
  PublishObservationSession,
  PublishResultEvent,
} from "@nedia-matrix/platform-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDouyinPublishResultMonitor } from "../src/result-monitor.js";

const publishUrl = "https://creator.douyin.com/web/api/media/aweme/create_v2";

function fakeSession(): {
  session: PublishObservationSession;
  respond(body: unknown, url?: string): void;
  respondWithText(text: Promise<string>, url?: string): void;
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
    respond(body, url = publishUrl) {
      responseListener?.({
        method: "POST",
        url,
        status: 200,
        headers: { "content-type": "application/json" },
        readText: async () => JSON.stringify(body),
      });
    },
    respondWithText(text, url = publishUrl) {
      responseListener?.({
        method: "POST",
        url,
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

describe("Douyin result monitor", () => {
  afterEach(() => vi.useRealTimers());

  it("observes draft traffic without emitting until armed", async () => {
    const fake = fakeSession();
    const monitorDiagnostics = diagnostics();
    const monitor = createDouyinPublishResultMonitor({
      contentForm: "video",
      session: fake.session,
      clock,
      diagnostics: monitorDiagnostics,
    });
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();

    fake.respond({ status_code: 0, item_id: "7521111111111111111" });
    monitor.arm();
    await flush();
    expect(events).toEqual([]);

    fake.respond({ status_code: 0, item_id: "7521111111111111111" });
    await flush();
    expect(events).toEqual([
      {
        kind: "published",
        contentId: "7521111111111111111",
        contentUrl: "https://www.douyin.com/video/7521111111111111111",
      },
    ]);
  });

  it("moves through verifying until a publish response provides the identity", async () => {
    const fake = fakeSession();
    const monitor = createDouyinPublishResultMonitor({
      contentForm: "imageText",
      session: fake.session,
      clock,
      diagnostics: diagnostics(),
    });
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();
    monitor.submissionAttempted();
    fake.respond({ status_code: 0 });
    await flush();
    fake.respond({
      status_code: 0,
      item_id: "7522222222222222222",
    });
    await flush();
    expect(events.map((event) => event.kind)).toEqual([
      "verifying",
      "published",
    ]);
    expect(events[1]).toMatchObject({
      contentId: "7522222222222222222",
      contentUrl: "https://www.douyin.com/note/7522222222222222222",
    });
  });

  it("is idempotent when stopped", async () => {
    const fake = fakeSession();
    const monitor = createDouyinPublishResultMonitor({
      contentForm: "video",
      session: fake.session,
      clock,
      diagnostics: diagnostics(),
    });
    await monitor.ready();
    monitor.stop();
    monitor.stop();
    monitor.arm();
    fake.close();
  });

  it("becomes uncertain when verification times out or the page closes", async () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    const monitor = createDouyinPublishResultMonitor({
      contentForm: "video",
      submissionMode: "automatic",
      session: fake.session,
      clock,
      diagnostics: diagnostics(),
    });
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();
    monitor.submissionAttempted();
    fake.respond({ status_code: 0 });
    await vi.advanceTimersByTimeAsync(100_000);
    expect(events.map((event) => event.kind)).toEqual([
      "verifying",
      "uncertain",
    ]);

    const closing = fakeSession();
    const closingMonitor = createDouyinPublishResultMonitor({
      contentForm: "video",
      submissionMode: "manual_confirmation",
      session: closing.session,
      clock,
      diagnostics: diagnostics(),
    });
    const closingEvents: PublishResultEvent[] = [];
    closingMonitor.subscribe((event) => closingEvents.push(event));
    await closingMonitor.ready();
    closingMonitor.arm();
    closing.respond({ status_code: 0 });
    await vi.advanceTimersByTimeAsync(0);
    closing.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(closingEvents.at(-1)?.kind).toBe("uncertain");
  });

  it("does not time out a manual confirmation observation", async () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    const monitor = createDouyinPublishResultMonitor({
      contentForm: "video",
      submissionMode: "manual_confirmation",
      session: fake.session,
      clock,
      diagnostics: diagnostics(),
    });
    const events: PublishResultEvent[] = [];
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();
    monitor.submissionAttempted();
    fake.respond({ status_code: 0 });

    await vi.advanceTimersByTimeAsync(200_000);

    expect(events.map((event) => event.kind)).toEqual(["verifying"]);
    monitor.stop();
  });

  it("reports response read failures without exposing raw data", async () => {
    const responseFailure = fakeSession();
    const responseDiagnostics = diagnostics();
    const monitor = createDouyinPublishResultMonitor({
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
      message: "无法读取抖音发布响应，将继续等待明确的发布结果",
    });
    monitor.stop();
  });

  it("settles an arrived publish response before classifying page close", async () => {
    const fake = fakeSession();
    const monitor = createDouyinPublishResultMonitor({
      contentForm: "video",
      submissionMode: "manual_confirmation",
      session: fake.session,
      clock,
      diagnostics: diagnostics(),
    });
    const events: PublishResultEvent[] = [];
    let resolveBody = (_value: string): void => undefined;
    const body = new Promise<string>((resolve) => {
      resolveBody = resolve;
    });
    monitor.subscribe((event) => events.push(event));
    await monitor.ready();
    monitor.arm();

    fake.respondWithText(body);
    fake.close();
    resolveBody(
      JSON.stringify({ status_code: 0, item_id: "7523333333333333333" }),
    );
    await flush();

    expect(events.at(-1)).toMatchObject({
      kind: "published",
      contentId: "7523333333333333333",
    });
    expect(events.some((event) => event.kind === "uncertain")).toBe(false);
  });
});
