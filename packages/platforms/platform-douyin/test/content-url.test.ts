import { describe, expect, it } from "vitest";

import { buildDouyinContentUrl } from "../src/content-url.js";

describe("Douyin content URL", () => {
  it("uses the route for the known content type and declines unknown types", () => {
    expect(buildDouyinContentUrl("work-1", "video")).toBe(
      "https://www.douyin.com/video/work-1",
    );
    expect(buildDouyinContentUrl("work-2", "image_text")).toBe(
      "https://www.douyin.com/note/work-2",
    );
    expect(buildDouyinContentUrl("work-3", "unknown")).toBeNull();
  });
});
