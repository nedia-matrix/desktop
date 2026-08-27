import { describe, expect, it } from "vitest";

import {
  AccountIdentityConflictError,
  parseStoredAccounts,
  PlatformAccountStore,
} from "../src/main/accounts/account-store.js";

const account = {
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
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
} as const;

describe("platform account persistence", () => {
  it("accepts complete account records", () => {
    expect(parseStoredAccounts([account])).toEqual([account]);
  });

  it("ignores malformed records without hiding valid accounts", () => {
    expect(
      parseStoredAccounts([
        account,
        { ...account, id: null },
        { ...account, status: "connected" },
        { ...account, followerCount: -1 },
      ]),
    ).toEqual([account]);
  });

  it("migrates legacy Electron partitions to browser profile identifiers", () => {
    const {
      profileId: _profileId,
      lifecycle: _lifecycle,
      identityScheme: _identityScheme,
      ...legacyAccount
    } = account;
    expect(
      parseStoredAccounts([
        { ...legacyAccount, partition: "persist:matrix-douyin-account-1" },
      ]),
    ).toEqual([account]);
  });

  it("migrates legacy fixed profile statistics into account info", () => {
    const {
      accountInfo: _accountInfo,
      lifecycle: _lifecycle,
      identityScheme: _identityScheme,
      ...legacyAccount
    } = account;
    expect(
      parseStoredAccounts([{ ...legacyAccount, followerCount: 12800 }]),
    ).toEqual([
      {
        ...account,
        accountInfo: [{ key: "follower_count", value: 12800 }],
      },
    ]);
  });

  it("atomically keeps the existing account while adopting the candidate profile", () => {
    const persistence = memoryPersistence();
    const store = new PlatformAccountStore(persistence);
    const survivingAccount = {
      ...account,
      id: "surviving-account",
      profileId: "old-profile",
      lifecycle: "active" as const,
      identityScheme: "douyin.short_id",
      externalAccountId: "douyin-42",
      nickname: "旧昵称",
      status: "authenticated" as const,
    };
    const candidateAccount = {
      ...account,
      id: "candidate-account",
      profileId: "new-profile",
    };
    store.put(survivingAccount);
    store.put(candidateAccount);

    const result = store.replaceCandidateProfile({
      candidateAccountId: candidateAccount.id,
      survivingAccountId: survivingAccount.id,
      identity: {
        platformId: "douyin",
        identityScheme: "douyin.short_id",
        externalAccountId: "douyin-42",
      },
      nickname: "最新昵称",
      avatarUrl: null,
      accountInfo: [{ key: "follower_count", value: 42 }],
      replacedAt: "2026-08-26T00:00:00.000Z",
      aliasExpiresAt: "2026-08-27T00:00:00.000Z",
      removeRetiredProfileAfter: "2026-08-27T00:00:00.000Z",
    });

    expect(store.list()).toEqual([
      expect.objectContaining({
        id: survivingAccount.id,
        profileId: candidateAccount.profileId,
        displayName: "最新昵称",
        externalAccountId: "douyin-42",
      }),
    ]);
    expect(
      store.resolve(candidateAccount.id, new Date("2026-08-26T12:00:00.000Z")),
    ).toEqual({
      account: result.survivingAccount,
      replacementAlias: result.replacementAlias,
    });
    expect(store.listRetiredProfiles()).toEqual([
      expect.objectContaining({ profileId: "old-profile" }),
    ]);

    const persistedState = persistence.values.get("state") as {
      accounts: unknown[];
      replacementAliases: unknown[];
      retiredProfiles: unknown[];
    };
    expect(persistedState.accounts).toHaveLength(1);
    expect(persistedState.replacementAliases).toHaveLength(1);
    expect(persistedState.retiredProfiles).toHaveLength(1);
  });

  it("rejects a second active record with the same canonical identity", () => {
    const store = new PlatformAccountStore(memoryPersistence());
    store.put({
      ...account,
      id: "first",
      lifecycle: "active",
      identityScheme: "douyin.short_id",
      externalAccountId: "douyin-42",
      status: "authenticated",
    });

    expect(() =>
      store.put({
        ...account,
        id: "second",
        lifecycle: "active",
        identityScheme: "douyin.short_id",
        externalAccountId: "douyin-42",
        status: "authenticated",
      }),
    ).toThrow(AccountIdentityConflictError);
  });
});

function memoryPersistence() {
  const values = new Map<string, unknown>();
  return {
    values,
    get: (key: "state" | "accounts") => values.get(key),
    set: (key: "state", value: unknown) => void values.set(key, value),
  };
}
