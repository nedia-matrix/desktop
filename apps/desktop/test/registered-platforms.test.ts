import { describe, expect, it } from "vitest";

import {
  platformFor,
  platformSummaries,
} from "../src/main/registered-platforms.js";

describe("registered desktop platforms", () => {
  it("exposes capability-oriented modules through the registry", () => {
    expect(platformSummaries().map((platform) => platform.id)).toEqual([
      "douyin",
      "xiaohongshu",
      "kuaishou",
    ]);
    expect(platformFor("douyin").publishing?.forms.video).toBeDefined();
    expect(platformFor("douyin").publishing?.createResultMonitor).toBeTypeOf(
      "function",
    );
    expect(platformFor("kuaishou").publishing?.forms.video).toMatchObject({
      submissionModes: ["automatic", "manual_confirmation"],
    });
    expect(platformFor("kuaishou").publishing?.forms.imageText).toMatchObject({
      submissionModes: ["automatic", "manual_confirmation"],
    });
    expect(platformSummaries()).toContainEqual(
      expect.objectContaining({
        id: "kuaishou",
        implementationStatus: "live-tested",
        publishCapabilities: [
          {
            contentForm: "video",
            submissionModes: ["automatic", "manual_confirmation"],
          },
          {
            contentForm: "imageText",
            submissionModes: ["automatic", "manual_confirmation"],
          },
        ],
      }),
    );
    expect(platformSummaries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "douyin",
          implementationStatus: "live-tested",
          loginEntries: [
            expect.objectContaining({
              id: "default",
              url: "https://creator.douyin.com/creator-micro/home",
            }),
          ],
        }),
      ]),
    );
  });

  it("rejects platform ids that are not registered", () => {
    expect(() => platformFor("missing-platform")).toThrow(
      "Platform is not registered: missing-platform",
    );
  });
});
