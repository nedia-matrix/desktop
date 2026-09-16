import { describe, expect, it } from "vitest";

import { buildKuaishouContentUrl } from "../src/content-url.js";

describe("Kuaishou content URL", () => {
  it("builds a short-video URL from the normalized work id", () => {
    expect(buildKuaishouContentUrl(" work-1 ")).toBe(
      "https://www.kuaishou.com/short-video/work-1",
    );
    expect(buildKuaishouContentUrl("  ")).toBeNull();
  });
});
