import type { PlatformAccountSummary } from "@nedia-matrix/ipc-contracts";
import Store from "electron-store";

import {
  AccountIdentityConflictError,
  type AccountReplacementAlias,
  type CanonicalAccountIdentity,
  type ReplaceCandidateProfileCommand,
  type ReplaceCandidateProfileResult,
  type ResolvedPlatformAccount,
  type RetiredBrowserProfile,
} from "../application/account-types.js";
import {
  parseAccountState,
  parseStoredAccounts,
  type AccountStoreState,
} from "./account-state-codec.js";

export {
  AccountIdentityConflictError,
  type AccountReplacementAlias,
  type CanonicalAccountIdentity,
  type ReplaceCandidateProfileCommand,
  type ReplaceCandidateProfileResult,
  type ResolvedPlatformAccount,
  type RetiredBrowserProfile,
} from "../application/account-types.js";
export { parseStoredAccounts } from "./account-state-codec.js";

type AccountStoreSchema = {
  state?: unknown;
  accounts?: unknown;
};

interface AccountStorePersistence {
  get(key: "state" | "accounts"): unknown;
  set(key: "state", value: AccountStoreState): void;
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

export class ElectronAccountRepository {
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
