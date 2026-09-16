import { describe, expect, it, vi } from "vitest";

import {
  xiaohongshuPlatformModule,
  parseXiaohongshuAccountProfile,
  parseXiaohongshuContentPage,
} from "../src/index.js";

describe("Xiaohongshu data reader", () => {
  it("maps profile counters", () => {
    expect(
      parseXiaohongshuAccountProfile({
        data: {
          personal_desc: "简介",
          fans_count: 8,
          follow_count: 4,
          notes_count: 9,
          faved_count: 102,
        },
      }),
    ).toEqual({
      description: "简介",
      followerCount: 8,
      followingCount: 4,
      contentCount: 9,
      likeCount: 102,
    });
  });

  it("maps note metrics and never carries the request token into storage", () => {
    const page = parseXiaohongshuContentPage({
      success: true,
      code: 0,
      data: {
        tags: [{ id: "special.note_time_desc", notes_count: 6 }],
        notes: [
          {
            id: "6a9f878e000000001203f51b",
            display_title: "早八多睡10分钟的秘密",
            type: "normal",
            visible_time: 1788839876,
            view_count: 20,
            likes: 2,
            comments_count: 0,
            shared_count: 0,
            collected_count: 2,
            tab_status: 1,
            xsec_token: "must-not-be-stored",
            images_list: [{ url: "http://sns.example/cover.jpg" }],
          },
        ],
      },
    });

    expect(page).toMatchObject({
      total: 6,
      items: [
        {
          externalContentId: "6a9f878e000000001203f51b",
          contentUrl:
            "https://www.xiaohongshu.com/explore/6a9f878e000000001203f51b",
          contentType: "image_text",
          coverUrl: "https://sns.example/cover.jpg",
          platformStatus: "1",
          metrics: {
            viewCount: 20,
            likeCount: 2,
            commentCount: 0,
            shareCount: 0,
            collectCount: 2,
          },
        },
      ],
    });
    expect(JSON.stringify(page)).not.toContain("must-not-be-stored");
  });

  it("scrolls for later pages, ignores observed replays and deduplicates notes", async () => {
    const events: string[] = [];
    const requestJson = vi.fn();
    const responses = [
      {
        status: 200,
        ok: true,
        body: {
          success: true,
          code: 0,
          data: {
            tags: [{ id: "special.note_time_desc", notes_count: 3 }],
            notes: [
              { id: "content-1", type: "video" },
              { id: "content-2", type: "normal" },
            ],
          },
        },
      },
      {
        status: 200,
        ok: true,
        body: {
          success: true,
          code: 0,
          data: {
            tags: [{ id: "special.note_time_desc", notes_count: 3 }],
            notes: [
              { id: "content-2", type: "normal" },
              { id: "content-3", type: "video" },
            ],
          },
        },
      },
    ];
    const waitForJsonResponse = vi.fn(async () => {
      events.push("wait");
      return responses.shift() ?? null;
    });
    const scrollToEnd = vi.fn(async () => {
      events.push("scroll");
      return { found: true, moved: true, atEnd: true };
    });
    const result = await xiaohongshuPlatformModule.content!.read(
      {
        navigate: async () => {
          events.push("navigate");
        },
        requestJson,
        waitForJsonResponse,
        scrollToEnd,
        dispose: () => undefined,
      },
      "account-1",
    );

    expect(events).toEqual(["wait", "navigate", "wait", "scroll"]);
    expect(requestJson).not.toHaveBeenCalled();
    expect(waitForJsonResponse).toHaveBeenNthCalledWith(1, {
      method: "GET",
      url: expect.stringContaining("/api/galaxy/v2/creator/note/user/posted"),
      timeoutMs: 10_000,
    });
    expect(waitForJsonResponse).toHaveBeenNthCalledWith(2, {
      method: "GET",
      url: expect.stringContaining("/api/galaxy/v2/creator/note/user/posted"),
      timeoutMs: 10_000,
      replayObserved: false,
    });
    expect(scrollToEnd).toHaveBeenCalledWith({ selector: ".content" });
    expect(result).toEqual({
      complete: true,
      pagesRead: 2,
      remoteTotal: 3,
      items: [
        expect.objectContaining({ externalContentId: "content-1" }),
        expect.objectContaining({ externalContentId: "content-2" }),
        expect.objectContaining({ externalContentId: "content-3" }),
      ],
    });
  });

  it("keeps collected pages partial when scrolling yields no next response", async () => {
    const waitForJsonResponse = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        body: {
          success: true,
          code: 0,
          data: {
            tags: [{ id: "special.note_time_desc", notes_count: 2 }],
            notes: [{ id: "content-1", type: "video" }],
          },
        },
      })
      .mockResolvedValueOnce(null);
    const result = await xiaohongshuPlatformModule.content!.read(
      {
        navigate: async () => undefined,
        requestJson: vi.fn(),
        waitForJsonResponse,
        scrollToEnd: async () => ({
          found: true,
          moved: true,
          atEnd: true,
        }),
        dispose: () => undefined,
      },
      "account-1",
    );

    expect(result).toMatchObject({
      complete: false,
      pagesRead: 1,
      remoteTotal: 2,
      items: [{ externalContentId: "content-1" }],
    });
    expect(result.diagnostics?.[0]).toContain("未观察到下一页响应");
  });
});
