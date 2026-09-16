import type {
  AutomationDriver,
  PlatformSessionDetection,
  SessionDetectionPlan,
  SessionProbeClient,
} from "@nedia-matrix/automation-engine";
import type {
  CanonicalAccountIdentity,
  PlatformAccountSnapshot,
  RetiredBrowserProfile,
} from "../domain/index.js";
import type {
  PlatformDataClient,
  PlatformLoginEntry,
  PlatformModule,
} from "@nedia-matrix/platform-sdk";

import type {
  ReplaceCandidateProfileCommand,
  ReplaceCandidateProfileResult,
  ResolvedPlatformAccount,
} from "./account-types.js";

export interface PlatformCatalog {
  get(id: string): PlatformModule | undefined;
  require(id: string): PlatformModule;
  list(): readonly PlatformModule[];
}

export interface AccountRepository {
  list(): PlatformAccountSnapshot[];
  get(accountId: string): PlatformAccountSnapshot | undefined;
  require(accountId: string): PlatformAccountSnapshot;
  resolve(accountId: string, now?: Date): ResolvedPlatformAccount;
  findActiveByIdentity(
    identity: CanonicalAccountIdentity,
  ): PlatformAccountSnapshot[];
  put(account: PlatformAccountSnapshot): void;
  replaceCandidateProfile(
    command: ReplaceCandidateProfileCommand,
  ): ReplaceCandidateProfileResult;
  listRetiredProfiles(): RetiredBrowserProfile[];
  discardRetiredProfile(profileId: string): void;
  pruneExpiredAliases(now?: Date): void;
  hasProfileReference(profileId: string): boolean;
  remove(accountId: string): void;
}

export interface AccountBrowserPage {
  readonly id: string;
  readonly profileId: string;
  readonly driver: AutomationDriver;
  readonly sessionProbeClient: SessionProbeClient & {
    subscribeObservedResponses(listener: () => void): () => void;
  };
  readonly page: {
    isClosed(): boolean;
    on?(event: "close", listener: () => void): void;
    off?(event: "close", listener: () => void): void;
    once?(event: "close", listener: () => void): void;
  };
}

export interface SessionDetectionPort {
  detect(
    plan: SessionDetectionPlan,
    driver: AutomationDriver,
    probeClient: SessionProbeClient,
  ): Promise<PlatformSessionDetection>;
}

export interface BrowserSessionPort {
  openForLogin(
    account: PlatformAccountSnapshot,
    platform: PlatformModule,
    loginEntry: PlatformLoginEntry,
  ): Promise<AccountBrowserPage>;
  openUserPage(
    account: PlatformAccountSnapshot,
    platform: PlatformModule,
  ): Promise<AccountBrowserPage>;
  openForVerification(
    account: PlatformAccountSnapshot,
    platform: PlatformModule,
  ): Promise<
    Pick<AccountBrowserPage, "driver" | "sessionProbeClient"> & {
      readonly dataClient: PlatformDataClient;
      close(): Promise<void>;
    }
  >;
  closeAutomation(account: PlatformAccountSnapshot): Promise<void>;
  removeProfile(profileId: string): Promise<void>;
}
