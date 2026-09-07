import type {
  PlatformAccountInfoItem,
  PlatformAccountSummary,
} from "@nedia-matrix/ipc-contracts";

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
