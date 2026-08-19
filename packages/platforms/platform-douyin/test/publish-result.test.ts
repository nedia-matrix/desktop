import { describe, expect, it } from "vitest";

import {
  classifyDouyinPublishResponse,
  isDouyinPublishResponseCandidate,
} from "../src/publish-result.js";

const publishUrl = "https://creator.douyin.com/web/api/media/aweme/create_v2";

describe("Douyin publish responses", () => {
  it("accepts only publish mutations", () => {
    expect(
      isDouyinPublishResponseCandidate({ method: "POST", url: publishUrl }),
    ).toBe(true);
    expect(
      isDouyinPublishResponseCandidate({ method: "GET", url: publishUrl }),
    ).toBe(false);
    expect(
      isDouyinPublishResponseCandidate({
        method: "POST",
        url: "https://creator.douyin.com/web/api/media/aweme/create/",
      }),
    ).toBe(false);
    expect(
      isDouyinPublishResponseCandidate({
        method: "POST",
        url: "https://example.test/web/api/media/aweme/create/",
      }),
    ).toBe(false);
  });

  it("keeps verification responses non-terminal", () => {
    expect(
      classifyDouyinPublishResponse(
        {
          method: "POST",
          url: publishUrl,
          httpStatus: 200,
          body: {
            status_code: 2190008,
            status_msg: "请先完成短信验证码验证",
          },
        },
        "video",
      ),
    ).toEqual({
      kind: "verification_required",
      message: "请先完成短信验证码验证",
    });
  });

  it("extracts identity from a JSON string response", () => {
    expect(
      classifyDouyinPublishResponse(
        {
          method: "POST",
          url: publishUrl,
          httpStatus: 200,
          body: JSON.stringify({
            status_code: 0,
            item_id: "7521234567890123456",
          }),
        },
        "imageText",
      ),
    ).toEqual({
      kind: "published",
      postId: "7521234567890123456",
      postUrl: "https://www.douyin.com/note/7521234567890123456",
    });
  });

  it("classifies explicit success without inventing an identity", () => {
    expect(
      classifyDouyinPublishResponse(
        {
          method: "POST",
          url: publishUrl,
          httpStatus: 200,
          body: { status_code: 0 },
        },
        "video",
      ),
    ).toEqual({ kind: "accepted", message: null });
  });

  it("ignores unrelated successful and failed mutations", () => {
    expect(
      classifyDouyinPublishResponse(
        {
          method: "POST",
          url: "https://creator.douyin.com/web/api/telemetry/report/",
          httpStatus: 500,
          body: { status_code: 500, status_msg: "report error" },
        },
        "video",
      ),
    ).toEqual({ kind: "ignore" });
  });

  it("classifies a terminal failure", () => {
    expect(
      classifyDouyinPublishResponse(
        {
          method: "POST",
          url: publishUrl,
          httpStatus: 400,
          body: { status_code: 500, status_msg: "发布失败" },
        },
        "video",
      ),
    ).toEqual({ kind: "failed", error: "发布失败" });
  });
});
