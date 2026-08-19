import type {
  CreatePlatformAccountRequest,
  DetectPlatformSessionResult,
  OpenPlatformLoginRequest,
  OpenPlatformLoginResult,
  OpenPlatformAccountResult,
  PlatformAccountRequest,
  PlatformAccountSummary,
} from "./platform-account.js";
import type { PlatformSummary } from "./platform.js";
import type {
  PreparePublishDraftRequest,
  PreparePublishDraftResult,
  OpenPublicationRequest,
  PublicationSummary,
  PublishResultUpdate,
  SelectPublishMediaRequest,
  SelectPublishMediaResult,
} from "./publish.js";
import type { LocalRuntimeDiagnostics } from "./runtime-diagnostics.js";

export interface MatrixDesktopApi {
  listPlatforms(): Promise<PlatformSummary[]>;
  listPlatformAccounts(): Promise<PlatformAccountSummary[]>;
  createPlatformAccount(
    request: CreatePlatformAccountRequest,
  ): Promise<PlatformAccountSummary>;
  openPlatformLogin(
    request: OpenPlatformLoginRequest,
  ): Promise<OpenPlatformLoginResult>;
  openPlatformAccount(
    request: PlatformAccountRequest,
  ): Promise<OpenPlatformAccountResult>;
  refreshPlatformAccount(
    request: PlatformAccountRequest,
  ): Promise<DetectPlatformSessionResult>;
  removePlatformAccount(request: PlatformAccountRequest): Promise<void>;
  onPlatformAccountUpdate(
    listener: (account: PlatformAccountSummary) => void,
  ): () => void;
  selectPublishMedia(
    request: SelectPublishMediaRequest,
  ): Promise<SelectPublishMediaResult>;
  preparePublishDraft(
    request: PreparePublishDraftRequest,
  ): Promise<PreparePublishDraftResult>;
  listPublications(): Promise<PublicationSummary[]>;
  openPublication(request: OpenPublicationRequest): Promise<void>;
  onPublishResultUpdate(listener: (update: PublishResultUpdate) => void): void;
  getLocalRuntimeDiagnostics(): Promise<LocalRuntimeDiagnostics>;
  clearLocalRuntimeRequestLogs(): Promise<void>;
}
