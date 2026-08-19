import { ipcChannels } from "@nedia-matrix/ipc-contracts";
import { ipcMain } from "electron";

import type { LocalRuntimeServer } from "./local-runtime-server.js";

export function registerRuntimeDiagnosticsIpcHandlers(
  server: LocalRuntimeServer,
): void {
  ipcMain.handle(ipcChannels.getLocalRuntimeDiagnostics, () =>
    server.diagnostics(),
  );
  ipcMain.handle(ipcChannels.clearLocalRuntimeRequestLogs, () => {
    server.clearRequestLogs();
  });
}
