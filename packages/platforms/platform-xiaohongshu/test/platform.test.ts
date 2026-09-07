import { describe, expect, it } from "vitest";

import { xiaohongshuPlatformModule } from "../src/index.js";

describe("Xiaohongshu platform workflow", () => {
  it("uses personal_info as the only account identity source", () => {
    expect(xiaohongshuPlatformModule.accounts.detection.probes).toEqual([
      expect.objectContaining({
        identityScheme: "xiaohongshu.red_num",
        source: {
          kind: "request",
          url: "https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info",
        },
      }),
    ]);
    expect(
      xiaohongshuPlatformModule.accounts.detection.domFallback,
    ).toBeUndefined();
  });

  it("submits through the closed-shadow publish component host", () => {
    const submit =
      xiaohongshuPlatformModule.publishing?.forms.imageText?.automation.submit;

    expect(submit?.page.targets["publish.submit"]?.candidates[0]).toEqual({
      kind: "css",
      selector:
        'xhs-publish-btn[is-publish="true"][submit-disabled="false"][submit-loading="false"]',
    });
    expect(submit?.steps).toEqual([
      expect.objectContaining({
        kind: "click-position",
        targetId: "publish.submit",
        xRatio: 0.65,
        yRatio: 0.5,
      }),
      {
        kind: "click-if-present",
        targetId: "publish.submit.confirm",
        timeoutMs: 5_000,
      },
    ]);
  });

  it("waits for uploads and the submit component before crossing the submit boundary", () => {
    const prepare =
      xiaohongshuPlatformModule.publishing?.forms.imageText?.automation.prepare;

    expect(prepare?.steps).toContainEqual({
      kind: "wait-for-target-count",
      targetId: "publish.media.imagePreview",
      inputKey: "mediaPaths",
      timeoutMs: 1_800_000,
    });
    expect(prepare?.steps.slice(-2)).toEqual([
      {
        kind: "wait-for-state",
        stateId: "uploadSettled",
        timeoutMs: 1_800_000,
      },
      {
        kind: "wait-for-state",
        stateId: "submitReady",
        timeoutMs: 60_000,
      },
    ]);
  });
});
