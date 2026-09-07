import { randomUUID } from "node:crypto";
import path from "node:path";

import { PublishingService } from "@nedia-matrix/application-publishing";
import { app } from "electron";

import { registerAccountIpcHandlers } from "../accounts/ipc/register-account-ipc-handlers.js";
import { cleanupClosedBrowserSession } from "../accounts/public.js";
import { ElectronAccountRepository } from "../accounts/infrastructure/electron-account-repository.js";
import { PlaywrightBrowserSessionHost } from "../accounts/infrastructure/playwright-browser-session-host.js";
import {
  DesktopApplication,
  type DesktopEventSink,
} from "../application/desktop-application.js";
import { AccountPublicationLock } from "../publishing/application/account-publication-lock.js";
import { ContentAddressedPublicationAssetStore } from "../publishing/infrastructure/content-addressed-asset-store.js";
import { MediaSelectionStore } from "../publishing/infrastructure/media-selection-store.js";
import { ElectronPublicationRepository } from "../publishing/infrastructure/electron-publication-repository.js";
import { ElectronPublicationObservationInbox } from "../publishing/infrastructure/electron-publication-observation-inbox.js";
import { RemoteAssetDownloader } from "../publishing/infrastructure/remote-asset-downloader.js";
import { registerPublicationIpcHandlers } from "../publishing/ipc/register-publication-ipc-handlers.js";
import { PublicationObservationQueue } from "../publishing/observations/publication-observation-queue.js";
import {
  PublishObservationManager,
  toPublishResultUpdate,
} from "../publishing/observations/publish-observation-manager.js";
import { ElectronRuntimeBindingRepository } from "../runtime-api/infrastructure/electron-runtime-binding-repository.js";
import {
  LocalRuntimeHttpServer,
  readLocalRuntimePort,
} from "../runtime-api/http/local-runtime-http-server.js";
import { registerRuntimeStatusIpcHandler } from "../runtime-api/ipc/register-runtime-status-ipc.js";
import { installApplicationMenu } from "../shell/menu/application-menu.js";
import { NEDIA_MATRIX_PROTOCOL } from "../shell/protocol/custom-protocol.js";
import { ApplicationTray } from "../shell/tray/application-tray.js";
import { ElectronMainWindow } from "../shell/window/electron-main-window.js";
import { ApplicationLifecycle } from "./application-lifecycle.js";
import { shutdownDesktopRuntime, waitForShutdown } from "./runtime-cleanup.js";

const SHUTDOWN_TIMEOUT_MS = 5_000;
const OBSERVATION_RETRY_INTERVAL_MS = 5_000;

export class DesktopRuntime {
  private readonly accountStore = new ElectronAccountRepository();
  private readonly accountPublications = new AccountPublicationLock();
  private readonly mediaSelections = new MediaSelectionStore();
  private readonly mainWindow = new ElectronMainWindow();
  private readonly publicationRepository = new ElectronPublicationRepository();
  private readonly publicationObservationInbox =
    new ElectronPublicationObservationInbox();
  private readonly runtimeAccountBindings =
    new ElectronRuntimeBindingRepository();
  private readonly publishing = new PublishingService(
    this.publicationRepository,
    { now: () => new Date() },
    { create: () => randomUUID() },
  );
  private readonly lifecycle = new ApplicationLifecycle();
  private readonly publicationObservations: PublicationObservationQueue;
  private readonly publishObservations: PublishObservationManager;
  private readonly browserSessions: PlaywrightBrowserSessionHost;

  private application: DesktopApplication | undefined;
  private applicationTray: ApplicationTray | undefined;
  private localRuntimeServer: LocalRuntimeHttpServer | null = null;
  private publicationRetryTimer: ReturnType<typeof setInterval> | undefined;
  private quitAllowed = false;

  constructor() {
    this.publicationObservations = new PublicationObservationQueue(
      {
        recordObservation: (publicationId, result, sequence) => {
          if (!this.application) {
            throw new Error("Application is not initialized");
          }
          return this.application.publications.recordObservation(
            publicationId,
            result,
            sequence,
          );
        },
      },
      this.publicationObservationInbox,
      (event) => {
        this.mainWindow.sendPublishResult(toPublishResultUpdate(event));
        this.localRuntimeServer?.publishPublicationUpdate(event.publicationId);
      },
      (event) => {
        this.mainWindow.sendPublishResult({
          ...toPublishResultUpdate(event),
          status: "uncertain",
          message:
            "平台结果已捕获，但本地发布历史保存失败，正在重试；请勿重复发布",
        });
      },
      (error) => console.error("Failed to persist publish observation", error),
    );
    this.publishObservations = new PublishObservationManager((event) => {
      return this.publicationObservations.accept(event);
    });
    this.browserSessions = new PlaywrightBrowserSessionHost((accountId) => {
      cleanupClosedBrowserSession(accountId, {
        mediaSelections: this.mediaSelections,
        publishObservations: this.publishObservations,
      });
    });
  }

  get canQuit(): boolean {
    return this.quitAllowed;
  }

  start(): void {
    const publicationAssetStore = new ContentAddressedPublicationAssetStore(
      path.join(app.getPath("userData"), "assets"),
    );
    const remoteAssets = new RemoteAssetDownloader({
      assetStore: publicationAssetStore,
      stagingRoot: path.join(app.getPath("userData"), "staging"),
    });
    const dependencies = {
      accountPublications: this.accountPublications,
      accountStore: this.accountStore,
      accountBindings: this.runtimeAccountBindings,
      browserSessions: this.browserSessions,
      mediaSelections: this.mediaSelections,
      publishObservations: this.publishObservations,
      publishing: this.publishing,
      remoteAssets,
      eventSink: {
        publish: (event) => {
          if (event.type === "accounts.changed") {
            this.mainWindow.sendAccountsChanged();
            this.localRuntimeServer?.publishAccountsChanged();
          }
        },
      } satisfies DesktopEventSink,
    };
    this.application = new DesktopApplication(dependencies);
    void this.application.accounts.cleanupRetiredProfiles().catch((error) => {
      console.error("Failed to clean up retired browser profiles", error);
    });
    this.publicationObservations.replayPersisted();
    this.application.publications.recoverInterrupted();
    registerAccountIpcHandlers(this.application);
    registerPublicationIpcHandlers({
      ...dependencies,
      application: this.application,
    });

    this.registerCustomProtocol();
    this.localRuntimeServer = this.createLocalRuntimeServer(this.application);
    registerRuntimeStatusIpcHandler(this.localRuntimeServer);
    void this.localRuntimeServer.start().catch((error: unknown) => {
      console.error("Failed to start local runtime server", error);
    });

    installApplicationMenu({ quitApplication: () => this.requestQuit() });
    this.applicationTray = new ApplicationTray({
      openMainWindow: () => this.openMainWindow(),
      quitApplication: () => this.requestQuit(),
    });
    this.publicationRetryTimer = setInterval(
      () => this.publicationObservations.retryPending(),
      OBSERVATION_RETRY_INTERVAL_MS,
    );
    this.publicationRetryTimer.unref();
  }

  openMainWindow(): void {
    if (this.lifecycle.requestWindowOpen() === "ignore-during-shutdown") return;
    if (process.platform === "darwin") {
      const dock = app.dock;
      if (dock && !dock.isVisible()) {
        void dock.show().catch((error: unknown) => {
          console.error("Failed to show the application in the Dock", error);
        });
      }
    }
    this.mainWindow.open();
  }

  requestQuit(): void {
    if (!this.lifecycle.beginShutdown()) return;
    this.publicationObservations.retryPending();
    if (this.publicationRetryTimer) {
      clearInterval(this.publicationRetryTimer);
      this.publicationRetryTimer = undefined;
    }
    const shutdown = Promise.all([
      shutdownDesktopRuntime({
        browserSessions: this.browserSessions,
        mediaSelections: this.mediaSelections,
        publishObservations: this.publishObservations,
      }),
      this.localRuntimeServer?.stop(),
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
        this.applicationTray?.destroy();
        this.quitAllowed = true;
        app.quit();
      });
  }

  private registerCustomProtocol(): void {
    const registered =
      process.defaultApp && process.argv[1]
        ? app.setAsDefaultProtocolClient(
            NEDIA_MATRIX_PROTOCOL,
            process.execPath,
            [path.resolve(process.argv[1])],
          )
        : app.setAsDefaultProtocolClient(NEDIA_MATRIX_PROTOCOL);
    if (!registered) {
      console.warn("Failed to register nedia-matrix protocol handler");
    }
  }

  private createLocalRuntimeServer(
    application: DesktopApplication,
  ): LocalRuntimeHttpServer {
    return new LocalRuntimeHttpServer({
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
  }
}
