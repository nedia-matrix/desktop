import { randomUUID } from "node:crypto";
import path from "node:path";

import { PublishingService } from "@nedia-matrix/application-publishing";
import { app } from "electron";

import { registerAccountIpcHandlers } from "./accounts/account-ipc.js";
import { PlatformAccountStore } from "./accounts/account-store.js";
import { BrowserProfileHost } from "./accounts/browser-session-host.js";
import {
  NediaMatrixApplication,
  type ApplicationEventSink,
} from "./application/nedia-matrix-application.js";
import { ApplicationLifecycle } from "./application-lifecycle.js";
import { installApplicationMenu } from "./application-menu.js";
import { ApplicationTray } from "./application-tray.js";
import { MainWindowHost } from "./main-window-host.js";
import {
  findNediaMatrixOpenUrl,
  isNediaMatrixOpenUrl,
  NEDIA_MATRIX_PROTOCOL,
} from "./local-runtime/custom-protocol.js";
import {
  LocalRuntimeServer,
  readLocalRuntimePort,
} from "./local-runtime/local-runtime-server.js";
import { registerRuntimeStatusIpcHandler } from "./local-runtime/runtime-status-ipc.js";
import { RuntimeAccountBindingStore } from "./local-runtime/runtime-account-binding-store.js";
import { AccountPublicationLock } from "./publishing/account-publication-lock.js";
import { MediaSelectionStore } from "./publishing/media-selection-store.js";
import { ContentAddressedPublicationAssetStore } from "./publishing/publication-asset-store.js";
import { PublicationObservationSink } from "./publishing/publication-observation-sink.js";
import { ElectronPublicationRepository } from "./publishing/publication-store.js";
import {
  PublishObservationHost,
  toPublishResultUpdate,
} from "./publishing/publish-observation-host.js";
import { registerPublishIpcHandlers } from "./publishing/publish-ipc.js";
import { RemoteAssetDownloader } from "./publishing/remote-asset-downloader.js";
import {
  cleanupClosedBrowserSession,
  shutdownDesktopRuntime,
  waitForShutdown,
} from "./runtime-cleanup.js";

const accountStore = new PlatformAccountStore();
const accountPublications = new AccountPublicationLock();
const mediaSelections = new MediaSelectionStore();
const mainWindow = new MainWindowHost();
const publicationRepository = new ElectronPublicationRepository();
const runtimeAccountBindings = new RuntimeAccountBindingStore();
const publishing = new PublishingService(
  publicationRepository,
  { now: () => new Date() },
  { create: () => randomUUID() },
);
let application: NediaMatrixApplication | undefined;
let applicationTray: ApplicationTray | undefined;
const publicationObservations = new PublicationObservationSink(
  {
    recordObservation: (publicationId, result) => {
      if (!application) throw new Error("Application is not initialized");
      return application.publications.recordObservation(publicationId, result);
    },
  },
  (event) => {
    mainWindow.sendPublishResult(toPublishResultUpdate(event));
    localRuntimeServer?.publishPublicationUpdate(event.publicationId);
  },
  (event) => {
    mainWindow.sendPublishResult({
      ...toPublishResultUpdate(event),
      status: "uncertain",
      message: "平台结果已捕获，但本地发布历史保存失败，正在重试；请勿重复发布",
    });
  },
  (error) => console.error("Failed to persist publish observation", error),
);
const publishObservations = new PublishObservationHost((event) => {
  publicationObservations.accept(event);
});
const browserSessions = new BrowserProfileHost((accountId) => {
  cleanupClosedBrowserSession(accountId, {
    mediaSelections,
    publishObservations,
  });
});

let localRuntimeServer: LocalRuntimeServer | null = null;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const applicationLifecycle = new ApplicationLifecycle();
let quitAllowed = false;

function showDockIcon(): void {
  if (process.platform !== "darwin") return;
  const dock = app.dock;
  if (!dock || dock.isVisible()) return;
  void dock.show().catch((error: unknown) => {
    console.error("Failed to show the application in the Dock", error);
  });
}

function hideDockIcon(): void {
  if (process.platform !== "darwin") return;
  app.dock?.hide();
}

function openMainWindow(): void {
  if (applicationLifecycle.requestWindowOpen() === "ignore-during-shutdown") {
    return;
  }
  showDockIcon();
  mainWindow.open();
}

function acceptOpenUrl(value: string): void {
  if (!isNediaMatrixOpenUrl(value)) {
    console.warn("Ignored invalid nedia-matrix protocol URL");
    return;
  }
  if (app.isReady()) openMainWindow();
}

app.on("open-url", (event, value) => {
  event.preventDefault();
  acceptOpenUrl(value);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  // This process has already notified the primary instance. It must not remain as
  // a ready-less Electron process with no window, tray, or local runtime.
  app.exit(0);
} else {
  app.on("second-instance", (_event, commandLine) => {
    const openUrl = findNediaMatrixOpenUrl(commandLine);
    if (openUrl) acceptOpenUrl(openUrl);
    if (app.isReady()) openMainWindow();
  });
}

const publicationRetryTimer = setInterval(
  () => publicationObservations.retryPending(),
  5_000,
);
publicationRetryTimer.unref();

function requestApplicationQuit(): void {
  if (!applicationLifecycle.beginShutdown()) return;
  publicationObservations.retryPending();
  clearInterval(publicationRetryTimer);
  const shutdown = Promise.all([
    shutdownDesktopRuntime({
      browserSessions,
      mediaSelections,
      publishObservations,
    }),
    localRuntimeServer?.stop(),
  ]).then(() => undefined);

  void waitForShutdown(shutdown, SHUTDOWN_TIMEOUT_MS)
    .then((result) => {
      if (result === "timed-out") {
        console.warn(
          `Desktop shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms; quitting without waiting for remaining cleanup`,
        );
      }
    })
    .catch((error: unknown) => {
      console.error("Failed to cleanly shut down desktop runtime", error);
    })
    .finally(() => {
      applicationTray?.destroy();
      quitAllowed = true;
      app.quit();
    });
}

void (hasSingleInstanceLock ? app.whenReady() : Promise.resolve())
  .then(() => {
    if (!hasSingleInstanceLock) return;
    const publicationAssetStore = new ContentAddressedPublicationAssetStore(
      path.join(app.getPath("userData"), "assets"),
    );
    const remoteAssets = new RemoteAssetDownloader({
      assetStore: publicationAssetStore,
      stagingRoot: path.join(app.getPath("userData"), "staging"),
    });
    const dependencies = {
      accountPublications,
      accountStore,
      accountBindings: runtimeAccountBindings,
      browserSessions,
      mediaSelections,
      publishObservations,
      publishing,
      remoteAssets,
      eventSink: {
        publish: (event) => {
          if (event.type === "accounts.changed") {
            mainWindow.sendAccountsChanged();
            localRuntimeServer?.publishAccountsChanged();
          }
        },
      } satisfies ApplicationEventSink,
    };
    application = new NediaMatrixApplication(dependencies);
    void application.accounts.cleanupRetiredProfiles().catch((error) => {
      console.error("Failed to clean up retired browser profiles", error);
    });
    application.publications.recoverInterrupted();
    registerAccountIpcHandlers(application);
    registerPublishIpcHandlers({
      ...dependencies,
      application,
    });

    const protocolRegistered =
      process.defaultApp && process.argv[1]
        ? app.setAsDefaultProtocolClient(
            NEDIA_MATRIX_PROTOCOL,
            process.execPath,
            [path.resolve(process.argv[1])],
          )
        : app.setAsDefaultProtocolClient(NEDIA_MATRIX_PROTOCOL);
    if (!protocolRegistered) {
      console.warn("Failed to register nedia-matrix protocol handler");
    }

    localRuntimeServer = new LocalRuntimeServer({
      application,
      port: readLocalRuntimePort(process.env.MATRIX_RUNTIME_PORT),
      handshake: {
        protocolVersion: 1,
        runtimeKind: "desktop_playwright",
        runtimeVersion: app.getVersion(),
        instanceId: randomUUID(),
        supportedTargets: [
          { platform: "douyin", contentForm: "image_text" },
          { platform: "douyin", contentForm: "video" },
          { platform: "xiaohongshu", contentForm: "image_text" },
          { platform: "xiaohongshu", contentForm: "video" },
        ],
        capabilities: {
          isolatedAccounts: true,
          multipleAccountsPerPlatform: true,
          backgroundObservation: true,
          localPublicationArchive: true,
        },
      },
    });
    registerRuntimeStatusIpcHandler(localRuntimeServer);
    void localRuntimeServer.start().catch((error: unknown) => {
      console.error("Failed to start local runtime server", error);
    });

    installApplicationMenu({ quitApplication: requestApplicationQuit });
    applicationTray = new ApplicationTray({
      openMainWindow,
      quitApplication: requestApplicationQuit,
    });

    const initialOpenUrl = findNediaMatrixOpenUrl(process.argv);
    if (initialOpenUrl) acceptOpenUrl(initialOpenUrl);
    openMainWindow();
    app.on("activate", openMainWindow);
  })
  .catch((error: unknown) => {
    console.error("Failed to initialize Electron", error);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  hideDockIcon();
});

app.on("before-quit", (event) => {
  if (quitAllowed) return;
  event.preventDefault();
  requestApplicationQuit();
});
