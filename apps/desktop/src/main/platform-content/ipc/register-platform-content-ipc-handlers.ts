import { ipcMain } from "electron";

import { ipcChannels } from "../../../bridge/channels.js";
import type { NediaMatrixUseCases } from "../../application/nedia-matrix-application.js";

type PlatformContentIpcApplication = Pick<
  NediaMatrixUseCases,
  "platformContents"
>;

export function registerPlatformContentIpcHandlers(
  application: PlatformContentIpcApplication,
): void {
  ipcMain.handle(ipcChannels.listPlatformContents, (_event, request) => ({
    items: application.platformContents.list(request.accountId),
    latestRun:
      application.platformContents.latestRun(request.accountId) ?? null,
  }));
  ipcMain.handle(ipcChannels.refreshPlatformContents, (_event, request) =>
    application.platformContents.refresh(request.accountId),
  );
}
