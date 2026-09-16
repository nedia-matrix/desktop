import type { MatrixDesktopApi } from "../bridge/api.js";
import { ipcChannels } from "../bridge/channels.js";
import type {
  FindAutomationTraceRequest,
  OpenApplicationUpdateDownloadRequest,
  SetLocalRuntimeRunningRequest,
} from "../bridge/contracts.js";
import type {
  CreatePlatformAccountRequest,
  OpenPlatformLoginRequest,
  PlatformAccountRequest,
} from "@nedia-matrix/account-management";
import type {
  OpenPublicationRequest,
  PreparePublishDraftRequest,
  PublishResultUpdate,
  SelectPublishMediaRequest,
} from "@nedia-matrix/publishing";
import { contextBridge, ipcRenderer } from "electron";

const api: MatrixDesktopApi = {
  checkForApplicationUpdate: () =>
    ipcRenderer.invoke(ipcChannels.checkForApplicationUpdate),
  openApplicationUpdateDownload: (
    request: OpenApplicationUpdateDownloadRequest,
  ) => ipcRenderer.invoke(ipcChannels.openApplicationUpdateDownload, request),
  listPlatforms: () => ipcRenderer.invoke(ipcChannels.listPlatforms),
  listPlatformAccounts: () =>
    ipcRenderer.invoke(ipcChannels.listPlatformAccounts),
  createPlatformAccount: (request: CreatePlatformAccountRequest) =>
    ipcRenderer.invoke(ipcChannels.createPlatformAccount, request),
  openPlatformLogin: (request: OpenPlatformLoginRequest) =>
    ipcRenderer.invoke(ipcChannels.openPlatformLogin, request),
  openPlatformAccount: (request: PlatformAccountRequest) =>
    ipcRenderer.invoke(ipcChannels.openPlatformAccount, request),
  refreshPlatformAccount: (request: PlatformAccountRequest) =>
    ipcRenderer.invoke(ipcChannels.refreshPlatformAccount, request),
  refreshPlatformAccountProfile: (request: PlatformAccountRequest) =>
    ipcRenderer.invoke(ipcChannels.refreshPlatformAccountProfile, request),
  removePlatformAccount: (request: PlatformAccountRequest) =>
    ipcRenderer.invoke(ipcChannels.removePlatformAccount, request),
  onPlatformAccountsChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(ipcChannels.platformAccountsChanged, handler);
    return () =>
      ipcRenderer.removeListener(ipcChannels.platformAccountsChanged, handler);
  },
  listPlatformContents: (request: PlatformAccountRequest) =>
    ipcRenderer.invoke(ipcChannels.listPlatformContents, request),
  refreshPlatformContents: (request: PlatformAccountRequest) =>
    ipcRenderer.invoke(ipcChannels.refreshPlatformContents, request),
  selectPublishMedia: (request: SelectPublishMediaRequest) =>
    ipcRenderer.invoke(ipcChannels.selectPublishMedia, request),
  preparePublishDraft: (request: PreparePublishDraftRequest) =>
    ipcRenderer.invoke(ipcChannels.preparePublishDraft, request),
  listPublications: () => ipcRenderer.invoke(ipcChannels.listPublications),
  openPublicationReview: (request: OpenPublicationRequest) =>
    ipcRenderer.invoke(ipcChannels.openPublicationReview, request),
  openPublication: (request: OpenPublicationRequest) =>
    ipcRenderer.invoke(ipcChannels.openPublication, request),
  onPublishResultUpdate: (listener: (update: PublishResultUpdate) => void) => {
    ipcRenderer.on(ipcChannels.publishResultUpdate, (_event, update) => {
      listener(update as PublishResultUpdate);
    });
  },
  getLocalRuntimeStatus: () =>
    ipcRenderer.invoke(ipcChannels.getLocalRuntimeStatus),
  setLocalRuntimeRunning: (request: SetLocalRuntimeRunningRequest) =>
    ipcRenderer.invoke(ipcChannels.setLocalRuntimeRunning, request),
  openAutomationLogDirectory: () =>
    ipcRenderer.invoke(ipcChannels.openAutomationLogDirectory),
  findAutomationTrace: (request: FindAutomationTraceRequest) =>
    ipcRenderer.invoke(ipcChannels.findAutomationTrace, request),
};

contextBridge.exposeInMainWorld("matrix", Object.freeze(api));
