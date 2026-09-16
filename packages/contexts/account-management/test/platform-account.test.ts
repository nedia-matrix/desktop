import { describe, expect, it } from "vitest";

import {
  InvalidPlatformAccountSnapshotError,
  PlatformAccount,
} from "../src/index.js";

const occurredAt = "2026-09-12T00:00:00.000Z";

function pending(id = "account-1") {
  return PlatformAccount.createPending({
    id,
    platformId: "douyin",
    profileId: `matrix-douyin-${id}`,
    platformDisplayName: "抖音",
    occurredAt,
  });
}

describe("PlatformAccount", () => {
  it("keeps existing account info when recording identity", () => {
    const account = PlatformAccount.rehydrate({
      ...pending().toSnapshot(),
      accountInfo: [{ key: "follower_count", value: 10 }],
    });
    account.recordDetection(
      {
        status: "authenticated",
        identityScheme: "douyin.short_id",
        externalAccountId: "external-1",
        nickname: "账号一",
        avatarUrl: null,
      },
      occurredAt,
    );

    const snapshot = account.toSnapshot();
    (
      snapshot.accountInfo as Array<{ key: string; value: string | number }>
    ).push({ key: "desc", value: "外部修改" });

    expect(account.toSnapshot()).toMatchObject({
      lifecycle: "active",
      status: "authenticated",
      externalAccountId: "external-1",
      accountInfo: [{ key: "follower_count", value: 10 }],
    });
  });

  it("rejects implicit identity changes and allows explicit refresh", () => {
    const account = pending();
    account.recordDetection(
      {
        status: "authenticated",
        identityScheme: "douyin.short_id",
        externalAccountId: "external-1",
        nickname: "账号一",
      },
      occurredAt,
    );

    const switched = {
      status: "authenticated" as const,
      identityScheme: "douyin.short_id",
      externalAccountId: "external-2",
      nickname: "账号二",
    };
    expect(() => account.recordDetection(switched, occurredAt)).toThrow(
      "Established platform account identity cannot change implicitly",
    );
    account.refreshIdentity(switched, occurredAt);
    expect(account.toSnapshot().externalAccountId).toBe("external-2");
  });

  it("updates optional profile fields independently from session identity", () => {
    const account = pending();
    account.recordDetection(
      {
        status: "authenticated",
        identityScheme: "douyin.short_id",
        externalAccountId: "external-1",
        nickname: "账号一",
      },
      occurredAt,
    );
    const syncedAt = "2026-09-12T01:00:00.000Z";
    account.updateProfile(
      [
        { key: "follower_count", value: 12 },
        { key: "desc", value: "简介" },
      ],
      syncedAt,
    );
    account.updateProfile(
      [{ key: "follower_count", value: 15 }],
      "2026-09-12T02:00:00.000Z",
    );

    expect(account.toSnapshot()).toMatchObject({
      externalAccountId: "external-1",
      accountInfo: [
        { key: "follower_count", value: 15 },
        { key: "desc", value: "简介" },
      ],
      profileSyncedAt: "2026-09-12T02:00:00.000Z",
    });
  });

  it("updates content count without changing the profile sync time", () => {
    const account = pending("account-1");
    account.recordDetection(
      {
        status: "authenticated",
        identityScheme: "douyin.short_id",
        externalAccountId: "external-1",
        nickname: "账号一",
      },
      occurredAt,
    );
    account.updateProfile(
      [{ key: "follower_count", value: 12 }],
      "2026-09-12T01:00:00.000Z",
    );

    account.updateContentCount(19, "2026-09-12T02:00:00.000Z");

    expect(account.toSnapshot()).toMatchObject({
      accountInfo: [
        { key: "follower_count", value: 12 },
        { key: "content_count", value: 19 },
      ],
      profileSyncedAt: "2026-09-12T01:00:00.000Z",
      updatedAt: "2026-09-12T02:00:00.000Z",
    });
  });

  it("produces the replacement facts while changing only the surviving aggregate", () => {
    const surviving = pending("surviving");
    surviving.recordDetection(
      {
        status: "authenticated",
        identityScheme: "douyin.short_id",
        externalAccountId: "external-1",
        nickname: "原账号",
      },
      occurredAt,
    );
    const candidate = pending("candidate");

    const result = surviving.adoptCandidateProfile(candidate, {
      identity: {
        platformId: "douyin",
        identityScheme: "douyin.short_id",
        externalAccountId: "external-1",
      },
      nickname: "候选账号",
      avatarUrl: null,
      replacedAt: occurredAt,
      aliasExpiresAt: "2026-09-13T00:00:00.000Z",
      removeRetiredProfileAfter: "2026-09-14T00:00:00.000Z",
    });

    expect(result.survivingAccount.profileId).toBe(candidate.profileId);
    expect(result.replacementAlias.candidateAccountId).toBe(candidate.id);
    expect(result.retiredProfile.profileId).toBe("matrix-douyin-surviving");
    expect(candidate.toSnapshot().lifecycle).toBe("pending_identity");
  });

  it.each(["recordDetection", "refreshIdentity"] as const)(
    "%s leaves the account unchanged when the candidate timestamp is invalid",
    (method) => {
      const account = pending();
      const before = account.toSnapshot();

      expect(() =>
        account[method](
          {
            status: "authenticated",
            identityScheme: "douyin.short_id",
            externalAccountId: "external-1",
            nickname: "账号一",
          },
          "2026-09-11T00:00:00.000Z",
        ),
      ).toThrow(InvalidPlatformAccountSnapshotError);
      expect(account.toSnapshot()).toEqual(before);
    },
  );

  it("leaves both accounts unchanged when profile adoption fails validation", () => {
    const surviving = pending("surviving");
    surviving.recordDetection(
      {
        status: "authenticated",
        identityScheme: "douyin.short_id",
        externalAccountId: "external-1",
        nickname: "原账号",
      },
      occurredAt,
    );
    const candidate = pending("candidate");
    const before = surviving.toSnapshot();
    const candidateBefore = candidate.toSnapshot();

    expect(() =>
      surviving.adoptCandidateProfile(candidate, {
        identity: {
          platformId: "douyin",
          identityScheme: "douyin.short_id",
          externalAccountId: "external-1",
        },
        nickname: "候选账号",
        avatarUrl: null,
        replacedAt: "2026-09-11T00:00:00.000Z",
        aliasExpiresAt: "2026-09-13T00:00:00.000Z",
        removeRetiredProfileAfter: "2026-09-14T00:00:00.000Z",
      }),
    ).toThrow(InvalidPlatformAccountSnapshotError);
    expect(surviving.toSnapshot()).toEqual(before);
    expect(candidate.toSnapshot()).toEqual(candidateBefore);
  });

  it("rejects invalid pending snapshots", () => {
    expect(() =>
      PlatformAccount.rehydrate({
        ...pending().toSnapshot(),
        status: "authenticated",
      }),
    ).toThrow(InvalidPlatformAccountSnapshotError);
  });
});
