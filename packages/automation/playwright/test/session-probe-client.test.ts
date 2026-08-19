import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { createPlaywrightSessionProbeClient } from "../src/index.js";

function fixture() {
  const pageEvents = new EventEmitter();
  const page = Object.assign(pageEvents, {
    url: () => "https://cp.kuaishou.com/profile",
  });
  const browser = {
    startUrl: "https://cp.kuaishou.com/profile",
    allowedHostSuffixes: ["kuaishou.com"],
  } as never;
  const detection = {
    probes: [
      {
        source: {
          kind: "observed-response",
          method: "POST",
          url: "https://cp.kuaishou.com/rest/v2/creator/pc/authority/account/current",
          timeoutMs: 100,
        },
        fields: { externalAccountId: ["id"], nickname: ["name"] },
      },
    ],
  } as never;
  const client = createPlaywrightSessionProbeClient(
    { request: {} } as never,
    page as never,
    browser,
    detection,
  );
  return { client, pageEvents };
}

function accountResponse(body: string) {
  return {
    request: () => ({ method: () => "POST" }),
    url: () =>
      "https://cp.kuaishou.com/rest/v2/creator/pc/authority/account/current?from=profile",
    status: () => 200,
    ok: () => true,
    body: async () => Buffer.from(body),
  };
}

describe("Playwright session response probes", () => {
  it("matches method, origin and path while ignoring query parameters", async () => {
    const { client, pageEvents } = fixture();
    const waiting = client.waitForJsonResponse({
      method: "POST",
      url: "https://cp.kuaishou.com/rest/v2/creator/pc/authority/account/current",
      timeoutMs: 100,
    });

    pageEvents.emit(
      "response",
      accountResponse('{"data":{"userId":"kuaishou-42"}}'),
    );

    await expect(waiting).resolves.toEqual({
      status: 200,
      ok: true,
      body: { data: { userId: "kuaishou-42" } },
    });
  });

  it("replays the latest valid observed response to later detection attempts", async () => {
    const { client, pageEvents } = fixture();
    pageEvents.emit(
      "response",
      accountResponse('{"data":{"userId":"kuaishou-42"}}'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(
      client.waitForJsonResponse({
        method: "POST",
        url: "https://cp.kuaishou.com/rest/v2/creator/pc/authority/account/current",
        timeoutMs: 100,
      }),
    ).resolves.toMatchObject({ status: 200 });
  });
});
