import {
  detectPlatformSession,
  executeWorkflow,
} from "@nedia-matrix/automation-engine";
import type {
  CreatePlatformAccountRequest,
  OpenPlatformLoginRequest,
  OpenPublicationRequest,
  PlatformAccountRequest,
  PreparePublishDraftRequest,
} from "@nedia-matrix/ipc-contracts";

import {
  AccountBindingApplication,
  type AccountBindingApplicationDependencies,
  type BindAccountCommand,
  type VerifyAccountBindingQuery,
} from "../accounts/account-binding-application.js";
import { AccountApplication } from "../accounts/account-application.js";
import type { PlatformAccountStore } from "../accounts/account-store.js";
import type { BrowserProfileHost } from "../accounts/browser-session-host.js";
import type { MediaSelectionStore } from "../publishing/media-selection-store.js";
import {
  PublishingApplication,
  type RegisterLocalMediaRequest,
  type PrepareRemoteDraftRequest,
  type PublishingApplicationDependencies,
} from "../publishing/publishing-application.js";
import type { PublishObservationHost } from "../publishing/publish-observation-host.js";
import { removeAccountAndResources } from "../runtime-cleanup.js";

export interface AccountUseCases {
  listPlatforms(): ReturnType<AccountApplication["listPlatforms"]>;
  list(): ReturnType<AccountApplication["listAccounts"]>;
  resolve(
    request: PlatformAccountRequest,
  ): ReturnType<AccountApplication["resolveAccount"]>;
  create(
    request: CreatePlatformAccountRequest,
  ): ReturnType<AccountApplication["createAccount"]>;
  openLogin(
    request: OpenPlatformLoginRequest,
  ): ReturnType<AccountApplication["openLogin"]>;
  open(
    request: PlatformAccountRequest,
  ): ReturnType<AccountApplication["openAccount"]>;
  refresh(
    request: PlatformAccountRequest,
  ): ReturnType<AccountApplication["refreshAccount"]>;
  verify(
    request: PlatformAccountRequest,
  ): ReturnType<AccountApplication["verifyAccount"]>;
  remove(
    request: PlatformAccountRequest,
  ): ReturnType<AccountApplication["removeAccount"]>;
  cleanupRetiredProfiles(): ReturnType<
    AccountApplication["cleanupRetiredProfiles"]
  >;
}

export interface AccountBindingUseCases {
  list(): ReturnType<AccountBindingApplication["list"]>;
  bind(
    command: BindAccountCommand,
  ): ReturnType<AccountBindingApplication["bind"]>;
  verify(
    query: VerifyAccountBindingQuery,
  ): ReturnType<AccountBindingApplication["verify"]>;
  removeForRuntimeAccount(
    runtimeAccountId: string,
  ): ReturnType<AccountBindingApplication["removeForRuntimeAccount"]>;
}

export interface PublicationUseCases {
  list(): ReturnType<PublishingApplication["listPublications"]>;
  publicationUrl(
    request: OpenPublicationRequest,
  ): ReturnType<PublishingApplication["publicationUrl"]>;
  prepareRemote(
    request: PrepareRemoteDraftRequest,
  ): ReturnType<PublishingApplication["prepareRemoteDraft"]>;
  prepare(
    request: PreparePublishDraftRequest,
  ): ReturnType<PublishingApplication["prepareDraft"]>;
  registerLocalMedia(
    request: RegisterLocalMediaRequest,
  ): ReturnType<PublishingApplication["registerLocalMedia"]>;
  recordObservation(
    ...args: Parameters<PublishingApplication["recordObservation"]>
  ): ReturnType<PublishingApplication["recordObservation"]>;
  recoverInterrupted(): ReturnType<PublishingApplication["recoverInterrupted"]>;
}

export interface NediaMatrixUseCases {
  readonly accounts: AccountUseCases;
  readonly accountBindings: AccountBindingUseCases;
  readonly publications: PublicationUseCases;
}

export type NediaMatrixApplicationEvent =
  | { type: "accounts.changed" }
  | { type: "publication.changed"; publicationId: string };

export interface ApplicationEventSink {
  publish(event: NediaMatrixApplicationEvent): void;
}

interface DesktopApplicationDependencies extends Omit<
  PublishingApplicationDependencies,
  "recordSessionDetection"
> {
  accountStore: PublishingApplicationDependencies["accountStore"] &
    Pick<
      PlatformAccountStore,
      | "discardRetiredProfile"
      | "findActiveByIdentity"
      | "get"
      | "hasProfileReference"
      | "list"
      | "listRetiredProfiles"
      | "pruneExpiredAliases"
      | "put"
      | "remove"
      | "replaceCandidateProfile"
      | "resolve"
    >;
  accountBindings: AccountBindingApplicationDependencies["accountBindings"];
  browserSessions: PublishingApplicationDependencies["browserSessions"] &
    Pick<BrowserProfileHost, "openForLogin" | "remove" | "removeProfile">;
  mediaSelections: PublishingApplicationDependencies["mediaSelections"] &
    Pick<MediaSelectionStore, "removeForAccount">;
  publishObservations: PublishingApplicationDependencies["publishObservations"] &
    Pick<PublishObservationHost, "stop">;
  now?: (() => Date) | undefined;
  sessionDetector?: typeof detectPlatformSession | undefined;
  workflowExecutor?: typeof executeWorkflow | undefined;
  eventSink?: ApplicationEventSink | undefined;
}

export type { PrepareRemoteDraftRequest };

export class NediaMatrixApplication implements NediaMatrixUseCases {
  private readonly accountApplication: AccountApplication;
  private readonly bindings: AccountBindingApplication;
  private readonly publishing: PublishingApplication;

  readonly accounts: AccountUseCases;
  readonly accountBindings: AccountBindingUseCases;
  readonly publications: PublicationUseCases;

  constructor(dependencies: DesktopApplicationDependencies) {
    this.accountApplication = new AccountApplication({
      accountStore: dependencies.accountStore,
      browserSessions: dependencies.browserSessions,
      removeAccountResources: async (account) => {
        await removeAccountAndResources(account, {
          ...dependencies,
          beforeAccountRemove: () =>
            dependencies.accountBindings.removeForRuntimeAccount(account.id),
        });
      },
      createId: dependencies.createId,
      now: dependencies.now,
      sessionDetector: dependencies.sessionDetector,
      isAccountBusy: (accountId) =>
        dependencies.accountPublications.isActive(accountId),
      onAccountsChanged: () =>
        dependencies.eventSink?.publish({ type: "accounts.changed" }),
    });
    this.bindings = new AccountBindingApplication({
      accountBindings: dependencies.accountBindings,
      accounts: this.accountApplication,
      now: dependencies.now,
    });
    this.publishing = new PublishingApplication({
      ...dependencies,
      recordSessionDetection: (accountId, detected) =>
        this.accountApplication.recordSessionDetection(accountId, detected),
    });
    this.accounts = {
      listPlatforms: () => this.accountApplication.listPlatforms(),
      list: () => this.accountApplication.listAccounts(),
      resolve: (request) => this.accountApplication.resolveAccount(request),
      create: (request) => this.accountApplication.createAccount(request),
      openLogin: (request) => this.accountApplication.openLogin(request),
      open: (request) => this.accountApplication.openAccount(request),
      refresh: (request) => this.accountApplication.refreshAccount(request),
      verify: (request) => this.accountApplication.verifyAccount(request),
      remove: (request) => this.accountApplication.removeAccount(request),
      cleanupRetiredProfiles: () =>
        this.accountApplication.cleanupRetiredProfiles(),
    };
    this.accountBindings = {
      list: () => this.bindings.list(),
      bind: (command) => this.bindings.bind(command),
      verify: (query) => this.bindings.verify(query),
      removeForRuntimeAccount: (accountId) =>
        this.bindings.removeForRuntimeAccount(accountId),
    };
    this.publications = {
      list: () => this.publishing.listPublications(),
      publicationUrl: (request) => this.publishing.publicationUrl(request),
      prepareRemote: (request) => this.publishing.prepareRemoteDraft(request),
      prepare: (request) => this.publishing.prepareDraft(request),
      registerLocalMedia: (request) =>
        this.publishing.registerLocalMedia(request),
      recordObservation: (publicationId, result) =>
        this.publishing.recordObservation(publicationId, result),
      recoverInterrupted: () => this.publishing.recoverInterrupted(),
    };
  }
}
