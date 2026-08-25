import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ipcChannels,
  type PublishResultUpdate,
} from "@nedia-matrix/ipc-contracts";
import { BrowserWindow } from "electron";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export class MainWindowHost {
  private window: BrowserWindow | undefined;

  open(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return;
    }

    const window = new BrowserWindow({
      width: 1080,
      height: 720,
      minWidth: 860,
      minHeight: 560,
      show: true,
      title: "NediaMatrix",
      webPreferences: {
        preload: join(currentDirectory, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.window = window;
    window.once("closed", () => {
      if (this.window === window) this.window = undefined;
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    const loading = rendererUrl
      ? window.loadURL(rendererUrl)
      : window.loadFile(join(currentDirectory, "../renderer/index.html"));
    void loading
      .catch((error: unknown) => {
        console.error("Failed to load the desktop renderer", error);
      })
      .finally(() => {
        if (window.isDestroyed()) return;
        window.show();
        window.focus();
      });
  }

  sendPublishResult(update: PublishResultUpdate): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(ipcChannels.publishResultUpdate, update);
  }

  sendAccountsChanged(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send(ipcChannels.platformAccountsChanged);
  }
}
