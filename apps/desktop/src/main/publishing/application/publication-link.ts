import type { PublicationRecord } from "@nedia-matrix/application-publishing";
import { isAllowedPlatformNavigation } from "@nedia-matrix/automation-playwright";
import type { PlatformModule } from "@nedia-matrix/platform-core";

export function requireSafePublicationUrl(
  record: PublicationRecord,
  platform: PlatformModule,
): string {
  const url = record.publication.platformContentUrl;
  if (!url) throw new TypeError("Publication does not have a platform URL");
  if (!isAllowedPlatformNavigation(url, platform.browser)) {
    throw new TypeError("Publication URL is outside the platform boundary");
  }
  return url;
}
