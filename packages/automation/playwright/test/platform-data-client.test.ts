import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { createPlaywrightPlatformDataClient } from "../src/index.js";

function fixture() {
  const events = new EventEmitter();
  const goto = vi.fn(async () => undefined);
  const fetch = vi.fn(async () => ({
    url: () => "https://creator.example.test/api/items",
    status: () => 200,
    ok: () => true,
    body: async () => Buffer.from('{"value":42}'),
  }));
  const page = Object.assign(events, {
    goto,
    url: () => "https://creator.example.test/home",
    evaluate: vi.fn(),
    locator: vi.fn(),
  });
  const client = createPlaywrightPlatformDataClient(
    { request: { fetch } } as never,
    page as never,
    {
      startUrl: "https://creator.example.test/home",
      allowedHostSuffixes: ["example.test"],
    },
  );
  return { client, events, fetch, goto, page };
}

describe("Playwright platform data client", () => {
  it("uses the persistent context request and parses JSON", async () => {
    const { client, fetch } = fixture();
    await expect(
      client.requestJson({
        method: "GET",
        url: "https://creator.example.test/api/items",
      }),
    ).resolves.toEqual({ status: 200, ok: true, body: { value: 42 } });
    expect(fetch).toHaveBeenCalledWith(
      "https://creator.example.test/api/items",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("matches observed responses by method, origin and path", async () => {
    const { client, events } = fixture();
    const waiting = client.waitForJsonResponse({
      method: "POST",
      url: "https://creator.example.test/api/items",
      timeoutMs: 100,
    });
    events.emit("response", {
      request: () => ({ method: () => "POST", resourceType: () => "xhr" }),
      url: () => "https://creator.example.test/api/items?page=1",
      status: () => 200,
      ok: () => true,
      body: async () => Buffer.from('{"items":[]}'),
    });
    await expect(waiting).resolves.toEqual({
      status: 200,
      ok: true,
      body: { items: [] },
    });
  });

  it("replays a recent observed response to a later reader", async () => {
    const { client, events } = fixture();
    events.emit("response", {
      request: () => ({ method: () => "POST", resourceType: () => "xhr" }),
      url: () => "https://creator.example.test/api/profile?from=home",
      status: () => 200,
      ok: () => true,
      body: async () => Buffer.from('{"data":{"userId":"42"}}'),
    });

    await expect(
      client.waitForJsonResponse({
        method: "POST",
        url: "https://creator.example.test/api/profile",
        timeoutMs: 100,
      }),
    ).resolves.toEqual({
      status: 200,
      ok: true,
      body: { data: { userId: "42" } },
    });
  });

  it("can wait only for the next matching response", async () => {
    const { client, events } = fixture();
    const response = {
      request: () => ({ method: () => "GET", resourceType: () => "fetch" }),
      url: () => "https://creator.example.test/api/items?page=0",
      status: () => 200,
      ok: () => true,
      body: async () => Buffer.from('{"page":0}'),
    };
    events.emit("response", response);

    const waiting = client.waitForJsonResponse({
      method: "GET",
      url: "https://creator.example.test/api/items",
      timeoutMs: 100,
      replayObserved: false,
    });
    events.emit("response", {
      ...response,
      url: () => "https://creator.example.test/api/items?page=1",
      body: async () => Buffer.from('{"page":1}'),
    });

    await expect(waiting).resolves.toEqual({
      status: 200,
      ok: true,
      body: { page: 1 },
    });
  });

  it("scrolls a matching container to its current end", async () => {
    const { client, page } = fixture();
    const element = {
      scrollTop: 10,
      scrollHeight: 600,
      clientHeight: 200,
      scrollTo: vi.fn(function (
        this: typeof element,
        options: { top: number },
      ) {
        this.scrollTop = options.top - this.clientHeight;
      }),
    };
    const evaluate = vi.fn(async (callback) => callback(element));
    const first = vi.fn(() => ({ count: async () => 1, evaluate }));
    page.locator.mockReturnValue({ first });

    await expect(client.scrollToEnd({ selector: ".content" })).resolves.toEqual(
      { found: true, moved: true, atEnd: true },
    );
    expect(page.locator).toHaveBeenCalledWith(".content");
    expect(element.scrollTo).toHaveBeenCalledWith({
      top: 600,
      behavior: "auto",
    });
  });

  it("rejects navigation and requests outside the platform boundary", async () => {
    const { client } = fixture();
    await expect(client.navigate("https://example.invalid/")).rejects.toThrow(
      "outside the platform boundary",
    );
    await expect(
      client.requestJson({ method: "GET", url: "https://example.invalid/" }),
    ).rejects.toThrow("outside the platform boundary");
  });
});
