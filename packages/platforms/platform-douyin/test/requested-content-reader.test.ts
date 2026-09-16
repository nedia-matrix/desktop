import { describe, expect, it, vi } from "vitest";

import { douyinRequestedContentCapability } from "../src/index.js";

function response(body: unknown) {
  return { status: 200, ok: true, body };
}

describe("Douyin requested content reader", () => {
  it("requests cursor pages with GET and deduplicates overlapping items", async () => {
    const navigate = vi.fn(async () => undefined);
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          status_code: 0,
          has_more: true,
          max_cursor: "cursor-2",
          total: 3,
          aweme_list: [{ aweme_id: "content-1" }, { aweme_id: "content-2" }],
        }),
      )
      .mockResolvedValueOnce(
        response({
          status_code: 0,
          has_more: false,
          max_cursor: "cursor-3",
          total: 3,
          aweme_list: [{ aweme_id: "content-2" }, { aweme_id: "content-3" }],
        }),
      );

    const result = await douyinRequestedContentCapability.read(
      {
        navigate,
        requestJson,
        waitForJsonResponse: async () => null,
        dispose: () => undefined,
      },
      "account-1",
    );

    expect(navigate).toHaveBeenCalledWith(
      "https://creator.douyin.com/creator-micro/content/manage",
    );
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(requestJson.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({
        method: "GET",
        url: expect.stringContaining("max_cursor=0"),
      }),
      expect.objectContaining({
        method: "GET",
        url: expect.stringContaining("max_cursor=cursor-2"),
      }),
    ]);
    expect(result).toMatchObject({
      complete: true,
      pagesRead: 2,
      remoteTotal: 3,
    });
    expect(result.items.map((item) => item.externalContentId)).toEqual([
      "content-1",
      "content-2",
      "content-3",
    ]);
  });

  it("keeps completed pages when a later request fails", async () => {
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          status_code: 0,
          has_more: true,
          max_cursor: "cursor-2",
          total: 2,
          aweme_list: [{ aweme_id: "content-1" }],
        }),
      )
      .mockResolvedValueOnce({ status: 503, ok: false, body: null });

    const result = await douyinRequestedContentCapability.read(
      {
        navigate: async () => undefined,
        requestJson,
        waitForJsonResponse: async () => null,
        dispose: () => undefined,
      },
      "account-1",
    );

    expect(result).toMatchObject({
      complete: false,
      pagesRead: 1,
      remoteTotal: 2,
      items: [{ externalContentId: "content-1" }],
      diagnostics: ["抖音作品第 2 页请求失败（HTTP 503）"],
    });
  });

  it("stops when the response cursor does not advance", async () => {
    const requestJson = vi.fn(async () =>
      response({
        status_code: 0,
        has_more: true,
        max_cursor: "0",
        aweme_list: [{ aweme_id: "content-1" }],
      }),
    );

    const result = await douyinRequestedContentCapability.read(
      {
        navigate: async () => undefined,
        requestJson,
        waitForJsonResponse: async () => null,
        dispose: () => undefined,
      },
      "account-1",
    );

    expect(requestJson).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      complete: false,
      pagesRead: 1,
      diagnostics: ["抖音作品游标未前进，已停止同步"],
    });
  });
});
