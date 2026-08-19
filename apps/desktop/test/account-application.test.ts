import type { PlatformAccountSummary } from "@nedia-matrix/ipc-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountApplication } from "../src/main/accounts/account-application.js";

const account: PlatformAccountSummary = {
  id: "account-1",
  platformId: "douyin",
  profileId: "matrix-douyin-account-1",
  displayName: "抖音账号",
  externalAccountId: null,
  nickname: null,
  avatarUrl: null,
  accountInfo: [],
  status: "login_required",
  lastVerifiedAt: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

afterEach(() => vi.useRealTimers());

describe("account application", () => {
  it("opens the login entry through the unified account action and recognizes the account automatically", async () => {
    vi.useFakeTimers();
    const accounts = new Map([[account.id, { ...account }]]);
    const updates: PlatformAccountSummary[] = [];
    const openForLogin = vi.fn(async () => openedSession());
    const sessionDetector = vi
      .fn()
      .mockResolvedValueOnce({ status: "login_required", source: "api" })
      .mockResolvedValueOnce({
        status: "authenticated",
        externalAccountId: "douyin-42",
        nickname: "自动识别账号",
        avatarUrl: null,
        accountInfo: [{ key: "follower_count", value: 12800 }],
        source: "api",
      });
    const application = new AccountApplication({
      accountStore: {
        list: () => [...accounts.values()],
        require: (accountId) => {
          const stored = accounts.get(accountId);
          if (!stored) throw new TypeError("Platform account does not exist");
          return stored;
        },
        put: (stored) => void accounts.set(stored.id, stored),
      },
      browserSessions: {
        openForLogin,
        openForAutomation: async () => openedSession(),
        closeAutomation: async () => undefined,
      },
      removeAccountResources: async () => undefined,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
      sessionDetector,
      onAccountUpdated: (updated) => updates.push(updated),
      recognitionIntervalMs: 100,
      recognitionMaxAttempts: 2,
    });

    await expect(
      application.openAccount({ accountId: account.id }),
    ).resolves.toEqual({
      sessionId: "session-1",
      profileId: account.profileId,
    });
    expect(openForLogin).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);

    expect(sessionDetector).toHaveBeenCalledTimes(2);
    expect(accounts.get(account.id)).toMatchObject({
      status: "authenticated",
      externalAccountId: "douyin-42",
      nickname: "自动识别账号",
      accountInfo: [{ key: "follower_count", value: 12800 }],
    });
    expect(updates).toHaveLength(1);
  });

  it("preserves a stable account identity when automatic recognition detects a switched account", async () => {
    const storedAccount: PlatformAccountSummary = {
      ...account,
      externalAccountId: "douyin-1",
      nickname: "原账号",
      displayName: "原账号",
      status: "authenticated",
    };
    const accounts = new Map([[storedAccount.id, storedAccount]]);
    const updates: PlatformAccountSummary[] = [];
    const application = new AccountApplication({
      accountStore: {
        list: () => [...accounts.values()],
        require: (accountId) => {
          const stored = accounts.get(accountId);
          if (!stored) throw new TypeError("Platform account does not exist");
          return stored;
        },
        put: (stored) => void accounts.set(stored.id, stored),
      },
      browserSessions: {
        openForLogin: async () => openedSession(),
        openForAutomation: async () => openedSession(),
        closeAutomation: async () => undefined,
      },
      removeAccountResources: async () => undefined,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
      sessionDetector: async () => ({
        status: "authenticated",
        externalAccountId: "douyin-2",
        nickname: "切换后的账号",
        avatarUrl: null,
        accountInfo: [],
        source: "api",
      }),
      onAccountUpdated: (updated) => updates.push(updated),
      recognitionMaxAttempts: 1,
    });

    await application.openAccount({ accountId: storedAccount.id });
    await vi.waitFor(() => {
      expect(accounts.get(storedAccount.id)?.status).toBe("unknown");
    });

    expect(accounts.get(storedAccount.id)).toMatchObject({
      externalAccountId: "douyin-1",
      nickname: "原账号",
      displayName: "原账号",
      status: "unknown",
    });
    expect(updates).toHaveLength(1);
  });

  it("requires an explicit refresh to adopt the currently detected account", async () => {
    const storedAccount: PlatformAccountSummary = {
      ...account,
      externalAccountId: "douyin-1",
      nickname: "原账号",
      displayName: "原账号",
      status: "unknown",
    };
    const accounts = new Map([[storedAccount.id, storedAccount]]);
    const application = new AccountApplication({
      accountStore: {
        list: () => [...accounts.values()],
        require: (accountId) => {
          const stored = accounts.get(accountId);
          if (!stored) throw new TypeError("Platform account does not exist");
          return stored;
        },
        put: (stored) => void accounts.set(stored.id, stored),
      },
      browserSessions: {
        openForLogin: async () => openedSession(),
        openForAutomation: async () => openedSession(),
        closeAutomation: async () => undefined,
      },
      removeAccountResources: async () => undefined,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
      sessionDetector: async () => ({
        status: "authenticated",
        externalAccountId: "douyin-2",
        nickname: "切换后的账号",
        avatarUrl: null,
        accountInfo: [],
        source: "api",
      }),
    });

    await expect(
      application.verifyAccount({ accountId: storedAccount.id }),
    ).resolves.toEqual({
      status: "unknown",
      reason:
        "当前登录的抖音账号与本地记录不一致，请切回原账号或刷新账号信息后重试",
    });
    expect(accounts.get(storedAccount.id)).toMatchObject({
      externalAccountId: "douyin-1",
      nickname: "原账号",
      displayName: "原账号",
      status: "unknown",
    });

    await expect(
      application.refreshAccount({ accountId: storedAccount.id }),
    ).resolves.toMatchObject({
      status: "authenticated",
      externalAccountId: "douyin-2",
    });
    expect(accounts.get(storedAccount.id)).toMatchObject({
      externalAccountId: "douyin-2",
      nickname: "切换后的账号",
      displayName: "切换后的账号",
      status: "authenticated",
    });
  });
});

function openedSession() {
  return {
    id: "session-1",
    profileId: account.profileId,
    page: { isClosed: () => false },
    driver: {},
    sessionProbeClient: {},
  } as never;
}
