import type { PlatformSummary } from "@nedia-matrix/ipc-contracts";
import type { PlatformModule } from "@nedia-matrix/platform-core";
import { PlatformRegistry } from "@nedia-matrix/platform-core";
import { douyinPlatformModule } from "@nedia-matrix/platform-douyin";
import { kuaishouPlatformModule } from "@nedia-matrix/platform-kuaishou";
import { xiaohongshuPlatformModule } from "@nedia-matrix/platform-xiaohongshu";

const registeredModules: PlatformModule[] = [
  douyinPlatformModule,
  xiaohongshuPlatformModule,
  kuaishouPlatformModule,
];

const platformRegistry = new PlatformRegistry(registeredModules);

export function platformFor(platformId: string): PlatformModule {
  return platformRegistry.require(platformId);
}

export function platformSummaries(): PlatformSummary[] {
  return platformRegistry.list().map((platform) => ({
    id: platform.id,
    displayName: platform.displayName,
    entryUrl: platform.browser.startUrl,
    rulesVersion: platform.rulesVersion,
    implementationStatus:
      platform.publishing?.implementationStatus ??
      platform.accounts.implementationStatus,
    loginEntries: platform.accounts.loginEntries.map((entry) => ({ ...entry })),
    publishCapabilities: Object.entries(
      platform.publishing?.forms ?? {},
    ).flatMap(([contentForm, form]) =>
      form && (contentForm === "video" || contentForm === "imageText")
        ? [
            {
              contentForm,
              submissionModes: [...form.submissionModes],
              constraints: { ...form.constraints },
              ...(form.tagPolicy ? { tagPolicy: { ...form.tagPolicy } } : {}),
              ...(form.descriptionComposition
                ? {
                    descriptionComposition: {
                      parts: [...form.descriptionComposition.parts],
                      separator: form.descriptionComposition.separator,
                    },
                  }
                : {}),
            },
          ]
        : [],
    ),
  }));
}
