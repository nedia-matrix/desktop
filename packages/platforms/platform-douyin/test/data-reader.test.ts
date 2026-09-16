import { describe, expect, it, vi } from "vitest";

import {
  douyinPlatformModule,
  parseDouyinAccountProfile,
  parseDouyinContentPage,
} from "../src/index.js";

describe("Douyin data reader", () => {
  it("maps account profile counters without requiring every field", () => {
    expect(
      parseDouyinAccountProfile({
        user: {
          signature: "简介",
          follower_count: 6,
          aweme_count: "9",
          total_favorited: "102",
        },
      }),
    ).toEqual({
      description: "简介",
      followerCount: 6,
      contentCount: 9,
      likeCount: 102,
    });
  });

  it("keeps opaque content ids and maps image-text metrics", () => {
    const page = parseDouyinContentPage(
      {
        status_code: 0,
        has_more: true,
        max_cursor: "opaque-cursor",
        total: 21,
        aweme_list: [
          {
            aweme_id: "7683054343616040198",
            author: { short_id: "190935187" },
            desc: "早八多睡10分钟的秘密",
            create_time: 1788850495,
            images: [{ url_list: ["https://p.example/cover.jpg"] }],
            statistics: {
              play_count: 20,
              digg_count: 2,
              comment_count: 1,
              share_count: 0,
              collect_count: 3,
            },
          },
        ],
      },
      "190935187",
    );

    expect(page).toMatchObject({
      hasMore: true,
      nextCursor: "opaque-cursor",
      total: 21,
      items: [
        {
          externalContentId: "7683054343616040198",
          contentType: "image_text",
          metrics: {
            viewCount: 20,
            likeCount: 2,
            commentCount: 1,
            shareCount: 0,
            collectCount: 3,
          },
        },
      ],
    });
  });

  it("rejects content attributed to another account", () => {
    expect(() =>
      parseDouyinContentPage(
        {
          status_code: 0,
          aweme_list: [
            { aweme_id: "content-1", author: { short_id: "other" } },
          ],
        },
        "expected",
      ),
    ).toThrow("账号与当前登录账号不一致");
  });

  it("observes the first page and marks it partial when more content exists", async () => {
    const events: string[] = [];
    const requestJson = vi.fn();
    const waitForJsonResponse = vi.fn(async () => {
      events.push("wait");
      return {
        status: 200,
        ok: true,
        body: {
          status_code: 0,
          has_more: true,
          max_cursor: "cursor-2",
          total: 2,
          aweme_list: [{ aweme_id: "content-1" }],
        },
      };
    });
    const result = await douyinPlatformModule.content!.read(
      {
        navigate: async () => {
          events.push("navigate");
        },
        requestJson,
        waitForJsonResponse,
        dispose: () => undefined,
      },
      "account-1",
    );

    expect(events).toEqual(["wait", "navigate"]);
    expect(requestJson).not.toHaveBeenCalled();
    expect(waitForJsonResponse).toHaveBeenCalledWith({
      method: "GET",
      url: expect.stringContaining("/janus/douyin/creator/pc/work_list"),
      timeoutMs: 10_000,
    });
    expect(result).toMatchObject({
      complete: false,
      pagesRead: 1,
      remoteTotal: 2,
      items: [{ externalContentId: "content-1" }],
    });
    expect(result.diagnostics?.[0]).toContain("翻页交互尚未验证");
  });
});
