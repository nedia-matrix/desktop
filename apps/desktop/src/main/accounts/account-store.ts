import {
  platformAccountInfoKeys,
  type PlatformAccountInfoItem,
  type PlatformAccountLifecycle,
  type PlatformAccountStatus,
  type PlatformAccountSummary,
} from "@nedia-matrix/ipc-contracts";
import Store from "electron-store";

type AccountStoreSchema = {
  state?: unknown;
  accounts?: unknown;
};

interface AccountStorePersistence {
  get(key: "state" | "accounts"): unknown;
  set(key: "state", value: AccountStoreState): void;
}

export interface CanonicalAccountIdentity {
  platformId: string;
  identityScheme: string;
  externalAccountId: string;
}

export interface AccountReplacementAlias {
  candidateAccountId: string;
  survivingAccountId: string;
  createdAt: string;
  expiresAt: string;
}

export interface RetiredBrowserProfile {
  profileId: string;
  survivingAccountId: string;
  retiredAt: string;
  removeAfter: string;
  reason: "replaced_after_duplicate_login";
}

interface AccountStoreState {
  schemaVersion: 1;
  accounts: PlatformAccountSummary[];
  replacementAliases: AccountReplacementAlias[];
  retiredProfiles: RetiredBrowserProfile[];
}

export interface ResolvedPlatformAccount {
  account: PlatformAccountSummary;
  replacementAlias?: AccountReplacementAlias;
}

export interface ReplaceCandidateProfileCommand {
  candidateAccountId: string;
  survivingAccountId: string;
  identity: CanonicalAccountIdentity;
  nickname: string;
  avatarUrl: string | null;
  accountInfo: readonly PlatformAccountInfoItem[];
  replacedAt: string;
  aliasExpiresAt: string;
  removeRetiredProfileAfter: string;
}

export interface ReplaceCandidateProfileResult {
  survivingAccount: PlatformAccountSummary;
  replacementAlias: AccountReplacementAlias;
  retiredProfile: RetiredBrowserProfile;
}

export class AccountIdentityConflictError extends Error {
  constructor(readonly existingAccountId: string) {
    super("Platform account identity already exists");
  }
}

const accountStatuses: readonly PlatformAccountStatus[] = [
  "authenticated",
  "login_required",
  "unknown",
];
const accountLifecycles: readonly PlatformAccountLifecycle[] = [
  "pending_identity",
  "active",
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
  const lifecycle = accountLifecycles.some(
    (candidate) => candidate === account.lifecycle,
  )
    ? account.lifecycle
    : account.externalAccountId === null
      ? "pending_identity"
      : "active";
  const identityScheme =
    account.identityScheme === undefined ? null : account.identityScheme;
  if (
    typeof account.id !== "string" ||
    typeof account.platformId !== "string" ||
    profileId === null ||
    typeof account.displayName !== "string" ||
    !isNullableString(identityScheme) ||
    !isNullableString(account.externalAccountId) ||
    !isNullableString(account.nickname) ||
    !isNullableString(account.avatarUrl) ||
    parsedAccountInfo === null ||
    !isOptionalNullableCount(legacyAccount.followerCount) ||
    !isOptionalNullableCount(legacyAccount.contentCount) ||
    !accountStatuses.some((status) => status === account.status) ||
    !isNullableString(account.lastVerifiedAt) ||
    typeof account.createdAt !== "string" ||
    typeof account.updatedAt !== "string" ||
    (lifecycle === "active" && account.externalAccountId === null)
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
    lifecycle,
    identityScheme,
    accountInfo,
  } as PlatformAccountSummary;
}

export function parseStoredAccounts(value: unknown): PlatformAccountSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseAccount)
    .filter((account): account is PlatformAccountSummary => account !== null);
}

function parseReplacementAlias(value: unknown): AccountReplacementAlias | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<AccountReplacementAlias>;
  if (
    typeof candidate.candidateAccountId !== "string" ||
    typeof candidate.survivingAccountId !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.expiresAt !== "string"
  ) {
    return null;
  }
  return candidate as AccountReplacementAlias;
}

function parseRetiredProfile(value: unknown): RetiredBrowserProfile | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<RetiredBrowserProfile>;
  if (
    typeof candidate.profileId !== "string" ||
    typeof candidate.survivingAccountId !== "string" ||
    typeof candidate.retiredAt !== "string" ||
    typeof candidate.removeAfter !== "string" ||
    candidate.reason !== "replaced_after_duplicate_login"
  ) {
    return null;
  }
  return candidate as RetiredBrowserProfile;
}

function parseAccountState(value: unknown): AccountStoreState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.accounts)) {
    return null;
  }
  return {
    schemaVersion: 1,
    accounts: parseStoredAccounts(candidate.accounts),
    replacementAliases: Array.isArray(candidate.replacementAliases)
      ? candidate.replacementAliases
          .map(parseReplacementAlias)
          .filter((alias): alias is AccountReplacementAlias => alias !== null)
      : [],
    retiredProfiles: Array.isArray(candidate.retiredProfiles)
      ? candidate.retiredProfiles
          .map(parseRetiredProfile)
          .filter(
            (profile): profile is RetiredBrowserProfile => profile !== null,
          )
      : [],
  };
}

function sameIdentity(
  account: PlatformAccountSummary,
  identity: CanonicalAccountIdentity,
): boolean {
  return (
    account.lifecycle === "active" &&
    account.platformId === identity.platformId &&
    account.externalAccountId === identity.externalAccountId &&
    (account.identityScheme === null ||
      account.identityScheme === identity.identityScheme)
  );
}

function accountsShareIdentity(
  left: PlatformAccountSummary,
  right: PlatformAccountSummary,
): boolean {
  return (
    left.lifecycle === "active" &&
    right.lifecycle === "active" &&
    left.platformId === right.platformId &&
    left.externalAccountId !== null &&
    left.externalAccountId === right.externalAccountId &&
    (left.identityScheme === null ||
      right.identityScheme === null ||
      left.identityScheme === right.identityScheme)
  );
}

function emptyState(accounts: PlatformAccountSummary[]): AccountStoreState {
  return {
    schemaVersion: 1,
    accounts,
    replacementAliases: [],
    retiredProfiles: [],
  };
}

export class PlatformAccountStore {
  private readonly persistence: AccountStorePersistence;

  constructor(persistence?: AccountStorePersistence) {
    this.persistence =
      persistence ??
      (new Store<AccountStoreSchema>({
        name: "matrix-platform-accounts",
      }) as unknown as AccountStorePersistence);
  }

  list(): PlatformAccountSummary[] {
    return this.readState().accounts.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  get(accountId: string): PlatformAccountSummary | undefined {
    return this.readState().accounts.find(
      (account) => account.id === accountId,
    );
  }

  require(accountId: string): PlatformAccountSummary {
    const account = this.get(accountId);
    if (!account) throw new TypeError("Platform account does not exist");
    return account;
  }

  resolve(accountId: string, now = new Date()): ResolvedPlatformAccount {
    const state = this.readState();
    const direct = state.accounts.find((account) => account.id === accountId);
    if (direct) return { account: direct };

    const replacementAlias = state.replacementAliases.find(
      (alias) =>
        alias.candidateAccountId === accountId &&
        alias.expiresAt > now.toISOString(),
    );
    const account = replacementAlias
      ? state.accounts.find(
          (candidate) => candidate.id === replacementAlias.survivingAccountId,
        )
      : undefined;
    if (!account || !replacementAlias) {
      throw new TypeError("Platform account does not exist");
    }
    return { account, replacementAlias };
  }

  findActiveByIdentity(
    identity: CanonicalAccountIdentity,
  ): PlatformAccountSummary[] {
    return this.readState().accounts.filter((account) =>
      sameIdentity(account, identity),
    );
  }

  put(account: PlatformAccountSummary): void {
    const state = this.readState();
    if (account.lifecycle === "active" && account.externalAccountId) {
      const conflict = state.accounts.find(
        (candidate) =>
          candidate.id !== account.id &&
          accountsShareIdentity(candidate, account),
      );
      if (conflict) throw new AccountIdentityConflictError(conflict.id);
    }
    const index = state.accounts.findIndex(
      (candidate) => candidate.id === account.id,
    );
    if (index === -1) {
      state.accounts.push(account);
    } else {
      state.accounts[index] = account;
    }
    this.writeState(state);
  }

  replaceCandidateProfile(
    command: ReplaceCandidateProfileCommand,
  ): ReplaceCandidateProfileResult {
    const state = this.readState();
    const candidate = state.accounts.find(
      (account) => account.id === command.candidateAccountId,
    );
    const survivingAccount = state.accounts.find(
      (account) => account.id === command.survivingAccountId,
    );
    if (!candidate || candidate.lifecycle !== "pending_identity") {
      throw new TypeError("Candidate account is no longer pending identity");
    }
    if (
      !survivingAccount ||
      !sameIdentity(survivingAccount, command.identity)
    ) {
      throw new TypeError("Surviving account identity changed");
    }
    if (candidate.profileId === survivingAccount.profileId) {
      throw new TypeError("Candidate and surviving account share a profile");
    }

    const replacementAlias: AccountReplacementAlias = {
      candidateAccountId: candidate.id,
      survivingAccountId: survivingAccount.id,
      createdAt: command.replacedAt,
      expiresAt: command.aliasExpiresAt,
    };
    const retiredProfile: RetiredBrowserProfile = {
      profileId: survivingAccount.profileId,
      survivingAccountId: survivingAccount.id,
      retiredAt: command.replacedAt,
      removeAfter: command.removeRetiredProfileAfter,
      reason: "replaced_after_duplicate_login",
    };
    const updatedSurvivingAccount: PlatformAccountSummary = {
      ...survivingAccount,
      profileId: candidate.profileId,
      lifecycle: "active",
      identityScheme: command.identity.identityScheme,
      externalAccountId: command.identity.externalAccountId,
      displayName: command.nickname,
      nickname: command.nickname,
      avatarUrl: command.avatarUrl,
      accountInfo: [...command.accountInfo],
      status: "authenticated",
      lastVerifiedAt: command.replacedAt,
      updatedAt: command.replacedAt,
    };

    state.accounts = state.accounts.flatMap((account) => {
      if (account.id === candidate.id) return [];
      return account.id === survivingAccount.id
        ? [updatedSurvivingAccount]
        : [account];
    });
    state.replacementAliases = [
      ...state.replacementAliases.filter(
        (alias) => alias.candidateAccountId !== candidate.id,
      ),
      replacementAlias,
    ];
    state.retiredProfiles = [
      ...state.retiredProfiles.filter(
        (profile) => profile.profileId !== retiredProfile.profileId,
      ),
      retiredProfile,
    ];
    this.writeState(state);
    return {
      survivingAccount: updatedSurvivingAccount,
      replacementAlias,
      retiredProfile,
    };
  }

  listRetiredProfiles(): RetiredBrowserProfile[] {
    return [...this.readState().retiredProfiles];
  }

  discardRetiredProfile(profileId: string): void {
    const state = this.readState();
    state.retiredProfiles = state.retiredProfiles.filter(
      (profile) => profile.profileId !== profileId,
    );
    this.writeState(state);
  }

  pruneExpiredAliases(now = new Date()): void {
    const state = this.readState();
    const current = now.toISOString();
    const activeAliases = state.replacementAliases.filter(
      (alias) => alias.expiresAt > current,
    );
    if (activeAliases.length === state.replacementAliases.length) return;
    state.replacementAliases = activeAliases;
    this.writeState(state);
  }

  hasProfileReference(profileId: string): boolean {
    return this.readState().accounts.some(
      (account) => account.profileId === profileId,
    );
  }

  remove(accountId: string): void {
    const state = this.readState();
    state.accounts = state.accounts.filter(
      (account) => account.id !== accountId,
    );
    state.replacementAliases = state.replacementAliases.filter(
      (alias) =>
        alias.candidateAccountId !== accountId &&
        alias.survivingAccountId !== accountId,
    );
    this.writeState(state);
  }

  private readState(): AccountStoreState {
    const current = parseAccountState(this.persistence.get("state"));
    if (current) return current;
    return emptyState(parseStoredAccounts(this.persistence.get("accounts")));
  }

  private writeState(state: AccountStoreState): void {
    this.persistence.set("state", state);
  }
}
