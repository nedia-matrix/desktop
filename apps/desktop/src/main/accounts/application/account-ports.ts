import type { OpenedPersistentBrowserSession } from "@nedia-matrix/automation-playwright";
import type { PlatformAccountSummary } from "@nedia-matrix/ipc-contracts";
import type {
  PlatformLoginEntry,
  PlatformModule,
} from "@nedia-matrix/platform-core";

import type {
  CanonicalAccountIdentity,
  ReplaceCandidateProfileCommand,
  ReplaceCandidateProfileResult,
  ResolvedPlatformAccount,
  RetiredBrowserProfile,
} from "./account-types.js";

export interface AccountRepository {
  list(): PlatformAccountSummary[];
  get(accountId: string): PlatformAccountSummary | undefined;
  require(accountId: string): PlatformAccountSummary;
  resolve(accountId: string, now?: Date): ResolvedPlatformAccount;
  findActiveByIdentity(
    identity: CanonicalAccountIdentity,
  ): PlatformAccountSummary[];
  put(account: PlatformAccountSummary): void;
  replaceCandidateProfile(
    command: ReplaceCandidateProfileCommand,
  ): ReplaceCandidateProfileResult;
  listRetiredProfiles(): RetiredBrowserProfile[];
  discardRetiredProfile(profileId: string): void;
  pruneExpiredAliases(now?: Date): void;
  hasProfileReference(profileId: string): boolean;
  remove(accountId: string): void;
}

export interface BrowserSessionPort {
  openForLogin(
    account: PlatformAccountSummary,
    platform: PlatformModule,
    loginEntry: PlatformLoginEntry,
  ): Promise<OpenedPersistentBrowserSession>;
  openForAutomation(
    account: PlatformAccountSummary,
    platform: PlatformModule,
  ): Promise<OpenedPersistentBrowserSession>;
  openForVerification?(
    account: PlatformAccountSummary,
    platform: PlatformModule,
  ): Promise<
    Pick<OpenedPersistentBrowserSession, "driver" | "sessionProbeClient"> & {
      close(): Promise<void>;
    }
  >;
  closeAutomation(account: PlatformAccountSummary): Promise<void>;
  removeProfile(profileId: string): Promise<void>;
}
