import { describe, expect, it } from "vitest";

import { kuaishouPlatformModule } from "../src/index.js";

describe("Kuaishou platform module", () => {
  it("declares account detection and the supported publishing workflows", () => {
    expect(kuaishouPlatformModule).toMatchObject({
      rulesVersion: "1.2.1-work-id-priority",
      accounts: { implementationStatus: "live-tested" },
    });
    expect(kuaishouPlatformModule.accounts.detection.probes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: {
            kind: "observed-response",
            method: "POST",
            url: "https://cp.kuaishou.com/rest/cp/creator/pc/home/userInfo",
            timeoutMs: 1_500,
          },
          fields: expect.objectContaining({
            externalAccountId: ["data", "coreUserInfo", "userId"],
          }),
        }),
      ]),
    );
    expect(kuaishouPlatformModule.publishing?.forms.video).toMatchObject({
      submissionModes: ["automatic", "manual_confirmation"],
      descriptionComposition: {
        parts: ["title", "body"],
        separator: " ",
      },
    });
    expect(kuaishouPlatformModule.publishing?.forms.imageText).toMatchObject({
      submissionModes: ["automatic", "manual_confirmation"],
    });
    expect(
      kuaishouPlatformModule.publishing?.forms.imageText?.automation.prepare
        .steps,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "drop-files",
          targetId: "publish.media.imageDropZone",
        }),
        expect.objectContaining({
          kind: "wait-for-target-count",
          targetId: "publish.media.imagePreview",
        }),
      ]),
    );
    expect(kuaishouPlatformModule.publishing?.createResultMonitor).toBeTypeOf(
      "function",
    );
    const submitSteps = [{ kind: "click", targetId: "publish.submit" }];
    expect(
      kuaishouPlatformModule.publishing?.forms.video?.automation.submit.steps,
    ).toEqual(submitSteps);
    expect(
      kuaishouPlatformModule.publishing?.forms.imageText?.automation.submit
        .steps,
    ).toEqual(submitSteps);
  });
});
