import { describe, expect, it } from "vitest";

import {
  parseRuntimePlatformContentQuery,
  parseRuntimePlatformContentSyncRequest,
  runtimePlatformContentQueryResult,
} from "../src/main/runtime-api/mapping/runtime-platform-content-mapper.js";

const target = {
  platform: "douyin",
  externalAccountId: "external-account-1",
};

describe("runtime platform content mapping", () => {
  it("deduplicates content ids in their first-seen order", () => {
    expect(
      parseRuntimePlatformContentQuery({
        target,
        externalContentIds: ["content-2", "content-1", "content-2"],
      }),
    ).toEqual({
      target,
      externalContentIds: ["content-2", "content-1"],
    });
  });

  it("enforces the batch boundary and rejects system-local identities", () => {
    expect(() =>
      parseRuntimePlatformContentQuery({
        target,
        externalContentIds: Array.from(
          { length: 101 },
          (_, index) => `content-${index}`,
        ),
      }),
    ).toThrow("1 to 100 items");
    expect(() =>
      parseRuntimePlatformContentSyncRequest({
        target: { ...target, runtimeAccountId: "local-account-1" },
      }),
    ).toThrow("runtimeAccountId is not accepted");
    expect(() =>
      parseRuntimePlatformContentSyncRequest({
        target: { ...target, externalAccountId: "   " },
      }),
    ).toThrow("target.externalAccountId");
    expect(() =>
      parseRuntimePlatformContentQuery({
        webAccountId: "web-account-1",
        target,
        externalContentIds: ["content-1"],
      }),
    ).toThrow("webAccountId is not accepted");
  });

  it("maps only public snapshot and sync fields", () => {
    const result = runtimePlatformContentQueryResult(
      { target, externalContentIds: ["content-1"] },
      {
        contents: [
          {
            id: "local-content-1",
            accountId: "local-account-1",
            platformId: "douyin",
            externalContentId: "content-1",
            contentUrl: null,
            contentType: "video",
            title: null,
            description: null,
            coverUrl: null,
            publishedAt: null,
            platformStatus: null,
            metrics: { viewCount: 0 },
            contentObservedAt: "2026-09-17T00:00:00.000Z",
            metricsObservedAt: "2026-09-17T00:00:00.000Z",
            createdAt: "2026-09-17T00:00:00.000Z",
            updatedAt: "2026-09-17T00:00:00.000Z",
          },
        ],
        latestRun: {
          id: "local-run-1",
          accountId: "local-account-1",
          status: "completed",
          startedAt: "2026-09-17T00:00:00.000Z",
          completedAt: "2026-09-17T00:00:01.000Z",
          pagesRead: 1,
          itemsRead: 1,
          remoteTotal: 1,
          diagnostics: ["internal diagnostic"],
        },
      },
    );

    expect(result.results[0]).toMatchObject({
      status: "found",
      snapshot: { metrics: { viewCount: 0 } },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("local-account-1");
    expect(serialized).not.toContain("local-content-1");
    expect(serialized).not.toContain("local-run-1");
    expect(serialized).not.toContain("internal diagnostic");
  });
});
