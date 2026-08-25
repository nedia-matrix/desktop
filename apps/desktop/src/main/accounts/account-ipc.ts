import { ipcChannels } from "@nedia-matrix/ipc-contracts";
import { ipcMain } from "electron";

import type { NediaMatrixUseCases } from "../application/nedia-matrix-application.js";

type AccountIpcApplication = Pick<NediaMatrixUseCases, "accounts">;

export function registerAccountIpcHandlers(
  application: AccountIpcApplication,
): void {
  ipcMain.handle(ipcChannels.listPlatforms, () =>
    application.accounts.listPlatforms(),
  );
  ipcMain.handle(ipcChannels.listPlatformAccounts, () =>
    application.accounts.list(),
  );
  ipcMain.handle(ipcChannels.createPlatformAccount, (_event, request) =>
    application.accounts.create(request),
  );
  ipcMain.handle(ipcChannels.openPlatformLogin, (_event, request) =>
    application.accounts.openLogin(request),
  );
  ipcMain.handle(ipcChannels.openPlatformAccount, (_event, request) =>
    application.accounts.open(request),
  );
  ipcMain.handle(ipcChannels.refreshPlatformAccount, (_event, request) =>
    application.accounts.refresh(request),
  );
  ipcMain.handle(ipcChannels.removePlatformAccount, (_event, request) =>
    application.accounts.remove(request),
  );
}
