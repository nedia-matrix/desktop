import { randomUUID } from "node:crypto";

import { detectPlatformSession } from "@nedia-matrix/automation-engine";
import { createBrowserProfileId } from "@nedia-matrix/automation-playwright";
import type {
  CreatePlatformAccountRequest,
  OpenPlatformLoginRequest,
  PlatformAccountRequest,
  PlatformAccountSummary,
} from "@nedia-matrix/ipc-contracts";

import { platformFor, platformSummaries } from "../registered-platforms.js";
import type {
  CanonicalAccountIdentity,
  PlatformAccountStore,
  ResolvedPlatformAccount,
  RetiredBrowserProfile,
} from "./account-store.js";
import {
  assertAccountRequest,
  assertLoginRequest,
  assertPlatformRequest,
} from "./account-request-validation.js";
import type { BrowserProfileHost } from "./browser-session-host.js";

const automaticRecognitionIntervalMs = 3_000;
const automaticRecognitionMaxAttempts = 100;
const replacementAliasLifetimeMs = 24 * 60 * 60 * 1_000;
const retiredProfileLifetimeMs = 24 * 60 * 60 * 1_000;

type OpenedAccountSession = Awaited<
  ReturnType<BrowserProfileHost["openForAutomation"]>
>;
type SessionDetection = Awaited<ReturnType<typeof detectPlatformSession>>;
type AuthenticatedDetection = Extract<
  SessionDetection,
  { status: "authenticated" }
>;

function waitForRecognition(intervalMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    timer.unref();
  });
}

function addMilliseconds(value: Date, milliseconds: number): string {
  return new Date(value.getTime() + milliseconds).toISOString();
}

function identityOf(
  platformId: string,
  detected: AuthenticatedDetection,
): CanonicalAccountIdentity {
  return {
    platformId,
    identityScheme: detected.identityScheme,
    externalAccountId: detected.externalAccountId,
  };
}

type AccountStorePort = Pick<
  PlatformAccountStore,
  | "discardRetiredProfile"
  | "findActiveByIdentity"
  | "get"
  | "hasProfileReference"
  | "list"
  | "listRetiredProfiles"
  | "pruneExpiredAliases"
  | "put"
  | "replaceCandidateProfile"
  | "require"
  | "resolve"
>;
type BrowserSessionsPort = Pick<
  BrowserProfileHost,
  "closeAutomation" | "openForAutomation" | "openForLogin" | "removeProfile"
>;

export interface AccountApplicationDependencies {
  accountStore: AccountStorePort;
  browserSessions: BrowserSessionsPort;
  removeAccountResources(account: PlatformAccountSummary): Promise<void>;
  isAccountBusy?(accountId: string): boolean;
  createId?: (() => string) | undefined;
  now?: (() => Date) | undefined;
  sessionDetector?: typeof detectPlatformSession | undefined;
  onAccountsChanged?: (() => void) | undefined;
  recognitionIntervalMs?: number | undefined;
  recognitionMaxAttempts?: number | undefined;
}

export class AccountReplacedError extends Error {
  constructor(readonly survivingAccountId: string) {
    super("Platform account was replaced by an existing account");
  }
}

interface CandidateReconciliationResult {
  detection: SessionDetection;
  retry: boolean;
}

export class AccountApplication {
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly sessionDetector: typeof detectPlatformSession;
  private readonly recognitionTokens = new Map<string, symbol>();
  private readonly identityTransitions = new Map<string, Promise<void>>();
  private readonly recognitionIntervalMs: number;
  private readonly recognitionMaxAttempts: number;

  constructor(private readonly dependencies: AccountApplicationDependencies) {
    this.createId = dependencies.createId ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
    this.sessionDetector =
      dependencies.sessionDetector ?? detectPlatformSession;
    this.recognitionIntervalMs =
      dependencies.recognitionIntervalMs ?? automaticRecognitionIntervalMs;
    this.recognitionMaxAttempts =
      dependencies.recognitionMaxAttempts ?? automaticRecognitionMaxAttempts;
  }

  listPlatforms() {
    return platformSummaries();
  }

  listAccounts() {
    return this.dependencies.accountStore.list();
  }

  resolveAccount(request: PlatformAccountRequest): ResolvedPlatformAccount {
    assertAccountRequest(request);
    return this.dependencies.accountStore.resolve(
      request.accountId,
      this.now(),
    );
  }

  createAccount(request: CreatePlatformAccountRequest) {
    assertPlatformRequest(request);
    const platform = platformFor(request.platformId);
    const id = this.createId();
    const now = this.now().toISOString();
    const account: PlatformAccountSummary = {
      id,
      platformId: platform.id,
      profileId: createBrowserProfileId(platform.id, id),
      lifecycle: "pending_identity",
      displayName: `${platform.displayName}账号`,
      identityScheme: null,
      externalAccountId: null,
      nickname: null,
      avatarUrl: null,
      accountInfo: [],
      status: "login_required",
      lastVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.dependencies.accountStore.put(account);
    this.dependencies.onAccountsChanged?.();
    return account;
  }

  async openLogin(request: OpenPlatformLoginRequest) {
    assertLoginRequest(request);
    const { account } = this.dependencies.accountStore.resolve(
      request.accountId,
      this.now(),
    );
    const platform = platformFor(account.platformId);
    const loginEntry = platform.accounts.loginEntries.find(
      (entry) => entry.id === request.loginEntryId,
    );
    if (!loginEntry) {
      throw new TypeError(
        `Unknown platform login entry: ${request.loginEntryId}`,
      );
    }
    const opened = await this.dependencies.browserSessions.openForLogin(
      account,
      platform,
      loginEntry,
    );
    this.startAutomaticRecognition(account.id, platform, opened);
    return { profileId: account.profileId };
  }

  async openAccount(request: PlatformAccountRequest) {
    assertAccountRequest(request);
    const { account } = this.dependencies.accountStore.resolve(
      request.accountId,
      this.now(),
    );
    const platform = platformFor(account.platformId);
    const loginEntry = platform.accounts.loginEntries[0];
    const opened =
      account.status !== "authenticated" && loginEntry
        ? await this.dependencies.browserSessions.openForLogin(
            account,
            platform,
            loginEntry,
          )
        : await this.dependencies.browserSessions.openForAutomation(
            account,
            platform,
          );
    this.startAutomaticRecognition(account.id, platform, opened);
    return { sessionId: opened.id, profileId: opened.profileId };
  }

  async refreshAccount(request: PlatformAccountRequest) {
    return this.detectAccount(request, true);
  }

  async verifyAccount(request: PlatformAccountRequest) {
    return this.detectAccount(request, false);
  }

  async removeAccount(request: PlatformAccountRequest) {
    assertAccountRequest(request);
    this.cancelAutomaticRecognition(request.accountId);
    const resolved = this.dependencies.accountStore.resolve(
      request.accountId,
      this.now(),
    );
    if (resolved.replacementAlias) {
      throw new AccountReplacedError(resolved.account.id);
    }
    const account = resolved.account;
    platformFor(account.platformId);
    await this.dependencies.removeAccountResources(account);
    this.dependencies.onAccountsChanged?.();
  }

  recordSessionDetection(
    accountId: string,
    detected: SessionDetection,
  ): SessionDetection {
    const account = this.dependencies.accountStore.require(accountId);
    if (account.lifecycle !== "active") {
      throw new TypeError(
        "Pending account identity cannot be used for publishing",
      );
    }
    return this.recordEstablishedAccountDetection(account, detected);
  }

  async cleanupRetiredProfiles(): Promise<void> {
    const now = this.now();
    this.dependencies.accountStore.pruneExpiredAliases(now);
    const dueProfiles = this.dependencies.accountStore
      .listRetiredProfiles()
      .filter((profile) => profile.removeAfter <= now.toISOString());
    for (const profile of dueProfiles) {
      await this.removeRetiredProfile(profile);
    }
  }

  private recordEstablishedAccountDetection(
    account: PlatformAccountSummary,
    detected: SessionDetection,
  ): SessionDetection {
    if (
      detected.status === "authenticated" &&
      account.externalAccountId !== null &&
      (detected.externalAccountId !== account.externalAccountId ||
        (account.identityScheme !== null &&
          detected.identityScheme !== account.identityScheme))
    ) {
      const platform = platformFor(account.platformId);
      const mismatch: SessionDetection = {
        status: "unknown",
        reason: `当前登录的${platform.displayName}账号与本地记录不一致，请切回原账号或刷新账号信息后重试`,
      };
      this.persistDetection(account, mismatch);
      return mismatch;
    }
    this.persistDetection(account, detected);
    return detected;
  }

  private async detectAccount(
    request: PlatformAccountRequest,
    allowIdentityChange: boolean,
  ): Promise<SessionDetection> {
    assertAccountRequest(request);
    this.cancelAutomaticRecognition(request.accountId);
    const { account } = this.dependencies.accountStore.resolve(
      request.accountId,
      this.now(),
    );
    this.cancelAutomaticRecognition(account.id);
    const platform = platformFor(account.platformId);
    const opened = await this.dependencies.browserSessions.openForAutomation(
      account,
      platform,
    );
    const detected = await this.sessionDetector(
      platform.accounts.detection,
      opened.driver,
      opened.sessionProbeClient,
    );

    let recorded: SessionDetection;
    if (
      account.lifecycle === "pending_identity" &&
      detected.status === "authenticated"
    ) {
      recorded = (await this.reconcileCandidateIdentity(account.id, detected))
        .detection;
    } else if (allowIdentityChange) {
      recorded = this.recordRefreshDetection(account, detected);
    } else {
      recorded = this.recordEstablishedAccountDetection(account, detected);
    }
    if (recorded.status === "login_required") {
      await this.dependencies.browserSessions.closeAutomation(account);
    }
    return recorded;
  }

  private recordRefreshDetection(
    account: PlatformAccountSummary,
    detected: SessionDetection,
  ): SessionDetection {
    if (detected.status !== "authenticated") {
      this.persistDetection(account, detected);
      return detected;
    }
    const identity = identityOf(account.platformId, detected);
    const conflict = this.dependencies.accountStore
      .findActiveByIdentity(identity)
      .find((candidate) => candidate.id !== account.id);
    if (conflict) {
      const mismatch: SessionDetection = {
        status: "unknown",
        reason: "当前登录的平台账号已由另一个本地账号管理",
      };
      this.persistDetection(account, mismatch);
      return mismatch;
    }
    this.persistDetection(account, detected);
    return detected;
  }

  private startAutomaticRecognition(
    accountId: string,
    platform: ReturnType<typeof platformFor>,
    opened: OpenedAccountSession,
  ): void {
    const token = Symbol(accountId);
    this.recognitionTokens.set(accountId, token);
    void this.runAutomaticRecognition(
      accountId,
      platform,
      opened,
      token,
    ).finally(() => {
      if (this.recognitionTokens.get(accountId) === token) {
        this.recognitionTokens.delete(accountId);
      }
    });
  }

  private async runAutomaticRecognition(
    accountId: string,
    platform: ReturnType<typeof platformFor>,
    opened: OpenedAccountSession,
    token: symbol,
  ): Promise<void> {
    for (
      let attempt = 1;
      attempt <= this.recognitionMaxAttempts;
      attempt += 1
    ) {
      if (
        this.recognitionTokens.get(accountId) !== token ||
        opened.page.isClosed()
      ) {
        return;
      }

      let detected: SessionDetection | undefined;
      try {
        detected = await this.sessionDetector(
          platform.accounts.detection,
          opened.driver,
          opened.sessionProbeClient,
        );
      } catch {
        // Page transitions are expected while the user completes login.
      }
      if (this.recognitionTokens.get(accountId) !== token) return;
      if (detected?.status === "authenticated") {
        const account = this.dependencies.accountStore.get(accountId);
        if (!account) return;
        if (account.lifecycle === "pending_identity") {
          const result = await this.reconcileCandidateIdentity(
            accountId,
            detected,
          );
          if (!result.retry) return;
        } else {
          this.recordEstablishedAccountDetection(account, detected);
          return;
        }
      }
      if (attempt === this.recognitionMaxAttempts || opened.page.isClosed()) {
        if (detected) this.persistAutomaticDetection(accountId, detected);
        return;
      }
      await waitForRecognition(this.recognitionIntervalMs);
    }
  }

  private async reconcileCandidateIdentity(
    candidateAccountId: string,
    detected: AuthenticatedDetection,
  ): Promise<CandidateReconciliationResult> {
    const initialCandidate =
      this.dependencies.accountStore.require(candidateAccountId);
    const identity = identityOf(initialCandidate.platformId, detected);
    return this.withIdentityTransition(identity, async () => {
      const candidate = this.dependencies.accountStore.get(candidateAccountId);
      if (!candidate) return { detection: detected, retry: false };
      if (candidate.lifecycle !== "pending_identity") {
        return {
          detection: this.recordEstablishedAccountDetection(
            candidate,
            detected,
          ),
          retry: false,
        };
      }

      const matches = this.dependencies.accountStore
        .findActiveByIdentity(identity)
        .filter((account) => account.id !== candidate.id);
      if (matches.length === 0) {
        this.persistDetection(candidate, detected);
        return { detection: detected, retry: false };
      }
      if (matches.length > 1) {
        return {
          detection: this.persistCandidateConflict(
            candidate,
            "检测到多条历史重复账号，无法自动选择保留记录",
          ),
          retry: false,
        };
      }

      const platform = platformFor(candidate.platformId);
      if (platform.accounts.duplicateProfileReplacement !== "enabled") {
        return {
          detection: this.persistCandidateConflict(
            candidate,
            `${platform.displayName}账号身份来源尚未统一，暂不能自动替换已有环境`,
          ),
          retry: false,
        };
      }

      const survivingAccount = matches[0]!;
      if (this.dependencies.isAccountBusy?.(survivingAccount.id)) {
        const deferred: SessionDetection = {
          status: "unknown",
          reason: "已有账号正在执行发布，将在任务结束后继续更新登录环境",
        };
        if (candidate.status !== "unknown") {
          this.persistDetection(candidate, deferred);
        }
        return {
          detection: deferred,
          retry: true,
        };
      }

      await this.dependencies.browserSessions.closeAutomation(survivingAccount);
      await this.dependencies.browserSessions.closeAutomation(candidate);

      const replacedAt = this.now();
      const replacement =
        this.dependencies.accountStore.replaceCandidateProfile({
          candidateAccountId: candidate.id,
          survivingAccountId: survivingAccount.id,
          identity,
          nickname: detected.nickname,
          avatarUrl: detected.avatarUrl,
          accountInfo: detected.accountInfo,
          replacedAt: replacedAt.toISOString(),
          aliasExpiresAt: addMilliseconds(
            replacedAt,
            replacementAliasLifetimeMs,
          ),
          removeRetiredProfileAfter: addMilliseconds(
            replacedAt,
            retiredProfileLifetimeMs,
          ),
        });
      this.cancelAutomaticRecognition(candidate.id);
      this.scheduleRetiredProfileCleanup(replacement.retiredProfile);
      this.dependencies.onAccountsChanged?.();
      return { detection: detected, retry: false };
    });
  }

  private persistCandidateConflict(
    account: PlatformAccountSummary,
    reason: string,
  ): SessionDetection {
    const conflict: SessionDetection = { status: "unknown", reason };
    this.persistDetection(account, conflict);
    return conflict;
  }

  private persistAutomaticDetection(
    accountId: string,
    detected: SessionDetection,
  ): void {
    const account = this.dependencies.accountStore.get(accountId);
    if (!account) return;
    if (
      account.lifecycle === "pending_identity" &&
      detected.status === "authenticated"
    ) {
      this.persistCandidateConflict(
        account,
        "账号登录环境暂时无法完成替换，请稍后刷新重试",
      );
      return;
    }
    this.recordEstablishedAccountDetection(account, detected);
  }

  private persistDetection(
    account: PlatformAccountSummary,
    detected: SessionDetection,
  ): PlatformAccountSummary {
    const now = this.now().toISOString();
    const updated: PlatformAccountSummary = {
      ...account,
      ...(detected.status === "authenticated"
        ? {
            lifecycle: "active" as const,
            displayName: detected.nickname,
            identityScheme: detected.identityScheme,
            externalAccountId: detected.externalAccountId,
            nickname: detected.nickname,
            avatarUrl: detected.avatarUrl,
            accountInfo: [...detected.accountInfo],
          }
        : {}),
      status: detected.status,
      lastVerifiedAt: now,
      updatedAt: now,
    };
    this.dependencies.accountStore.put(updated);
    this.dependencies.onAccountsChanged?.();
    return updated;
  }

  private async withIdentityTransition<T>(
    identity: CanonicalAccountIdentity,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = `${identity.platformId}\u0000${identity.identityScheme}\u0000${identity.externalAccountId}`;
    const previous = this.identityTransitions.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => gate);
    this.identityTransitions.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.identityTransitions.get(key) === queued) {
        this.identityTransitions.delete(key);
      }
    }
  }

  private scheduleRetiredProfileCleanup(profile: RetiredBrowserProfile): void {
    const delay = Math.max(
      0,
      new Date(profile.removeAfter).getTime() - this.now().getTime(),
    );
    const timer = setTimeout(() => {
      void this.removeRetiredProfile(profile).catch((error: unknown) => {
        console.error("Failed to remove retired browser profile", error);
      });
    }, delay);
    timer.unref();
  }

  private async removeRetiredProfile(
    profile: RetiredBrowserProfile,
  ): Promise<void> {
    if (this.dependencies.accountStore.hasProfileReference(profile.profileId)) {
      console.error(
        "Retired browser profile is still referenced by an account",
      );
      return;
    }
    await this.dependencies.browserSessions.removeProfile(profile.profileId);
    this.dependencies.accountStore.discardRetiredProfile(profile.profileId);
  }

  private cancelAutomaticRecognition(accountId: string): void {
    this.recognitionTokens.delete(accountId);
  }
}
