import { ipcChannels } from "@nedia-matrix/ipc-contracts";
import { ipcMain } from "electron";

import type { AccountApplication } from "./account-application.js";

type AccountIpcApplication = Pick<
  AccountApplication,
  | "listPlatforms"
  | "listAccounts"
  | "createAccount"
  | "openLogin"
  | "openAccount"
  | "refreshAccount"
  | "removeAccount"
>;

export function registerAccountIpcHandlers(
  application: AccountIpcApplication,
): void {
  ipcMain.handle(ipcChannels.listPlatforms, () => application.listPlatforms());
  ipcMain.handle(ipcChannels.listPlatformAccounts, () =>
    application.listAccounts(),
  );
  ipcMain.handle(ipcChannels.createPlatformAccount, (_event, request) =>
    application.createAccount(request),
  );
  ipcMain.handle(ipcChannels.openPlatformLogin, (_event, request) =>
    application.openLogin(request),
  );
  ipcMain.handle(ipcChannels.openPlatformAccount, (_event, request) =>
    application.openAccount(request),
  );
  ipcMain.handle(ipcChannels.refreshPlatformAccount, (_event, request) =>
    application.refreshAccount(request),
  );
  ipcMain.handle(ipcChannels.removePlatformAccount, (_event, request) =>
    application.removeAccount(request),
  );
}
