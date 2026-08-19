import {
  platformAccountInfoKeys,
  type PlatformAccountInfoItem,
  type PlatformAccountStatus,
  type PlatformAccountSummary,
} from "@nedia-matrix/ipc-contracts";
import Store from "electron-store";

type AccountStoreSchema = {
  accounts?: unknown;
};

const accountStatuses: readonly PlatformAccountStatus[] = [
  "authenticated",
  "login_required",
  "unknown",
];

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOptionalNullableCount(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function parseAccountInfo(value: unknown): PlatformAccountInfoItem[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const keys = new Set<string>();
  const items: PlatformAccountInfoItem[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      return null;
    }
    const { key, value: itemValue } = candidate as Record<string, unknown>;
    if (
      typeof key !== "string" ||
      !platformAccountInfoKeys.some((allowed) => allowed === key) ||
      keys.has(key) ||
      !(
        (typeof itemValue === "string" && itemValue.trim()) ||
        (typeof itemValue === "number" &&
          Number.isFinite(itemValue) &&
          itemValue >= 0)
      )
    ) {
      return null;
    }
    keys.add(key);
    items.push({
      key: key as PlatformAccountInfoItem["key"],
      value: itemValue as string | number,
    });
  }
  return items;
}

function parseAccount(value: unknown): PlatformAccountSummary | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const account = value as Partial<PlatformAccountSummary>;
  const legacyAccount = value as {
    followerCount?: unknown;
    contentCount?: unknown;
  };
  const parsedAccountInfo = parseAccountInfo(account.accountInfo);
  const legacyPartition = (value as { partition?: unknown }).partition;
  const profileId =
    typeof account.profileId === "string"
      ? account.profileId
      : typeof legacyPartition === "string"
        ? legacyPartition.replace(/^persist:/, "")
        : null;
  if (
    typeof account.id !== "string" ||
    typeof account.platformId !== "string" ||
    profileId === null ||
    typeof account.displayName !== "string" ||
    !isNullableString(account.externalAccountId) ||
    !isNullableString(account.nickname) ||
    !isNullableString(account.avatarUrl) ||
    parsedAccountInfo === null ||
    !isOptionalNullableCount(legacyAccount.followerCount) ||
    !isOptionalNullableCount(legacyAccount.contentCount) ||
    !accountStatuses.some((status) => status === account.status) ||
    !isNullableString(account.lastVerifiedAt) ||
    typeof account.createdAt !== "string" ||
    typeof account.updatedAt !== "string"
  ) {
    return null;
  }

  const {
    partition: _legacyPartition,
    followerCount: _legacyFollowerCount,
    contentCount: _legacyContentCount,
    ...currentFields
  } = value as Record<string, unknown>;
  const accountInfo =
    account.accountInfo === undefined
      ? [
          ...(typeof legacyAccount.followerCount === "number"
            ? [
                {
                  key: "follower_count" as const,
                  value: legacyAccount.followerCount,
                },
              ]
            : []),
          ...(typeof legacyAccount.contentCount === "number"
            ? [
                {
                  key: "content_count" as const,
                  value: legacyAccount.contentCount,
                },
              ]
            : []),
        ]
      : parsedAccountInfo;
  return {
    ...currentFields,
    profileId,
    accountInfo,
  } as PlatformAccountSummary;
}

export function parseStoredAccounts(value: unknown): PlatformAccountSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseAccount)
    .filter((account): account is PlatformAccountSummary => account !== null);
}

export class PlatformAccountStore {
  private readonly store = new Store<AccountStoreSchema>({
    name: "matrix-platform-accounts",
  });

  list(): PlatformAccountSummary[] {
    return parseStoredAccounts(this.store.get("accounts")).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  get(accountId: string): PlatformAccountSummary | undefined {
    return this.list().find((account) => account.id === accountId);
  }

  require(accountId: string): PlatformAccountSummary {
    const account = this.get(accountId);
    if (!account) throw new TypeError("Platform account does not exist");
    return account;
  }

  put(account: PlatformAccountSummary): void {
    const accounts = this.list();
    const index = accounts.findIndex(
      (candidate) => candidate.id === account.id,
    );
    if (index === -1) {
      accounts.push(account);
    } else {
      accounts[index] = account;
    }
    this.store.set("accounts", accounts);
  }

  remove(accountId: string): void {
    this.store.set(
      "accounts",
      this.list().filter((account) => account.id !== accountId),
    );
  }
}
