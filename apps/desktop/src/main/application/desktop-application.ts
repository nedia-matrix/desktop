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

import {
  RuntimeAccountBindingService,
  type RuntimeAccountBindingServiceDependencies,
  type BindAccountCommand,
  type VerifyAccountBindingQuery,
} from "../runtime-api/public.js";
import {
  AccountService,
  removeAccountAndResources,
  type AccountRepository,
  type BrowserSessionPort,
} from "../accounts/public.js";
import {
  PublicationService,
  type RegisterLocalMediaRequest,
  type PrepareRemoteDraftRequest,
  type PublicationServiceDependencies,
} from "../publishing/public.js";

export interface AccountUseCases {
  listPlatforms(): ReturnType<AccountService["listPlatforms"]>;
  list(): ReturnType<AccountService["listAccounts"]>;
  resolve(
    request: PlatformAccountRequest,
  ): ReturnType<AccountService["resolveAccount"]>;
  create(
    request: CreatePlatformAccountRequest,
  ): ReturnType<AccountService["createAccount"]>;
  openLogin(
    request: OpenPlatformLoginRequest,
  ): ReturnType<AccountService["openLogin"]>;
  open(
    request: PlatformAccountRequest,
  ): ReturnType<AccountService["openAccount"]>;
  refresh(
    request: PlatformAccountRequest,
  ): ReturnType<AccountService["refreshAccount"]>;
  verify(
    request: PlatformAccountRequest,
  ): ReturnType<AccountService["verifyAccount"]>;
  remove(
    request: PlatformAccountRequest,
  ): ReturnType<AccountService["removeAccount"]>;
  cleanupRetiredProfiles(): ReturnType<
    AccountService["cleanupRetiredProfiles"]
  >;
}

export interface AccountBindingUseCases {
  list(): ReturnType<RuntimeAccountBindingService["list"]>;
  bind(
    command: BindAccountCommand,
  ): ReturnType<RuntimeAccountBindingService["bind"]>;
  verify(
    query: VerifyAccountBindingQuery,
  ): ReturnType<RuntimeAccountBindingService["verify"]>;
  removeForRuntimeAccount(
    runtimeAccountId: string,
  ): ReturnType<RuntimeAccountBindingService["removeForRuntimeAccount"]>;
}

export interface PublicationUseCases {
  list(): ReturnType<PublicationService["listPublications"]>;
  publicationUrl(
    request: OpenPublicationRequest,
  ): ReturnType<PublicationService["publicationUrl"]>;
  prepareRemote(
    request: PrepareRemoteDraftRequest,
  ): ReturnType<PublicationService["prepareRemoteDraft"]>;
  prepare(
    request: PreparePublishDraftRequest,
  ): ReturnType<PublicationService["prepareDraft"]>;
  registerLocalMedia(
    request: RegisterLocalMediaRequest,
  ): ReturnType<PublicationService["registerLocalMedia"]>;
  recordObservation(
    ...args: Parameters<PublicationService["recordObservation"]>
  ): ReturnType<PublicationService["recordObservation"]>;
  recoverInterrupted(): ReturnType<PublicationService["recoverInterrupted"]>;
}

export interface DesktopUseCases {
  readonly accounts: AccountUseCases;
  readonly accountBindings: AccountBindingUseCases;
  readonly publications: PublicationUseCases;
}

export type DesktopApplicationEvent =
  | { type: "accounts.changed" }
  | { type: "publication.changed"; publicationId: string };

export interface DesktopEventSink {
  publish(event: DesktopApplicationEvent): void;
}

interface DesktopApplicationDependencies extends Omit<
  PublicationServiceDependencies,
  "verifyAccount"
> {
  accountStore: PublicationServiceDependencies["accountStore"] &
    Pick<
      AccountRepository,
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
  accountBindings: RuntimeAccountBindingServiceDependencies["accountBindings"];
  browserSessions: PublicationServiceDependencies["browserSessions"] &
    Pick<BrowserSessionPort, "openForLogin" | "removeProfile"> & {
      remove(account: PlatformAccountSummary): Promise<void>;
    };
  mediaSelections: PublicationServiceDependencies["mediaSelections"] & {
    removeForAccount(accountId: string): void;
  };
  publishObservations: PublicationServiceDependencies["publishObservations"] & {
    stop(accountId: string): Promise<void>;
  };
  now?: (() => Date) | undefined;
  sessionDetector?: typeof detectPlatformSession | undefined;
  workflowExecutor?: typeof executeWorkflow | undefined;
  eventSink?: DesktopEventSink | undefined;
}

export type { PrepareRemoteDraftRequest };

export class DesktopApplication implements DesktopUseCases {
  private readonly accountApplication: AccountService;
  private readonly bindings: RuntimeAccountBindingService;
  private readonly publishing: PublicationService;

  readonly accounts: AccountUseCases;
  readonly accountBindings: AccountBindingUseCases;
  readonly publications: PublicationUseCases;

  constructor(dependencies: DesktopApplicationDependencies) {
    this.accountApplication = new AccountService({
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
    this.bindings = new RuntimeAccountBindingService({
      accountBindings: dependencies.accountBindings,
      accounts: this.accountApplication,
      now: dependencies.now,
    });
    this.publishing = new PublicationService({
      ...dependencies,
      verifyAccount: (request) =>
        this.accountApplication.verifyAccount(request),
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
      recordObservation: (publicationId, result, sequence) =>
        this.publishing.recordObservation(publicationId, result, sequence),
      recoverInterrupted: () => this.publishing.recoverInterrupted(),
    };
  }
}
