import { describe, expect, it } from "vitest";

import { parseStoredAccounts } from "../src/main/accounts/account-store.js";

const account = {
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
    const { profileId: _profileId, ...legacyAccount } = account;
    expect(
      parseStoredAccounts([
        { ...legacyAccount, partition: "persist:matrix-douyin-account-1" },
      ]),
    ).toEqual([account]);
  });

  it("migrates legacy fixed profile statistics into account info", () => {
    const { accountInfo: _accountInfo, ...legacyAccount } = account;
    expect(
      parseStoredAccounts([{ ...legacyAccount, followerCount: 12800 }]),
    ).toEqual([
      {
        ...account,
        accountInfo: [{ key: "follower_count", value: 12800 }],
      },
    ]);
  });
});
