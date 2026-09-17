import { randomUUID } from "node:crypto";
import path from "node:path";

import type { AccountRepository } from "@nedia-matrix/account-management";
import type { PublicationRepository } from "@nedia-matrix/publishing";
import {
  AccountPublicationLock,
  PublishingService,
  toPublishResultUpdate,
} from "@nedia-matrix/publishing";
import { app, dialog } from "electron";
import { openDesktopMetadata } from "../persistence/open-desktop-metadata.js";
import { AutomationTraceService } from "../diagnostics/automation-trace-service.js";
import { JsonlAutomationLogSink } from "../diagnostics/jsonl-automation-log-sink.js";
import { registerAutomationDiagnosticIpc } from "../diagnostics/ipc/register-automation-diagnostic-ipc.js";
import type { PublicationObservationInbox } from "../publishing/observations/publication-observation-inbox.js";

import { cleanupClosedBrowserSession } from "../accounts/application/account-resource-cleanup.js";
import { PlaywrightBrowserSessionHost } from "../accounts/infrastructure/playwright-browser-session-host.js";
import { registerAccountIpcHandlers } from "../accounts/ipc/register-account-ipc-handlers.js";
import {
  NediaMatrixApplication,
  type DesktopEventSink,
} from "../application/nedia-matrix-application.js";
import { desktopPlatformCatalog } from "../platforms/platform-registry.js";
import { ContentAddressedPublicationAssetStore } from "../publishing/infrastructure/content-addressed-asset-store.js";
import { MediaSelectionStore } from "../publishing/infrastructure/media-selection-store.js";
import { RemoteAssetDownloader } from "../publishing/infrastructure/remote-asset-downloader.js";
import { registerPublicationIpcHandlers } from "../publishing/ipc/register-publication-ipc-handlers.js";
import { registerPlatformContentIpcHandlers } from "../platform-content/ipc/register-platform-content-ipc-handlers.js";
import { PublicationObservationQueue } from "../publishing/observations/publication-observation-queue.js";
import { PublishObservationManager } from "../publishing/observations/publish-observation-manager.js";
import {
  LocalRuntimeHttpServer,
  readLocalRuntimePort,
} from "../runtime-api/http/local-runtime-http-server.js";
import { registerRuntimeStatusIpcHandler } from "../runtime-api/ipc/register-runtime-status-ipc.js";
import { installApplicationMenu } from "../shell/menu/application-menu.js";
import { NEDIA_MATRIX_PROTOCOL } from "../shell/protocol/custom-protocol.js";
import { ApplicationTray } from "../shell/tray/application-tray.js";
import { ElectronMainWindow } from "../shell/window/electron-main-window.js";
import {
  checkForApplicationUpdateNow,
  openApplicationUpdateDownload,
} from "../updates/electron-application-update.js";
import { registerApplicationUpdateIpcHandler } from "../updates/register-application-update-ipc.js";
import { ApplicationLifecycle } from "./application-lifecycle.js";
import { shutdownDesktopRuntime, waitForShutdown } from "./runtime-cleanup.js";

import { ElectronAutomationNotices } from "../shell/notifications/electron-automation-notices.js";

const SHUTDOWN_TIMEOUT_MS = 5_000;
const OBSERVATION_RETRY_INTERVAL_MS = 5_000;

export class DesktopRuntime {
  private readonly accountStore: AccountRepository;
  private readonly metadata: ReturnType<typeof openDesktopMetadata>;
  private readonly accountPublications = new AccountPublicationLock();
  private readonly mediaSelections = new MediaSelectionStore();
  private readonly mainWindow = new ElectronMainWindow();
  private readonly publicationRepository: PublicationRepository;
  private readonly publicationObservationInbox: PublicationObservationInbox;
  private readonly publishing: PublishingService;
  private readonly lifecycle = new ApplicationLifecycle();
  private readonly publicationObservations: PublicationObservationQueue;
  private readonly publishObservations: PublishObservationManager;
  private readonly browserSessions: PlaywrightBrowserSessionHost;
  private readonly automationTraces: AutomationTraceService;

  private application: NediaMatrixApplication | undefined;
  private applicationTray: ApplicationTray | undefined;
  private localRuntimeServer: LocalRuntimeHttpServer | null = null;
  private publicationRetryTimer: ReturnType<typeof setInterval> | undefined;
  private quitAllowed = false;

  constructor() {
    const userDataDirectory = app.getPath("userData");
    this.metadata = openDesktopMetadata(userDataDirectory);
    this.accountStore = this.metadata.accounts;
    this.publicationRepository = this.metadata.publications;
    this.publicationObservationInbox = this.metadata.inbox;
    this.publishing = new PublishingService(
      this.publicationRepository,
      { now: () => new Date() },
      { create: () => randomUUID() },
    );
    let traceService: AutomationTraceService | undefined;
    const automationLogSink = new JsonlAutomationLogSink({
      directory: path.join(userDataDirectory, "automation-logs"),
      evidenceDirectory: path.join(userDataDirectory, "automation-evidence"),
      protectedTraceIds: () => traceService?.activeTraceIds() ?? new Set(),
      onRecordsDropped: (traceId, counts) =>
        traceService?.reportDroppedRecords(traceId, counts),
      onError: (error) =>
        console.error(
          "Automation diagnostics unavailable",
          error instanceof Error ? error.name : "UnknownError",
        ),
    });
    traceService = new AutomationTraceService(automationLogSink);
    this.automationTraces = traceService;
    this.publicationObservations = new PublicationObservationQueue(
      {
        recordObservation: (
          publicationId,
          result,
          sequence,
          expectedIdentity,
        ) => {
          if (!this.application) {
            throw new Error("Application is not initialized");
          }
          return this.publishing.recordObservation(
            publicationId,
            result,
            sequence,
            expectedIdentity,
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
      (error) =>
        console.error(
          "Failed to persist publish observation",
          error instanceof Error ? error.name : "UnknownError",
        ),
      (operation) => this.metadata.database.transaction(operation),
    );
    this.publishObservations = new PublishObservationManager((event) => {
      return this.publicationObservations.accept(event);
    });
    this.browserSessions = new PlaywrightBrowserSessionHost(
      (accountId) => {
        cleanupClosedBrowserSession(accountId, {
          mediaSelections: this.mediaSelections,
          publishObservations: this.publishObservations,
        });
      },
      undefined,
      () => {
        void dialog.showMessageBox({
          type: "info",
          title: "发布页面已打开新标签页",
          message:
            "请在原发布页完成提交。新标签页中的提交不属于当前任务的结果观察范围；如已在新标签页提交，请先核实平台结果，不要重复发布。",
        });
      },
    );
  }

  get canQuit(): boolean {
    return this.quitAllowed;
  }

  start(): void {
    const report = this.metadata.importReport;
    if (report && (report.missingAssets || report.missingActiveProfiles)) {
      dialog.showErrorBox(
        "本地历史资源缺失",
        `元数据已导入，检测到 ${report.missingAssets} 个素材引用和 ${report.missingActiveProfiles} 个已确认账号的浏览器目录缺失。历史记录已保留；账号可能需要重新登录，缺失素材不会自动下载或重新发布。`,
      );
    }
    const publicationAssetStore = new ContentAddressedPublicationAssetStore(
      path.join(app.getPath("userData"), "assets"),
    );
    const remoteAssets = new RemoteAssetDownloader({
      assetStore: publicationAssetStore,
      stagingRoot: path.join(app.getPath("userData"), "staging"),
    });
    const dependencies = {
      platforms: desktopPlatformCatalog,
      runtime: {
        status: () =>
          this.localRuntimeServer?.status() ?? {
            status: "stopped" as const,
            version: app.getVersion(),
            host: "127.0.0.1" as const,
            port: null,
          },
        setRunning: async (request: { running: boolean }) => {
          const server = this.localRuntimeServer;
          if (!server) throw new Error("Local runtime is not initialized");
          if (request.running) await server.start();
          else await server.stop();
          return server.status();
        },
      },
      updates: {
        check: () => checkForApplicationUpdateNow(),
        openDownload: (request: { version: string }) =>
          openApplicationUpdateDownload(request.version),
      },
      notices: new ElectronAutomationNotices(async (accountId) => {
        const account = this.accountStore.get(accountId);
        if (!account) return;
        const lease = this.accountPublications.acquire(accountId);
        if (!lease) throw new Error("Account has an active publication");
        try {
          await this.browserSessions.closeAutomation(account);
        } finally {
          lease.release();
        }
      }),
      automationDiagnostics: this.automationTraces,
      accountPublications: this.accountPublications,
      accountStore: this.accountStore,
      platformContents: this.metadata.platformContents,
      browserSessions: this.browserSessions,
      mediaSelections: this.mediaSelections,
      publishObservations: this.publishObservations,
      publishing: this.publishing,
      remoteAssets,
      removeAccountResources: async (
        account: Parameters<PlaywrightBrowserSessionHost["remove"]>[0],
      ) => {
        const lease = this.accountPublications.acquire(account.id);
        if (!lease) throw new Error("Account has an active publication");
        try {
          await this.publishObservations.stop(account.id);
          await this.browserSessions.closeAutomation(account);
          this.metadata.accounts.removeWithProfileIntent(account.id);
          this.mediaSelections.removeForAccount(account.id);
          this.mainWindow.sendAccountsChanged();
          this.localRuntimeServer?.publishAccountsChanged();
          try {
            if (this.accountStore.hasProfileReference(account.profileId))
              throw new Error("Profile is still referenced");
            await this.browserSessions.removeProfile(account.profileId);
            this.accountStore.discardRetiredProfile(account.profileId);
          } catch {
            throw new Error(
              "账号已删除，浏览器资源清理待重试；下次启动将继续清理",
            );
          }
        } finally {
          lease.release();
        }
      },
      eventSink: {
        publish: (event) => {
          if (event.type === "accounts.changed") {
            this.mainWindow.sendAccountsChanged();
            this.localRuntimeServer?.publishAccountsChanged();
          }
        },
      } satisfies DesktopEventSink,
    };
    this.application = new NediaMatrixApplication(dependencies);
    this.publicationObservations.replayPersisted();
    this.application.publications.recoverInterrupted();
    void this.application.accounts.cleanupRetiredProfiles().catch(() => {
      console.error("Failed to clean up retired browser profiles");
    });
    registerAccountIpcHandlers(this.application);
    registerPlatformContentIpcHandlers(this.application);
    registerPublicationIpcHandlers({
      ...dependencies,
      application: this.application,
    });
    registerApplicationUpdateIpcHandler(this.application);
    registerAutomationDiagnosticIpc({
      logDirectory: path.join(app.getPath("userData"), "automation-logs"),
      findTraceForPublication: (publicationId) =>
        this.automationTraces.findTraceForPublication(publicationId),
    });

    this.registerCustomProtocol();
    this.localRuntimeServer = this.createLocalRuntimeServer(this.application);
    registerRuntimeStatusIpcHandler(this.application);
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
    const shutdown = Promise.all([
      (this.application?.stopCommands() ?? Promise.resolve()).then(() =>
        shutdownDesktopRuntime({
          browserSessions: this.browserSessions,
          mediaSelections: this.mediaSelections,
          publishObservations: this.publishObservations,
          diagnostics: this.automationTraces,
        }),
      ),
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
        if (this.publicationRetryTimer)
          clearInterval(this.publicationRetryTimer);
        this.applicationTray?.destroy();
        this.quitAllowed = true;
        // Exit synchronously after closing: no async cleanup callback may run
        // against the closed connection. Interrupted work recovers next launch.
        this.metadata.database.close();
        app.exit(0);
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
    application: NediaMatrixApplication,
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
          platformIdentityAddressing: true,
          platformContentSnapshots: true,
          platformContentSync: true,
        },
      },
    });
  }
}
