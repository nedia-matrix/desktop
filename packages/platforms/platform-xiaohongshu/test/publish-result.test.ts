import { describe, expect, it } from "vitest";

import {
  classifyXiaohongshuPublishResponse,
  isXiaohongshuPublishResponseCandidate,
} from "../src/publish-result.js";

const publishUrl = "https://edith.xiaohongshu.com/web_api/sns/v2/note";

describe("Xiaohongshu publish responses", () => {
  it("accepts the note endpoint and excludes upload or draft traffic", () => {
    expect(
      isXiaohongshuPublishResponseCandidate({
        method: "POST",
        url: publishUrl,
      }),
    ).toBe(true);
    expect(
      isXiaohongshuPublishResponseCandidate({
        method: "POST",
        url: "https://creator.xiaohongshu.com/api/draft/create",
      }),
    ).toBe(false);
    expect(
      isXiaohongshuPublishResponseCandidate({
        method: "POST",
        url: "https://example.test/web_api/sns/v2/note",
      }),
    ).toBe(false);
  });

  it("extracts the note identity from a successful response", () => {
    expect(
      classifyXiaohongshuPublishResponse(
        {
          method: "POST",
          url: publishUrl,
          httpStatus: 200,
          body: {
            success: true,
            result: 0,
            data: { id: "66f1234567890abc12345678" },
          },
        },
        "imageText",
      ),
    ).toEqual({
      kind: "published",
      postId: "66f1234567890abc12345678",
      postUrl: "https://www.xiaohongshu.com/explore/66f1234567890abc12345678",
    });
  });

  it("keeps explicit success without an identity non-terminal", () => {
    expect(
      classifyXiaohongshuPublishResponse(
        {
          method: "POST",
          url: publishUrl,
          httpStatus: 200,
          body: { success: true, result: 0 },
        },
        "video",
      ),
    ).toEqual({ kind: "accepted", message: null });
  });

  it("classifies an explicit platform failure", () => {
    expect(
      classifyXiaohongshuPublishResponse(
        {
          method: "POST",
          url: publishUrl,
          httpStatus: 200,
          body: { success: false, result: -1, message: "发布失败" },
        },
        "imageText",
      ),
    ).toEqual({ kind: "failed", error: "发布失败" });
  });
});
