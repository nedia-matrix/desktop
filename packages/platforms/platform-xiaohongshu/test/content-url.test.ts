import { describe, expect, it } from "vitest";

import { buildXiaohongshuContentUrl } from "../src/content-url.js";

describe("Xiaohongshu content URL", () => {
  it("builds an explore URL from the normalized content id", () => {
    expect(buildXiaohongshuContentUrl(" note-1 ")).toBe(
      "https://www.xiaohongshu.com/explore/note-1",
    );
    expect(buildXiaohongshuContentUrl("  ")).toBeNull();
  });
});
