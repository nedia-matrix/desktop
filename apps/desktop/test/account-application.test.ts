import type { PlatformAccountSummary } from "@nedia-matrix/ipc-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountApplication } from "../src/main/accounts/account-application.js";
import { PlatformAccountStore } from "../src/main/accounts/account-store.js";

const account: PlatformAccountSummary = {
  id: "account-1",
  platformId: "douyin",
  profileId: "matrix-douyin-account-1",
  lifecycle: "pending_identity",
  displayName: "抖音账号",
  identityScheme: null,
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
  it("notifies after account creation and completed removal", async () => {
    const accounts = new Map<string, PlatformAccountSummary>();
    let changes = 0;
    const application = new AccountApplication({
      accountStore: memoryAccountStore(accounts),
      browserSessions: {
        openForLogin: async () => openedSession(),
        openForAutomation: async () => openedSession(),
        closeAutomation: async () => undefined,
        removeProfile: async () => undefined,
      },
      removeAccountResources: async (stored) => {
        accounts.delete(stored.id);
      },
      createId: () => "created-account",
      onAccountsChanged: () => {
        changes += 1;
      },
    });

    const created = application.createAccount({ platformId: "douyin" });
    expect(accounts.get(created.id)).toEqual(created);
    expect(changes).toBe(1);

    await application.removeAccount({ accountId: created.id });
    expect(accounts.has(created.id)).toBe(false);
    expect(changes).toBe(2);
  });

  it("opens the login entry through the unified account action and recognizes the account automatically", async () => {
    vi.useFakeTimers();
    const accounts = new Map([[account.id, { ...account }]]);
    const updates: number[] = [];
    const openForLogin = vi.fn(async () => openedSession());
    const sessionDetector = vi
      .fn()
      .mockResolvedValueOnce({ status: "login_required", source: "api" })
      .mockResolvedValueOnce({
        status: "authenticated",
        identityScheme: "douyin.short_id",
        externalAccountId: "douyin-42",
        nickname: "自动识别账号",
        avatarUrl: null,
        accountInfo: [{ key: "follower_count", value: 12800 }],
        source: "api",
      });
    const application = new AccountApplication({
      accountStore: memoryAccountStore(accounts),
      browserSessions: {
        openForLogin,
        openForAutomation: async () => openedSession(),
        closeAutomation: async () => undefined,
        removeProfile: async () => undefined,
      },
      removeAccountResources: async () => undefined,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
      sessionDetector,
      onAccountsChanged: () => updates.push(1),
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
      lifecycle: "active",
      identityScheme: "douyin.short_id",
      externalAccountId: "douyin-1",
      nickname: "原账号",
      displayName: "原账号",
      status: "authenticated",
    };
    const accounts = new Map([[storedAccount.id, storedAccount]]);
    const updates: number[] = [];
    const application = new AccountApplication({
      accountStore: memoryAccountStore(accounts),
      browserSessions: {
        openForLogin: async () => openedSession(),
        openForAutomation: async () => openedSession(),
        closeAutomation: async () => undefined,
        removeProfile: async () => undefined,
      },
      removeAccountResources: async () => undefined,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
      sessionDetector: async () => ({
        status: "authenticated",
        identityScheme: "douyin.short_id",
        externalAccountId: "douyin-2",
        nickname: "切换后的账号",
        avatarUrl: null,
        accountInfo: [],
        source: "api",
      }),
      onAccountsChanged: () => updates.push(1),
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
      lifecycle: "active",
      identityScheme: "douyin.short_id",
      externalAccountId: "douyin-1",
      nickname: "原账号",
      displayName: "原账号",
      status: "unknown",
    };
    const accounts = new Map([[storedAccount.id, storedAccount]]);
    const application = new AccountApplication({
      accountStore: memoryAccountStore(accounts),
      browserSessions: {
        openForLogin: async () => openedSession(),
        openForAutomation: async () => openedSession(),
        closeAutomation: async () => undefined,
        removeProfile: async () => undefined,
      },
      removeAccountResources: async () => undefined,
      now: () => new Date("2026-08-11T00:00:00.000Z"),
      sessionDetector: async () => ({
        status: "authenticated",
        identityScheme: "douyin.short_id",
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

  it("keeps the existing account id and adopts a duplicate candidate profile", async () => {
    const store = new PlatformAccountStore(accountPersistence());
    const survivingAccount: PlatformAccountSummary = {
      ...account,
      id: "surviving-account",
      profileId: "old-profile",
      lifecycle: "active",
      identityScheme: "douyin.short_id",
      externalAccountId: "douyin-42",
      nickname: "旧账号",
      displayName: "旧账号",
      status: "authenticated",
    };
    store.put(survivingAccount);
    const closeAutomation = vi.fn(async () => undefined);
    const removeProfile = vi.fn(async () => undefined);
    const updates: number[] = [];
    let now = new Date("2026-08-26T00:00:00.000Z");
    const application = new AccountApplication({
      accountStore: store,
      browserSessions: {
        openForLogin: async (stored) => openedSession(stored.profileId),
        openForAutomation: async (stored) => openedSession(stored.profileId),
        closeAutomation,
        removeProfile,
      },
      removeAccountResources: async () => undefined,
      createId: () => "candidate-account",
      now: () => now,
      sessionDetector: async () => ({
        status: "authenticated",
        identityScheme: "douyin.short_id",
        externalAccountId: "douyin-42",
        nickname: "最新账号",
        avatarUrl: null,
        accountInfo: [{ key: "follower_count", value: 42 }],
        source: "api",
      }),
      onAccountsChanged: () => updates.push(1),
    });
    const candidate = application.createAccount({ platformId: "douyin" });

    await expect(
      application.refreshAccount({ accountId: candidate.id }),
    ).resolves.toMatchObject({
      status: "authenticated",
      externalAccountId: "douyin-42",
    });

    expect(application.listAccounts()).toEqual([
      expect.objectContaining({
        id: survivingAccount.id,
        profileId: candidate.profileId,
        displayName: "最新账号",
      }),
    ]);
    expect(
      application.resolveAccount({ accountId: candidate.id }),
    ).toMatchObject({
      account: { id: survivingAccount.id, profileId: candidate.profileId },
      replacementAlias: {
        candidateAccountId: candidate.id,
        survivingAccountId: survivingAccount.id,
      },
    });
    expect(
      closeAutomation.mock.calls.map(([stored]) => stored.profileId),
    ).toEqual([survivingAccount.profileId, candidate.profileId]);
    expect(store.listRetiredProfiles()).toEqual([
      expect.objectContaining({ profileId: survivingAccount.profileId }),
    ]);
    expect(updates).toHaveLength(2);

    now = new Date("2026-08-27T00:00:00.001Z");
    await application.cleanupRetiredProfiles();
    expect(removeProfile).toHaveBeenCalledWith(survivingAccount.profileId);
    expect(store.listRetiredProfiles()).toEqual([]);
  });

  it("does not replace the profile while the existing account is publishing", async () => {
    const store = new PlatformAccountStore(accountPersistence());
    store.put({
      ...account,
      id: "surviving-account",
      profileId: "old-profile",
      lifecycle: "active",
      identityScheme: "douyin.short_id",
      externalAccountId: "douyin-42",
      status: "authenticated",
    });
    const closeAutomation = vi.fn(async () => undefined);
    const application = new AccountApplication({
      accountStore: store,
      browserSessions: {
        openForLogin: async (stored) => openedSession(stored.profileId),
        openForAutomation: async (stored) => openedSession(stored.profileId),
        closeAutomation,
        removeProfile: async () => undefined,
      },
      removeAccountResources: async () => undefined,
      isAccountBusy: () => true,
      createId: () => "candidate-account",
      sessionDetector: async () => ({
        status: "authenticated",
        identityScheme: "douyin.short_id",
        externalAccountId: "douyin-42",
        nickname: "最新账号",
        avatarUrl: null,
        accountInfo: [],
        source: "api",
      }),
    });
    const candidate = application.createAccount({ platformId: "douyin" });

    await expect(
      application.refreshAccount({ accountId: candidate.id }),
    ).resolves.toEqual({
      status: "unknown",
      reason: "已有账号正在执行发布，将在任务结束后继续更新登录环境",
    });
    expect(application.listAccounts()).toHaveLength(2);
    expect(closeAutomation).not.toHaveBeenCalled();
  });
});

function accountPersistence() {
  const values = new Map<string, unknown>();
  return {
    get: (key: "state" | "accounts") => values.get(key),
    set: (key: "state", value: unknown) => void values.set(key, value),
  };
}

function memoryAccountStore(accounts: Map<string, PlatformAccountSummary>) {
  const requireAccount = (accountId: string) => {
    const stored = accounts.get(accountId);
    if (!stored) throw new TypeError("Platform account does not exist");
    return stored;
  };
  return {
    list: () => [...accounts.values()],
    get: (accountId: string) => accounts.get(accountId),
    require: requireAccount,
    resolve: (accountId: string) => ({ account: requireAccount(accountId) }),
    findActiveByIdentity: (identity: {
      platformId: string;
      identityScheme: string;
      externalAccountId: string;
    }) =>
      [...accounts.values()].filter(
        (candidate) =>
          candidate.lifecycle === "active" &&
          candidate.platformId === identity.platformId &&
          candidate.identityScheme === identity.identityScheme &&
          candidate.externalAccountId === identity.externalAccountId,
      ),
    put: (stored: PlatformAccountSummary) =>
      void accounts.set(stored.id, stored),
    replaceCandidateProfile: () => {
      throw new Error("not used");
    },
    listRetiredProfiles: () => [],
    discardRetiredProfile: () => undefined,
    pruneExpiredAliases: () => undefined,
    hasProfileReference: () => false,
  };
}

function openedSession(profileId = account.profileId) {
  return {
    id: "session-1",
    profileId,
    page: { isClosed: () => false },
    driver: {},
    sessionProbeClient: {},
  } as never;
}
