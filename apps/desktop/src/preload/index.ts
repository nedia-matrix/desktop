import {
  ipcChannels,
  type CreatePlatformAccountRequest,
  type MatrixDesktopApi,
  type OpenPlatformLoginRequest,
  type OpenPublicationRequest,
  type PlatformAccountRequest,
  type PreparePublishDraftRequest,
  type PublishResultUpdate,
  type SelectPublishMediaRequest,
} from "@nedia-matrix/ipc-contracts";
import { contextBridge, ipcRenderer } from "electron";

const api: MatrixDesktopApi = {
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
  removePlatformAccount: (request: PlatformAccountRequest) =>
    ipcRenderer.invoke(ipcChannels.removePlatformAccount, request),
  onPlatformAccountUpdate: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, account: unknown) => {
      listener(account as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(ipcChannels.platformAccountUpdate, handler);
    return () =>
      ipcRenderer.removeListener(ipcChannels.platformAccountUpdate, handler);
  },
  selectPublishMedia: (request: SelectPublishMediaRequest) =>
    ipcRenderer.invoke(ipcChannels.selectPublishMedia, request),
  preparePublishDraft: (request: PreparePublishDraftRequest) =>
    ipcRenderer.invoke(ipcChannels.preparePublishDraft, request),
  listPublications: () => ipcRenderer.invoke(ipcChannels.listPublications),
  openPublication: (request: OpenPublicationRequest) =>
    ipcRenderer.invoke(ipcChannels.openPublication, request),
  onPublishResultUpdate: (listener: (update: PublishResultUpdate) => void) => {
    ipcRenderer.on(ipcChannels.publishResultUpdate, (_event, update) => {
      listener(update as PublishResultUpdate);
    });
  },
  getLocalRuntimeDiagnostics: () =>
    ipcRenderer.invoke(ipcChannels.getLocalRuntimeDiagnostics),
  clearLocalRuntimeRequestLogs: () =>
    ipcRenderer.invoke(ipcChannels.clearLocalRuntimeRequestLogs),
};

contextBridge.exposeInMainWorld("matrix", Object.freeze(api));
