import { EventEmitter } from "node:events";

import type { PlatformAccountSummary } from "@nedia-matrix/ipc-contracts";
import type { PlatformModule } from "@nedia-matrix/platform-core";
import { describe, expect, it, vi } from "vitest";

import { PlaywrightBrowserSessionHost } from "../src/main/accounts/infrastructure/playwright-browser-session-host.js";

const account = {
  id: "account-1",
  platformId: "douyin",
  profileId: "matrix-douyin-account-1",
} as PlatformAccountSummary;

const platform = {
  id: "douyin",
  browser: {
    startUrl: "https://creator.douyin.com",
    allowedHostSuffixes: ["douyin.com"],
  },
  accounts: { detection: { probes: [] } },
} as PlatformModule;

function fakeOpenedSession() {
  const context = new EventEmitter();
  const close = vi.fn(async () => {
    context.emit("close");
  });
  return {
    id: "session-1",
    profileId: account.profileId,
    context,
    page: {
      isClosed: () => false,
      bringToFront: vi.fn(async () => undefined),
    },
    driver: { navigate: vi.fn(async () => undefined) },
    focus: vi.fn(async () => undefined),
    close,
  };
}

function dependencies(
  opened: ReturnType<typeof fakeOpenedSession>,
  removeProfileDirectory = vi.fn(async () => undefined),
) {
  return {
    openSession: vi.fn(async () => opened) as never,
    removeProfileDirectory: removeProfileDirectory as never,
    profilesRoot: () => "/profiles",
    evidenceRoot: () => "/evidence",
  };
}

describe("PlaywrightBrowserSessionHost", () => {
  it("forgets a closed BrowserContext and reports its account", async () => {
    const opened = fakeOpenedSession();
    const onSessionClosed = vi.fn();
    const host = new PlaywrightBrowserSessionHost(
      onSessionClosed,
      dependencies(opened),
    );

    await host.openForAutomation(account, platform);
    expect(host.size).toBe(1);
    opened.context.emit("close");

    expect(onSessionClosed).toHaveBeenCalledWith(account.id);
    expect(host.size).toBe(0);
  });

  it("opens login in the account Playwright session", async () => {
    const opened = fakeOpenedSession();
    const hostDependencies = dependencies(opened);
    const host = new PlaywrightBrowserSessionHost(vi.fn(), hostDependencies);

    await host.openForLogin(account, platform, {
      id: "default",
      displayName: "登录",
      url: "https://creator.douyin.com/login",
    });

    expect(hostDependencies.openSession).toHaveBeenCalledOnce();
    expect(opened.driver.navigate).toHaveBeenCalledWith(
      "https://creator.douyin.com/login",
    );
    expect(opened.focus).toHaveBeenCalled();
    expect(host.size).toBe(1);
  });

  it("reuses the login session for later automation", async () => {
    const opened = fakeOpenedSession();
    const hostDependencies = dependencies(opened);
    const host = new PlaywrightBrowserSessionHost(vi.fn(), hostDependencies);

    await host.openForLogin(account, platform, {
      id: "default",
      displayName: "登录",
      url: "https://creator.douyin.com/login",
    });
    const reused = await host.openForAutomation(account, platform);

    expect(reused).toBe(opened);
    expect(hostDependencies.openSession).toHaveBeenCalledOnce();
  });

  it("uses a scoped page for account verification and closes it afterwards", async () => {
    const opened = fakeOpenedSession();
    const verificationEvents = new EventEmitter();
    const verificationPage = Object.assign(verificationEvents, {
      url: () => platform.browser.startUrl,
      goto: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    });
    Object.assign(opened.context, {
      newPage: vi.fn(async () => verificationPage),
    });
    const host = new PlaywrightBrowserSessionHost(
      vi.fn(),
      dependencies(opened),
    );

    const verification = await host.openForVerification(account, platform);
    expect(verificationPage.goto).toHaveBeenCalledWith(
      platform.browser.startUrl,
      { waitUntil: "domcontentloaded" },
    );

    await verification.close();
    expect(verificationPage.close).toHaveBeenCalledOnce();
    expect(opened.page.bringToFront).toHaveBeenCalled();
  });

  it("uses the account profile with bundled Playwright Chromium", async () => {
    const opened = fakeOpenedSession();
    const hostDependencies = dependencies(opened);
    const host = new PlaywrightBrowserSessionHost(vi.fn(), hostDependencies);

    await host.openForAutomation(account, platform);

    expect(hostDependencies.openSession).toHaveBeenCalledWith({
      browser: platform.browser,
      sessionDetection: platform.accounts.detection,
      profileId: account.profileId,
      profileDirectory: `/profiles/${account.profileId}`,
      evidenceDirectory: `/evidence/${account.id}`,
    });
  });

  it("closes the account session before deleting its profile", async () => {
    const opened = fakeOpenedSession();
    const removeProfileDirectory = vi.fn(async () => undefined);
    const host = new PlaywrightBrowserSessionHost(
      vi.fn(),
      dependencies(opened, removeProfileDirectory),
    );

    await host.openForAutomation(account, platform);
    await host.remove(account);

    expect(opened.close).toHaveBeenCalledOnce();
    expect(removeProfileDirectory).toHaveBeenCalledWith(
      `/profiles/${account.profileId}`,
      { recursive: true, force: true },
    );
    expect(opened.close.mock.invocationCallOrder[0]).toBeLessThan(
      removeProfileDirectory.mock.invocationCallOrder[0] ?? 0,
    );
    expect(host.size).toBe(0);
  });
});
