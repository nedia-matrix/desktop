import type {
  PlatformBrowserPolicy,
  PlatformDataClient,
  PlatformJsonResponse,
  PlatformObservedJsonRequest,
} from "@nedia-matrix/platform-sdk";
import type { BrowserContext, Page, Response } from "playwright";

import { isAllowedPlatformNavigation } from "./navigation-policy.js";

const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const OBSERVED_RESPONSE_REPLAY_WINDOW_MS = 10_000;
const MAX_OBSERVED_RESPONSES = 100;

function responseKey(method: string, url: string): string {
  const parsed = new URL(url);
  return `${method.toUpperCase()} ${parsed.origin}${parsed.pathname}`;
}

function parseResponse(
  status: number,
  ok: boolean,
  body: Buffer,
): PlatformJsonResponse {
  if (body.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("Platform data response is too large");
  }
  try {
    return { status, ok, body: JSON.parse(body.toString("utf8")) as unknown };
  } catch {
    return { status, ok, body: null };
  }
}

async function parseObservedResponse(
  response: Response,
): Promise<PlatformJsonResponse | null> {
  try {
    return parseResponse(
      response.status(),
      response.ok(),
      await response.body(),
    );
  } catch {
    return null;
  }
}

export function createPlaywrightPlatformDataClient(
  context: BrowserContext,
  page: Page,
  browser: PlatformBrowserPolicy,
): PlatformDataClient {
  const waiters = new Map<
    string,
    Set<(response: PlatformJsonResponse | null) => void>
  >();
  const observedResponses = new Map<
    string,
    { response: Response; observedAt: number }
  >();
  let disposed = false;

  const handleResponse = (response: Response) => {
    if (disposed) return;
    const request = response.request();
    if (!isAllowedPlatformNavigation(response.url(), browser)) return;
    const resourceType = request.resourceType();
    if (resourceType !== "fetch" && resourceType !== "xhr") return;
    const now = Date.now();
    for (const [key, observed] of observedResponses) {
      if (now - observed.observedAt > OBSERVED_RESPONSE_REPLAY_WINDOW_MS) {
        observedResponses.delete(key);
      }
    }
    const key = responseKey(request.method(), response.url());
    observedResponses.delete(key);
    observedResponses.set(key, { response, observedAt: now });
    while (observedResponses.size > MAX_OBSERVED_RESPONSES) {
      const oldestKey = observedResponses.keys().next().value;
      if (oldestKey === undefined) break;
      observedResponses.delete(oldestKey);
    }
    const listeners = waiters.get(key);
    if (!listeners?.size) return;
    void parseObservedResponse(response)
      .then((parsed) => {
        for (const resolve of listeners) resolve(parsed);
        waiters.delete(key);
      })
      .catch(() => undefined);
  };
  page.on("response", handleResponse);

  return {
    async navigate(url) {
      if (!isAllowedPlatformNavigation(url, browser)) {
        throw new Error(
          "Platform data navigation is outside the platform boundary",
        );
      }
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    async requestJson(request) {
      if (!isAllowedPlatformNavigation(request.url, browser)) {
        throw new Error(
          "Platform data request is outside the platform boundary",
        );
      }
      const options = {
        method: request.method,
        headers: { Accept: "application/json" },
        timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        failOnStatusCode: false,
        ...(request.body === undefined ? {} : { data: request.body }),
      };
      const response = await context.request.fetch(request.url, options);
      if (!isAllowedPlatformNavigation(response.url(), browser)) {
        throw new Error(
          "Platform data response is outside the platform boundary",
        );
      }
      const direct = parseResponse(
        response.status(),
        response.ok(),
        await response.body(),
      );
      if (direct.ok && direct.body !== null) return direct;
      if (new URL(page.url()).origin !== new URL(request.url).origin) {
        return direct;
      }
      const pageResponse = await page.evaluate(
        async ({ input, maxBytes }) => {
          const controller = new AbortController();
          const timer = setTimeout(
            () => controller.abort(),
            input.timeoutMs ?? 10_000,
          );
          try {
            const result = await fetch(input.url, {
              method: input.method,
              credentials: "include",
              cache: "no-store",
              headers: {
                Accept: "application/json",
                ...(input.body === undefined
                  ? {}
                  : { "Content-Type": "application/json" }),
              },
              ...(input.body === undefined
                ? {}
                : { body: JSON.stringify(input.body) }),
              signal: controller.signal,
            });
            return {
              url: result.url,
              status: result.status,
              ok: result.ok,
              text: (await result.text()).slice(0, maxBytes + 1),
            };
          } finally {
            clearTimeout(timer);
          }
        },
        { input: request, maxBytes: MAX_RESPONSE_BYTES },
      );
      if (!isAllowedPlatformNavigation(pageResponse.url, browser)) {
        throw new Error(
          "Platform data response is outside the platform boundary",
        );
      }
      return parseResponse(
        pageResponse.status,
        pageResponse.ok,
        Buffer.from(pageResponse.text),
      );
    },
    waitForJsonResponse(request: PlatformObservedJsonRequest) {
      if (disposed) return Promise.resolve(null);
      if (!isAllowedPlatformNavigation(request.url, browser)) {
        return Promise.reject(
          new Error("Platform data response is outside the platform boundary"),
        );
      }
      const key = responseKey(request.method, request.url);
      if (request.replayObserved !== false) {
        const observed = observedResponses.get(key);
        if (
          observed &&
          Date.now() - observed.observedAt <= OBSERVED_RESPONSE_REPLAY_WINDOW_MS
        ) {
          return parseObservedResponse(observed.response);
        }
      }
      observedResponses.delete(key);
      return new Promise((resolve) => {
        const listeners = waiters.get(key) ?? new Set();
        waiters.set(key, listeners);
        let settled = false;
        const finish = (response: PlatformJsonResponse | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          listeners.delete(finish);
          if (listeners.size === 0) waiters.delete(key);
          resolve(response);
        };
        listeners.add(finish);
        const timer = setTimeout(() => finish(null), request.timeoutMs);
      });
    },
    async scrollToEnd(request) {
      const target = page.locator(request.selector).first();
      if ((await target.count()) === 0) {
        return { found: false, moved: false, atEnd: false };
      }
      return target.evaluate((element) => {
        const container = element as HTMLElement;
        const before = container.scrollTop;
        container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
        const after = container.scrollTop;
        return {
          found: true,
          moved: after > before,
          atEnd: after + container.clientHeight >= container.scrollHeight - 1,
        };
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      page.off("response", handleResponse);
      observedResponses.clear();
      for (const listeners of waiters.values()) {
        for (const resolve of listeners) resolve(null);
      }
      waiters.clear();
    },
  };
}
