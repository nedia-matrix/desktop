import { app } from "electron";

import {
  findNediaMatrixOpenUrl,
  isNediaMatrixOpenUrl,
} from "../shell/protocol/custom-protocol.js";
import { DesktopRuntime } from "./desktop-runtime.js";

const desktopRuntime = new DesktopRuntime();

function acceptOpenUrl(value: string): void {
  if (!isNediaMatrixOpenUrl(value)) {
    console.warn("Ignored invalid nedia-matrix protocol URL");
    return;
  }
  if (app.isReady()) desktopRuntime.openMainWindow();
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
    if (app.isReady()) desktopRuntime.openMainWindow();
  });
}

void (hasSingleInstanceLock ? app.whenReady() : Promise.resolve())
  .then(() => {
    if (!hasSingleInstanceLock) return;
    desktopRuntime.start();
    const initialOpenUrl = findNediaMatrixOpenUrl(process.argv);
    if (initialOpenUrl) acceptOpenUrl(initialOpenUrl);
    desktopRuntime.openMainWindow();
    app.on("activate", () => desktopRuntime.openMainWindow());
  })
  .catch((error: unknown) => {
    console.error("Failed to initialize Electron", error);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform === "darwin") app.dock?.hide();
});

app.on("before-quit", (event) => {
  if (desktopRuntime.canQuit) return;
  event.preventDefault();
  desktopRuntime.requestQuit();
});
