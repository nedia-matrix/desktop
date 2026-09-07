import { randomUUID } from "node:crypto";

import { detectPlatformSession } from "@nedia-matrix/automation-engine";
import { createBrowserProfileId } from "@nedia-matrix/automation-playwright";
import type {
  CreatePlatformAccountRequest,
  OpenPlatformLoginRequest,
  PlatformAccountRequest,
  PlatformAccountSummary,
} from "@nedia-matrix/ipc-contracts";

import {
  platformFor,
  platformSummaries,
} from "../../platforms/platform-registry.js";
import {
  AccountIdentityService,
  type SessionDetection,
} from "./account-identity-service.js";
import type { AccountRepository, BrowserSessionPort } from "./account-ports.js";
import type { ResolvedPlatformAccount } from "./account-types.js";
import {
  assertAccountRequest,
  assertLoginRequest,
  assertPlatformRequest,
} from "./account-request-validator.js";
import { RetiredProfileCleaner } from "./retired-profile-cleaner.js";

const AUTOMATIC_RECOGNITION_INTERVAL_MS = 3_000;
const AUTOMATIC_RECOGNITION_MAX_ATTEMPTS = 100;

type OpenedAccountSession = Awaited<
  ReturnType<BrowserSessionPort["openForAutomation"]>
>;

function waitForRecognition(intervalMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    timer.unref();
  });
}

export interface AccountServiceDependencies {
  accountStore: AccountRepository;
  browserSessions: BrowserSessionPort;
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

export class AccountService {
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly sessionDetector: typeof detectPlatformSession;
  private readonly recognitionTokens = new Map<string, symbol>();
  private readonly recognitionCancels = new Map<string, () => void>();
  private readonly verificationTransitions = new Map<string, Promise<void>>();
  private readonly recognitionIntervalMs: number;
  private readonly recognitionMaxAttempts: number;
  private readonly retiredProfiles: RetiredProfileCleaner;
  private readonly identities: AccountIdentityService;

  constructor(private readonly dependencies: AccountServiceDependencies) {
    this.createId = dependencies.createId ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
    this.sessionDetector =
      dependencies.sessionDetector ?? detectPlatformSession;
    this.recognitionIntervalMs =
      dependencies.recognitionIntervalMs ?? AUTOMATIC_RECOGNITION_INTERVAL_MS;
    this.recognitionMaxAttempts =
      dependencies.recognitionMaxAttempts ?? AUTOMATIC_RECOGNITION_MAX_ATTEMPTS;
    this.retiredProfiles = new RetiredProfileCleaner({
      accountStore: dependencies.accountStore,
      browserSessions: dependencies.browserSessions,
      now: this.now,
    });
    this.identities = new AccountIdentityService({
      accountStore: dependencies.accountStore,
      browserSessions: dependencies.browserSessions,
      retiredProfiles: this.retiredProfiles,
      now: this.now,
      isAccountBusy: dependencies.isAccountBusy,
      onAccountsChanged: dependencies.onAccountsChanged,
      cancelRecognition: (accountId) =>
        this.cancelAutomaticRecognition(accountId),
    });
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

  cleanupRetiredProfiles(): Promise<void> {
    return this.retiredProfiles.cleanupDue();
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
    const detected = await this.withVerificationTransition(
      account.id,
      async () => {
        const verification = this.dependencies.browserSessions
          .openForVerification
          ? await this.dependencies.browserSessions.openForVerification(
              account,
              platform,
            )
          : await this.dependencies.browserSessions.openForAutomation(
              account,
              platform,
            );
        try {
          return await this.sessionDetector(
            platform.accounts.detection,
            verification.driver,
            verification.sessionProbeClient,
          );
        } finally {
          if (
            "close" in verification &&
            this.dependencies.browserSessions.openForVerification
          ) {
            await verification.close();
          }
        }
      },
    );

    let recorded: SessionDetection;
    if (
      account.lifecycle === "pending_identity" &&
      detected.status === "authenticated"
    ) {
      recorded = (
        await this.identities.reconcileCandidate(account.id, detected)
      ).detection;
    } else if (allowIdentityChange) {
      recorded = this.identities.recordRefresh(account, detected);
    } else {
      recorded = this.identities.recordEstablished(account, detected);
    }
    if (recorded.status === "login_required") {
      await this.dependencies.browserSessions.closeAutomation(account);
    }
    return recorded;
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
      this.recognitionCancels.delete(accountId);
    });
  }

  private async runAutomaticRecognition(
    accountId: string,
    platform: ReturnType<typeof platformFor>,
    opened: OpenedAccountSession,
    token: symbol,
  ): Promise<void> {
    if (
      platform.accounts.detection.probes.some(
        (probe) => probe.source.kind === "observed-response",
      ) &&
      typeof opened.sessionProbeClient.subscribeObservedResponses === "function"
    ) {
      return this.runObservedResponseRecognition(
        accountId,
        platform,
        opened,
        token,
      );
    }
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
          const result = await this.identities.reconcileCandidate(
            accountId,
            detected,
          );
          if (!result.retry) return;
        } else {
          this.identities.recordEstablished(account, detected);
          return;
        }
      }
      if (attempt === this.recognitionMaxAttempts || opened.page.isClosed()) {
        if (detected) this.identities.persistAutomatic(accountId, detected);
        return;
      }
      await waitForRecognition(this.recognitionIntervalMs);
    }
  }

  private runObservedResponseRecognition(
    accountId: string,
    platform: ReturnType<typeof platformFor>,
    opened: OpenedAccountSession,
    token: symbol,
  ): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      let inspecting = false;
      let inspectAgain = false;
      let lastDetected: SessionDetection | undefined;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      const observedTimeoutMs = platform.accounts.detection.probes.reduce(
        (total, probe) =>
          total +
          (probe.source.kind === "observed-response"
            ? probe.source.timeoutMs
            : 0),
        0,
      );
      const deadlineMs =
        this.recognitionMaxAttempts *
        (this.recognitionIntervalMs + observedTimeoutMs);

      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(deadlineTimer);
        if (retryTimer) clearTimeout(retryTimer);
        unsubscribeResponses();
        if (typeof opened.page.off === "function") {
          opened.page.off("close", finish);
        }
        opened.sessionProbeClient.dispose?.();
        resolve();
      };

      const reconcile = async (
        detected: Extract<SessionDetection, { status: "authenticated" }>,
      ) => {
        const account = this.dependencies.accountStore.get(accountId);
        if (!account) return finish();
        if (account.lifecycle !== "pending_identity") {
          this.identities.recordEstablished(account, detected);
          return finish();
        }
        const result = await this.identities.reconcileCandidate(
          accountId,
          detected,
        );
        if (!result.retry) return finish();
        retryTimer = setTimeout(
          () => void reconcile(detected),
          this.recognitionIntervalMs,
        );
        retryTimer.unref();
      };

      const inspect = async () => {
        if (finished || this.recognitionTokens.get(accountId) !== token) {
          return finish();
        }
        if (inspecting) {
          inspectAgain = true;
          return;
        }
        inspecting = true;
        try {
          do {
            inspectAgain = false;
            try {
              lastDetected = await this.sessionDetector(
                platform.accounts.detection,
                opened.driver,
                opened.sessionProbeClient,
              );
            } catch {
              lastDetected = undefined;
            }
            if (lastDetected?.status === "authenticated") {
              await reconcile(lastDetected);
              return;
            }
          } while (inspectAgain && !finished);
        } finally {
          inspecting = false;
        }
      };

      const unsubscribeResponses =
        opened.sessionProbeClient.subscribeObservedResponses(() => {
          void inspect();
        });
      if (typeof opened.page.once === "function") {
        opened.page.once("close", finish);
      }
      const deadlineTimer = setTimeout(() => {
        if (lastDetected) {
          this.identities.persistAutomatic(accountId, lastDetected);
        }
        finish();
      }, deadlineMs);
      deadlineTimer.unref();
      this.recognitionCancels.set(accountId, finish);
      void inspect();
    });
  }

  private cancelAutomaticRecognition(accountId: string): void {
    this.recognitionCancels.get(accountId)?.();
    this.recognitionCancels.delete(accountId);
    this.recognitionTokens.delete(accountId);
  }

  private async withVerificationTransition<T>(
    accountId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.verificationTransitions.get(accountId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => gate);
    this.verificationTransitions.set(accountId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.verificationTransitions.get(accountId) === queued) {
        this.verificationTransitions.delete(accountId);
      }
    }
  }
}
