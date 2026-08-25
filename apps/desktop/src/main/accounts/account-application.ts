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
import type { PlatformAccountStore } from "./account-store.js";
import {
  assertAccountRequest,
  assertLoginRequest,
  assertPlatformRequest,
} from "./account-request-validation.js";
import type { BrowserProfileHost } from "./browser-session-host.js";

const automaticRecognitionIntervalMs = 3_000;
const automaticRecognitionMaxAttempts = 100;

type OpenedAccountSession = Awaited<
  ReturnType<BrowserProfileHost["openForAutomation"]>
>;
type SessionDetection = Awaited<ReturnType<typeof detectPlatformSession>>;

function waitForRecognition(intervalMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    timer.unref();
  });
}

type AccountStorePort = Pick<PlatformAccountStore, "list" | "require" | "put">;
type BrowserSessionsPort = Pick<
  BrowserProfileHost,
  "openForLogin" | "openForAutomation" | "closeAutomation"
>;

export interface AccountApplicationDependencies {
  accountStore: AccountStorePort;
  browserSessions: BrowserSessionsPort;
  removeAccountResources(account: PlatformAccountSummary): Promise<void>;
  createId?: (() => string) | undefined;
  now?: (() => Date) | undefined;
  sessionDetector?: typeof detectPlatformSession | undefined;
  onAccountsChanged?: (() => void) | undefined;
  recognitionIntervalMs?: number | undefined;
  recognitionMaxAttempts?: number | undefined;
}

export class AccountApplication {
  private readonly createId: () => string;
  private readonly now: () => Date;
  private readonly sessionDetector: typeof detectPlatformSession;
  private readonly recognitionTokens = new Map<string, symbol>();
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

  createAccount(request: CreatePlatformAccountRequest) {
    assertPlatformRequest(request);
    const platform = platformFor(request.platformId);
    const id = this.createId();
    const now = this.now().toISOString();
    const account: PlatformAccountSummary = {
      id,
      platformId: platform.id,
      profileId: createBrowserProfileId(platform.id, id),
      displayName: `${platform.displayName}账号`,
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
    const account = this.dependencies.accountStore.require(request.accountId);
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
    const account = this.dependencies.accountStore.require(request.accountId);
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
    const account = this.dependencies.accountStore.require(request.accountId);
    platformFor(account.platformId);
    await this.dependencies.removeAccountResources(account);
    this.dependencies.onAccountsChanged?.();
  }

  recordSessionDetection(
    accountId: string,
    detected: SessionDetection,
  ): SessionDetection {
    const account = this.dependencies.accountStore.require(accountId);
    return this.recordSessionDetectionForAccount(account, detected);
  }

  private recordSessionDetectionForAccount(
    account: PlatformAccountSummary,
    detected: SessionDetection,
  ): SessionDetection {
    if (
      detected.status === "authenticated" &&
      account.externalAccountId !== null &&
      detected.externalAccountId !== account.externalAccountId
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
    const account = this.dependencies.accountStore.require(request.accountId);
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
    if (allowIdentityChange) {
      this.persistDetection(account, detected);
      recorded = detected;
    } else {
      recorded = this.recordSessionDetection(account.id, detected);
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
        this.persistAutomaticDetection(accountId, detected);
        return;
      }
      if (attempt === this.recognitionMaxAttempts || opened.page.isClosed()) {
        if (detected) this.persistAutomaticDetection(accountId, detected);
        return;
      }
      await waitForRecognition(this.recognitionIntervalMs);
    }
  }

  private persistAutomaticDetection(
    accountId: string,
    detected: SessionDetection,
  ): void {
    let account: PlatformAccountSummary;
    try {
      account = this.dependencies.accountStore.require(accountId);
    } catch {
      return;
    }
    this.recordSessionDetectionForAccount(account, detected);
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
            displayName: detected.nickname,
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

  private cancelAutomaticRecognition(accountId: string): void {
    this.recognitionTokens.delete(accountId);
  }
}
