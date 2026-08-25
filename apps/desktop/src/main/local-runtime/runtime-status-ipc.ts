import {
  ipcChannels,
  type SetLocalRuntimeRunningRequest,
} from "@nedia-matrix/ipc-contracts";
import { ipcMain } from "electron";

import type { LocalRuntimeServer } from "./local-runtime-server.js";

export function registerRuntimeStatusIpcHandler(
  server: LocalRuntimeServer,
): void {
  ipcMain.handle(ipcChannels.getLocalRuntimeStatus, () => server.status());
  ipcMain.handle(
    ipcChannels.setLocalRuntimeRunning,
    async (_event, request: SetLocalRuntimeRunningRequest) => {
      if (typeof request?.running !== "boolean") {
        throw new TypeError("Local runtime running state must be a boolean");
      }
      if (request.running) await server.start();
      else await server.stop();
      return server.status();
    },
  );
}
