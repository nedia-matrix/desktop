import { app, dialog } from "electron";

import {
  findNediaMatrixOpenUrl,
  isNediaMatrixOpenUrl,
} from "../shell/protocol/custom-protocol.js";
import { DesktopRuntime } from "./desktop-runtime.js";

let desktopRuntime: DesktopRuntime | undefined;

function acceptOpenUrl(value: string): void {
  if (!isNediaMatrixOpenUrl(value)) {
    console.warn("Ignored invalid nedia-matrix protocol URL");
    return;
  }
  desktopRuntime?.openMainWindow();
}

app.on("open-url", (event, value) => {
  event.preventDefault();
  acceptOpenUrl(value);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.exit(0);
} else {
  app.on("second-instance", (_event, commandLine) => {
    const openUrl = findNediaMatrixOpenUrl(commandLine);
    if (openUrl) acceptOpenUrl(openUrl);
    desktopRuntime?.openMainWindow();
  });
}

void (hasSingleInstanceLock ? app.whenReady() : Promise.resolve())
  .then(() => {
    if (!hasSingleInstanceLock) return;
    desktopRuntime = new DesktopRuntime();
    desktopRuntime.start();
    const initialOpenUrl = findNediaMatrixOpenUrl(process.argv);
    if (initialOpenUrl) acceptOpenUrl(initialOpenUrl);
    desktopRuntime.openMainWindow();
    app.on("activate", () => desktopRuntime?.openMainWindow());
  })
  .catch((error: unknown) => {
    console.error(
      "Failed to initialize Electron",
      error instanceof Error ? error.name : "UnknownError",
    );
    dialog.showErrorBox(
      "本地数据恢复失败",
      "应用未能完成启动，业务入口尚未开放。请退出后重新启动以重试；若问题持续，请保留本地数据并联系支持。请勿重复发布。",
    );
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform === "darwin") app.dock?.hide();
});

app.on("before-quit", (event) => {
  if (!desktopRuntime || desktopRuntime.canQuit) return;
  event.preventDefault();
  desktopRuntime.requestQuit();
});
