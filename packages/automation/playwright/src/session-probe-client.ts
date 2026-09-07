import type {
  SessionDetectionPlan,
  SessionProbeClient,
  SessionProbeResponse,
} from "@nedia-matrix/automation-contracts";
import type { PlatformBrowserPolicy } from "@nedia-matrix/platform-core";
import type { BrowserContext, Page, Response } from "playwright";

import { isAllowedPlatformNavigation } from "./navigation-policy.js";

const MAX_SESSION_RESPONSE_BYTES = 2_000_000;
const OBSERVED_RESPONSE_REPLAY_WINDOW_MS = 10_000;

export interface PlaywrightSessionProbeClient extends SessionProbeClient {
  subscribeObservedResponses(listener: () => void): () => void;
  dispose(): void;
}

function responseKey(method: string, url: string): string {
  const parsed = new URL(url);
  return `${method.toUpperCase()} ${parsed.origin}${parsed.pathname}`;
}

async function responseBody(
  status: number,
  ok: boolean,
  body: Buffer,
): Promise<SessionProbeResponse> {
  if (body.byteLength > MAX_SESSION_RESPONSE_BYTES) {
    throw new Error("Session probe response is too large");
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    // A non-JSON response cannot identify a platform account.
  }
  return { status, ok, body: parsed };
}

export function createPlaywrightSessionProbeClient(
  context: BrowserContext,
  page: Page,
  browser: PlatformBrowserPolicy,
  detection: SessionDetectionPlan,
): PlaywrightSessionProbeClient {
  const observedResponses = new Map<
    string,
    { response: SessionProbeResponse; observedAt: number }
  >();
  const waiters = new Map<
    string,
    Set<(response: SessionProbeResponse | null) => void>
  >();
  const observedResponseListeners = new Set<() => void>();
  let disposed = false;

  const configuredResponseKeys = new Set(
    detection.probes.flatMap((probe) =>
      probe.source.kind === "observed-response"
        ? [responseKey(probe.source.method, probe.source.url)]
        : [],
    ),
  );

  const handleResponse = (response: Response) => {
    if (disposed) return;
    const key = responseKey(response.request().method(), response.url());
    if (!configuredResponseKeys.has(key)) return;
    void response
      .body()
      .then((body) => responseBody(response.status(), response.ok(), body))
      .then((parsed) => {
        observedResponses.set(key, {
          response: parsed,
          observedAt: Date.now(),
        });
        for (const resolve of waiters.get(key) ?? []) resolve(parsed);
        waiters.delete(key);
        for (const listener of observedResponseListeners) listener();
      })
      .catch(() => {
        for (const resolve of waiters.get(key) ?? []) resolve(null);
        waiters.delete(key);
      });
  };
  if (configuredResponseKeys.size > 0) page.on("response", handleResponse);

  return {
    async fetchJson(url) {
      if (!isAllowedPlatformNavigation(url, browser)) {
        throw new Error("Session probe is outside the platform boundary");
      }
      const response = await context.request.get(url, {
        headers: { Accept: "application/json" },
        timeout: 8_000,
        failOnStatusCode: false,
      });
      const direct = await responseBody(
        response.status(),
        response.ok(),
        await response.body(),
      );
      if (direct.ok && direct.body !== null) return direct;

      if (new URL(page.url()).origin !== new URL(url).origin) return direct;
      const pageResponse = await page.evaluate(
        async ({ requestUrl, maxBytes }) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8_000);
          try {
            const result = await fetch(requestUrl, {
              credentials: "include",
              cache: "no-store",
              headers: { Accept: "application/json" },
              signal: controller.signal,
            });
            return {
              status: result.status,
              ok: result.ok,
              text: (await result.text()).slice(0, maxBytes + 1),
            };
          } finally {
            clearTimeout(timer);
          }
        },
        { requestUrl: url, maxBytes: MAX_SESSION_RESPONSE_BYTES },
      );
      return responseBody(
        pageResponse.status,
        pageResponse.ok,
        Buffer.from(pageResponse.text),
      );
    },
    async waitForJsonResponse({ method, url, timeoutMs }) {
      if (disposed) return null;
      if (!isAllowedPlatformNavigation(url, browser)) {
        throw new Error(
          "Session response probe is outside the platform boundary",
        );
      }
      const key = responseKey(method, url);
      if (!configuredResponseKeys.has(key)) {
        throw new Error(
          "Session response probe is not declared by the platform",
        );
      }
      const observed = observedResponses.get(key);
      if (
        observed &&
        Date.now() - observed.observedAt <= OBSERVED_RESPONSE_REPLAY_WINDOW_MS
      ) {
        return observed.response;
      }
      observedResponses.delete(key);

      return new Promise((resolve) => {
        const listeners = waiters.get(key) ?? new Set();
        waiters.set(key, listeners);
        let settled = false;
        const finish = (response: SessionProbeResponse | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          listeners.delete(finish);
          if (listeners.size === 0) waiters.delete(key);
          resolve(response);
        };
        listeners.add(finish);
        const timer = setTimeout(() => finish(null), timeoutMs);
      });
    },
    subscribeObservedResponses(listener) {
      if (disposed) return () => undefined;
      observedResponseListeners.add(listener);
      return () => observedResponseListeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (configuredResponseKeys.size > 0) {
        page.off("response", handleResponse);
      }
      observedResponses.clear();
      observedResponseListeners.clear();
      for (const listeners of waiters.values()) {
        for (const resolve of listeners) resolve(null);
      }
      waiters.clear();
    },
  };
}
