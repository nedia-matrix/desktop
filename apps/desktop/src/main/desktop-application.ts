import {
  detectPlatformSession,
  executeWorkflow,
} from "@nedia-matrix/automation-engine";
import type {
  CreatePlatformAccountRequest,
  OpenPlatformLoginRequest,
  OpenPublicationRequest,
  PlatformAccountRequest,
  PlatformAccountSummary,
  PreparePublishDraftRequest,
} from "@nedia-matrix/ipc-contracts";

import { AccountApplication } from "./accounts/account-application.js";
import type { PlatformAccountStore } from "./accounts/account-store.js";
import type { BrowserProfileHost } from "./accounts/browser-session-host.js";
import type { MediaSelectionStore } from "./publishing/media-selection-store.js";
import {
  PublishingApplication,
  type PrepareRemoteDraftRequest,
  type PublishingApplicationDependencies,
} from "./publishing/publishing-application.js";
import type { PublishObservationHost } from "./publishing/publish-observation-host.js";
import { removeAccountAndResources } from "./runtime-cleanup.js";

interface DesktopApplicationDependencies extends Omit<
  PublishingApplicationDependencies,
  "recordSessionDetection"
> {
  accountStore: PublishingApplicationDependencies["accountStore"] &
    Pick<PlatformAccountStore, "list" | "put" | "remove">;
  browserSessions: PublishingApplicationDependencies["browserSessions"] &
    Pick<BrowserProfileHost, "openForLogin" | "remove">;
  mediaSelections: PublishingApplicationDependencies["mediaSelections"] &
    Pick<MediaSelectionStore, "removeForAccount">;
  publishObservations: PublishingApplicationDependencies["publishObservations"] &
    Pick<PublishObservationHost, "stop">;
  now?: (() => Date) | undefined;
  sessionDetector?: typeof detectPlatformSession | undefined;
  workflowExecutor?: typeof executeWorkflow | undefined;
  onAccountUpdated?: ((account: PlatformAccountSummary) => void) | undefined;
}

export type { PrepareRemoteDraftRequest };

export class DesktopDistributionApplication {
  private readonly accounts: AccountApplication;
  private readonly publishing: PublishingApplication;

  constructor(dependencies: DesktopApplicationDependencies) {
    this.accounts = new AccountApplication({
      accountStore: dependencies.accountStore,
      browserSessions: dependencies.browserSessions,
      removeAccountResources: (account) =>
        removeAccountAndResources(account, dependencies),
      createId: dependencies.createId,
      now: dependencies.now,
      sessionDetector: dependencies.sessionDetector,
      onAccountUpdated: dependencies.onAccountUpdated,
    });
    this.publishing = new PublishingApplication({
      ...dependencies,
      recordSessionDetection: (accountId, detected) =>
        this.accounts.recordSessionDetection(accountId, detected),
    });
  }

  listPlatforms() {
    return this.accounts.listPlatforms();
  }

  listAccounts() {
    return this.accounts.listAccounts();
  }

  createAccount(request: CreatePlatformAccountRequest) {
    return this.accounts.createAccount(request);
  }

  openLogin(request: OpenPlatformLoginRequest) {
    return this.accounts.openLogin(request);
  }

  openAccount(request: PlatformAccountRequest) {
    return this.accounts.openAccount(request);
  }

  refreshAccount(request: PlatformAccountRequest) {
    return this.accounts.refreshAccount(request);
  }

  verifyAccount(request: PlatformAccountRequest) {
    return this.accounts.verifyAccount(request);
  }

  removeAccount(request: PlatformAccountRequest) {
    return this.accounts.removeAccount(request);
  }

  listPublications() {
    return this.publishing.listPublications();
  }

  publicationUrl(request: OpenPublicationRequest) {
    return this.publishing.publicationUrl(request);
  }

  prepareRemoteDraft(request: PrepareRemoteDraftRequest) {
    return this.publishing.prepareRemoteDraft(request);
  }

  prepareDraft(request: PreparePublishDraftRequest) {
    return this.publishing.prepareDraft(request);
  }
}
