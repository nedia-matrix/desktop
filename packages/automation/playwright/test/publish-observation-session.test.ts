import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { createPlaywrightPublishObservationSession } from "../src/index.js";

function fakeAdapter() {
  const pageEvents = new EventEmitter();
  const cdpEvents = new EventEmitter();
  const bufferedBodies = new Map<string, string>();
  const cdp = Object.assign(cdpEvents, {
    send: vi.fn(async (method: string, parameters?: { requestId?: string }) => {
      if (method === "Network.getResponseBody") {
        const text = bufferedBodies.get(parameters?.requestId ?? "") ?? "";
        return { body: text, base64Encoded: false };
      }
      return {};
    }),
  });
  const page = Object.assign(pageEvents, {
    getByText: () => ({ isVisible: async () => true }),
  });
  const context = {
    newCDPSession: async () => cdp,
  };
  return {
    cdpEvents,
    bufferedBodies,
    pageEvents,
    create: () =>
      createPlaywrightPublishObservationSession(
        context as never,
        page as never,
      ),
  };
}

describe("Playwright publish observation adapter", () => {
  it("adapts bounded responses, page text queries, and close events", async () => {
    const fake = fakeAdapter();
    const session = await fake.create();
    const responses: Array<{ readText(maxBytes: number): Promise<string> }> =
      [];
    session.responses.subscribe((response) => responses.push(response));

    fake.bufferedBodies.set("request-1", "{}");
    fake.cdpEvents.emit("Network.requestWillBeSent", {
      requestId: "request-1",
      request: { method: "POST" },
    });
    fake.cdpEvents.emit("Network.responseReceived", {
      requestId: "request-1",
      response: {
        url: "https://creator.example.test/publish",
        status: 201,
        headers: { "content-type": "application/json" },
      },
    });
    const body = responses[0]?.readText(100);
    fake.cdpEvents.emit("Network.dataReceived", {
      requestId: "request-1",
      dataLength: 2,
    });
    fake.cdpEvents.emit("Network.loadingFinished", {
      requestId: "request-1",
    });
    await expect(body).resolves.toBe("{}");

    await expect(session.page.isTextVisible("发布成功")).resolves.toBe(true);

    const closed = vi.fn();
    session.page.subscribeClose(closed);
    fake.pageEvents.emit("close");
    expect(closed).toHaveBeenCalledOnce();
  });

  it("stops buffering observed bodies at the requested limit", async () => {
    const fake = fakeAdapter();
    const session = await fake.create();
    const responses: Array<{ readText(maxBytes: number): Promise<string> }> =
      [];
    session.responses.subscribe((response) => responses.push(response));

    fake.bufferedBodies.set("large-response", "12345");
    fake.cdpEvents.emit("Network.requestWillBeSent", {
      requestId: "large-response",
      request: { method: "POST" },
    });
    fake.cdpEvents.emit("Network.responseReceived", {
      requestId: "large-response",
      response: {
        url: "https://creator.example.test/publish",
        status: 200,
        headers: { "content-type": "application/json" },
      },
    });
    const body = responses[0]?.readText(4);
    fake.cdpEvents.emit("Network.dataReceived", {
      requestId: "large-response",
      dataLength: 5,
    });
    fake.cdpEvents.emit("Network.loadingFinished", {
      requestId: "large-response",
    });
    await expect(body).rejects.toThrow(
      "Observed response body exceeded its byte limit",
    );
  });
});
