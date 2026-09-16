import type {
  CreatePlatformAccountRequest,
  DetectPlatformSessionResult,
  OpenPlatformAccountResult,
  OpenPlatformLoginRequest,
  OpenPlatformLoginResult,
  PlatformAccountRequest,
  PlatformAccountView,
} from "@nedia-matrix/account-management";
import type {
  PlatformContentSnapshot,
  PlatformContentSyncRun,
} from "@nedia-matrix/platform-content";
import type {
  OpenPublicationRequest,
  PreparePublishDraftRequest,
  PreparePublishDraftResult,
  PublicationSummary,
  PublishResultUpdate,
  SelectPublishMediaRequest,
  SelectPublishMediaResult,
} from "@nedia-matrix/publishing";

import type {
  ApplicationUpdateCheckResult,
  AutomationTraceReference,
  FindAutomationTraceRequest,
  LocalRuntimeStatus,
  OpenApplicationUpdateDownloadRequest,
  PlatformSummary,
  SetLocalRuntimeRunningRequest,
} from "./contracts.js";

export interface MatrixDesktopApi {
  checkForApplicationUpdate(): Promise<ApplicationUpdateCheckResult>;
  openApplicationUpdateDownload(
    request: OpenApplicationUpdateDownloadRequest,
  ): Promise<void>;
  listPlatforms(): Promise<PlatformSummary[]>;
  listPlatformAccounts(): Promise<PlatformAccountView[]>;
  createPlatformAccount(
    request: CreatePlatformAccountRequest,
  ): Promise<PlatformAccountView>;
  openPlatformLogin(
    request: OpenPlatformLoginRequest,
  ): Promise<OpenPlatformLoginResult>;
  openPlatformAccount(
    request: PlatformAccountRequest,
  ): Promise<OpenPlatformAccountResult>;
  refreshPlatformAccount(
    request: PlatformAccountRequest,
  ): Promise<DetectPlatformSessionResult>;
  refreshPlatformAccountProfile(
    request: PlatformAccountRequest,
  ): Promise<PlatformAccountView>;
  removePlatformAccount(request: PlatformAccountRequest): Promise<void>;
  onPlatformAccountsChanged(listener: () => void): () => void;
  listPlatformContents(request: PlatformAccountRequest): Promise<{
    items: PlatformContentSnapshot[];
    latestRun: PlatformContentSyncRun | null;
  }>;
  refreshPlatformContents(
    request: PlatformAccountRequest,
  ): Promise<PlatformContentSyncRun>;
  selectPublishMedia(
    request: SelectPublishMediaRequest,
  ): Promise<SelectPublishMediaResult>;
  preparePublishDraft(
    request: PreparePublishDraftRequest,
  ): Promise<PreparePublishDraftResult>;
  listPublications(): Promise<PublicationSummary[]>;
  openPublicationReview(request: OpenPublicationRequest): Promise<void>;
  openPublication(request: OpenPublicationRequest): Promise<void>;
  onPublishResultUpdate(listener: (update: PublishResultUpdate) => void): void;
  getLocalRuntimeStatus(): Promise<LocalRuntimeStatus>;
  setLocalRuntimeRunning(
    request: SetLocalRuntimeRunningRequest,
  ): Promise<LocalRuntimeStatus>;
  openAutomationLogDirectory(): Promise<void>;
  findAutomationTrace(
    request: FindAutomationTraceRequest,
  ): Promise<AutomationTraceReference | null>;
}
