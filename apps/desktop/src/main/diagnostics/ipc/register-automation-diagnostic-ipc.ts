import { mkdir } from "node:fs/promises";
import type {
  AutomationTraceReference,
  FindAutomationTraceRequest,
} from "../../../bridge/contracts.js";
import { ipcChannels } from "../../../bridge/channels.js";
import { ipcMain, shell } from "electron";

interface AutomationDiagnosticIpcDependencies {
  readonly logDirectory: string;
  findTraceForPublication(publicationId: string): Promise<string | null>;
}

export function registerAutomationDiagnosticIpc(
  dependencies: AutomationDiagnosticIpcDependencies,
): void {
  ipcMain.handle(ipcChannels.openAutomationLogDirectory, async () => {
    await mkdir(dependencies.logDirectory, { recursive: true });
    const error = await shell.openPath(dependencies.logDirectory);
    if (error) throw new Error(error);
  });
  ipcMain.handle(
    ipcChannels.findAutomationTrace,
    async (
      _event,
      request: FindAutomationTraceRequest,
    ): Promise<AutomationTraceReference | null> => {
      if (
        typeof request?.publicationId !== "string" ||
        !/^[A-Za-z0-9._~-]{1,128}$/.test(request.publicationId)
      ) {
        throw new TypeError("Invalid publication ID");
      }
      const traceId = await dependencies.findTraceForPublication(
        request.publicationId,
      );
      return traceId ? { traceId } : null;
    },
  );
}
