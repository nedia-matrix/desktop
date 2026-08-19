import type { PlatformBrowserPolicy } from "@nedia-matrix/platform-core";

export function isAllowedPlatformNavigation(
  targetUrl: string,
  browser: PlatformBrowserPolicy,
): boolean {
  try {
    const target = new URL(targetUrl);
    const isSecurePlatform = target.protocol === "https:";
    const isLocalMock =
      target.protocol === "http:" &&
      (target.hostname === "127.0.0.1" || target.hostname === "localhost");
    return (
      (isSecurePlatform || isLocalMock) &&
      browser.allowedHostSuffixes.some(
        (suffix) =>
          target.hostname === suffix || target.hostname.endsWith(`.${suffix}`),
      )
    );
  } catch {
    return false;
  }
}
