import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  browserLaunchCandidates,
  browserProfileDirectory,
  createBrowserProfileId,
  isAllowedPlatformNavigation,
} from "../src/index.js";

const platform = {
  startUrl: "https://creator.douyin.com/home",
  allowedHostSuffixes: ["douyin.com"],
} as Parameters<typeof isAllowedPlatformNavigation>[1];

describe("Playwright browser profiles", () => {
  it("tries installed browsers before the downloaded Playwright browser", () => {
    expect(browserLaunchCandidates()).toEqual([
      { name: "Google Chrome", options: { channel: "chrome" } },
      { name: "Microsoft Edge", options: { channel: "msedge" } },
      { name: "Playwright Chromium", options: {} },
    ]);
  });

  it("creates a stable account-specific profile identifier", () => {
    expect(createBrowserProfileId("Douyin", "Account 42")).toBe(
      "matrix-douyin-account-42",
    );
  });

  it("keeps profiles below the configured root", () => {
    expect(browserProfileDirectory("/tmp/matrix-profiles", "account-42")).toBe(
      join("/tmp/matrix-profiles", "account-42"),
    );
    expect(() => browserProfileDirectory("relative", "account-42")).toThrow();
  });
});

describe("Playwright platform navigation", () => {
  it("allows HTTPS platform hosts and rejects lookalike hosts", () => {
    expect(
      isAllowedPlatformNavigation("https://creator.douyin.com/home", platform),
    ).toBe(true);
    expect(
      isAllowedPlatformNavigation("https://douyin.com.example.test", platform),
    ).toBe(false);
    expect(
      isAllowedPlatformNavigation("http://creator.douyin.com/home", platform),
    ).toBe(false);
  });

  it("allows HTTP only for an explicitly configured loopback mock", () => {
    const localPlatform = {
      startUrl: "http://127.0.0.1:4173/home",
      allowedHostSuffixes: ["127.0.0.1"],
    } as Parameters<typeof isAllowedPlatformNavigation>[1];

    expect(
      isAllowedPlatformNavigation("http://127.0.0.1:4173/home", localPlatform),
    ).toBe(true);
    expect(
      isAllowedPlatformNavigation("http://192.168.1.10:4173/home", {
        startUrl: "http://192.168.1.10:4173/home",
        allowedHostSuffixes: ["192.168.1.10"],
      } as Parameters<typeof isAllowedPlatformNavigation>[1]),
    ).toBe(false);
  });
});
