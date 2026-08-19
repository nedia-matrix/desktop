import type { PublicationRecord } from "@nedia-matrix/application-publishing";
import type { PlatformModule } from "@nedia-matrix/platform-core";
import { describe, expect, it } from "vitest";

import { requireSafePublicationUrl } from "../src/main/publishing/publication-link.js";

const platform = {
  browser: {
    startUrl: "https://creator.douyin.com",
    allowedHostSuffixes: ["douyin.com"],
  },
} as PlatformModule;

function record(url: string): PublicationRecord {
  return {
    publication: { platformContentUrl: url },
  } as PublicationRecord;
}

describe("publication links", () => {
  it("allows stored HTTPS links inside the publication platform", () => {
    expect(
      requireSafePublicationUrl(
        record("https://www.douyin.com/video/work-1"),
        platform,
      ),
    ).toBe("https://www.douyin.com/video/work-1");
  });

  it("rejects links outside the publication platform", () => {
    expect(() =>
      requireSafePublicationUrl(
        record("https://douyin.com.example.test/phishing"),
        platform,
      ),
    ).toThrow("Publication URL is outside the platform boundary");
  });
});
