import { randomUUID } from "node:crypto";

import {
  AutomationError,
  detectPlatformSession,
  executeWorkflow,
} from "@nedia-matrix/automation-engine";
import type { PublishingService } from "@nedia-matrix/application-publishing";
import type { PreparePublishDraftRequest } from "@nedia-matrix/ipc-contracts";
import {
  composePublishDescription,
  preparePublishText,
} from "@nedia-matrix/platform-core";

import type { PlatformAccountStore } from "../accounts/account-store.js";
import { assertAccountRequest } from "../accounts/account-request-validation.js";
import type { BrowserProfileHost } from "../accounts/browser-session-host.js";
import type { AccountPublicationLock } from "./account-publication-lock.js";
import {
  MediaSelectionUnavailableError,
  type MediaSelectionStore,
} from "./media-selection-store.js";
import type { RemoteAssetDownloader } from "./remote-asset-downloader.js";
import type {
  HostedPublishObservation,
  PublishObservationHost,
} from "./publish-observation-host.js";
import {
  type PrepareRemoteDraftRequest,
  validatePublishDraftRequest,
  validateRemoteAssetsForForm,
  validateRemoteDraftRequest,
} from "./publish-request-validation.js";
import { platformFor } from "../registered-platforms.js";

type AccountStorePort = Pick<PlatformAccountStore, "require">;
type BrowserSessionsPort = Pick<
  BrowserProfileHost,
  "openForAutomation" | "closeAutomation"
>;
type MediaSelectionsPort = Pick<
  MediaSelectionStore,
  "acquire" | "consume" | "create" | "release"
>;
type RemoteAssetsPort = Pick<
  RemoteAssetDownloader,
  "discardUnreferenced" | "download"
>;
type PublishObservationsPort = Pick<PublishObservationHost, "attach">;
type AccountPublicationsPort = Pick<
  AccountPublicationLock,
  "acquire" | "isActive"
>;
type SessionDetection = Awaited<ReturnType<typeof detectPlatformSession>>;
type SessionDetectionRecorder = (
  accountId: string,
  detected: SessionDetection,
) => SessionDetection;
type PublishingPort = Pick<
  PublishingService,
  | "get"
  | "list"
  | "markAwaitingConfirmation"
  | "markPreparationFailed"
  | "markSubmissionUncertain"
  | "markSubmitting"
  | "startPreparation"
>;

export interface DraftPreparationDependencies {
  accountPublications: AccountPublicationsPort;
  accountStore: AccountStorePort;
  browserSessions: BrowserSessionsPort;
  mediaSelections: MediaSelectionsPort;
  remoteAssets: RemoteAssetsPort;
  recordSessionDetection: SessionDetectionRecorder;
  publishObservations: PublishObservationsPort;
  publishing: PublishingPort;
  createId?: (() => string) | undefined;
  sessionDetector?: typeof detectPlatformSession | undefined;
  workflowExecutor?: typeof executeWorkflow | undefined;
}

export type { PrepareRemoteDraftRequest };

export class DraftPreparation {
  private readonly createId: () => string;
  private readonly sessionDetector: typeof detectPlatformSession;
  private readonly workflowExecutor: typeof executeWorkflow;

  constructor(private readonly dependencies: DraftPreparationDependencies) {
    this.createId = dependencies.createId ?? randomUUID;
    this.sessionDetector =
      dependencies.sessionDetector ?? detectPlatformSession;
    this.workflowExecutor = dependencies.workflowExecutor ?? executeWorkflow;
  }

  async prepareRemoteDraft(request: PrepareRemoteDraftRequest) {
    assertAccountRequest(request);
    const requestId = validateRemoteDraftRequest(request);
    const existing = this.dependencies.publishing
      .list()
      .find((record) => record.requestId === requestId);
    if (existing) {
      return {
        status: "already_started",
        publicationId: existing.publication.id,
        state: existing.publication.state,
      } as const;
    }

    const account = this.dependencies.accountStore.require(request.accountId);
    if (account.lifecycle !== "active") {
      return {
        status: "account_unknown",
        reason: "账号身份仍在识别，暂不能创建发布任务",
      } as const;
    }
    const form = platformFor(account.platformId).publishing?.forms[
      request.contentForm
    ];
    if (!form) throw new TypeError("Platform does not support this draft");
    const maxMediaCount = form.constraints.mediaMaxCount ?? 18;
    if (request.assets.length === 0 || request.assets.length > maxMediaCount) {
      throw new TypeError(
        `A draft can contain at most ${maxMediaCount} media files`,
      );
    }
    const orderedAssets = validateRemoteAssetsForForm(
      request.contentForm,
      request.assets,
    );

    const downloaded = await this.dependencies.remoteAssets.download(
      requestId,
      orderedAssets,
    );
    const selectionId = this.dependencies.mediaSelections.create({
      accountId: request.accountId,
      contentForm: request.contentForm,
      filePaths: downloaded.map(({ filePath }) => filePath),
      files: downloaded.map(
        ({ created: _created, filePath: _filePath, ...asset }) => asset,
      ),
    });
    try {
      const result = await this.prepareDraft({
        accountId: request.accountId,
        requestId,
        contentForm: request.contentForm,
        mediaSelectionId: selectionId,
        title: request.title,
        body: request.body,
        tags: request.tags,
        submissionMode: "automatic",
      });
      if (
        !this.dependencies.publishing
          .list()
          .some((record) => record.requestId === requestId)
      ) {
        this.dependencies.mediaSelections.consume(selectionId);
      }
      await this.releaseAssetsWithoutPublication(requestId, downloaded);
      return result;
    } catch (error) {
      this.dependencies.mediaSelections.consume(selectionId);
      await this.releaseAssetsWithoutPublication(requestId, downloaded);
      throw error;
    }
  }

  private async releaseAssetsWithoutPublication(
    requestId: string,
    downloaded: Awaited<ReturnType<RemoteAssetsPort["download"]>>,
  ): Promise<void> {
    const publications = this.dependencies.publishing.list();
    if (publications.some((record) => record.requestId === requestId)) return;
    const referencedRelativePaths = new Set(
      publications.flatMap((record) =>
        record.assets.flatMap(({ localRelativePath }) =>
          localRelativePath === null ? [] : [localRelativePath],
        ),
      ),
    );
    await this.dependencies.remoteAssets.discardUnreferenced(
      downloaded,
      referencedRelativePaths,
    );
  }

  async prepareDraft(request: PreparePublishDraftRequest) {
    assertAccountRequest(request);
    validatePublishDraftRequest(request);
    const submissionMode = request.submissionMode ?? "automatic";
    const requestId = request.requestId?.trim() ?? this.createId();
    const account = this.dependencies.accountStore.require(request.accountId);
    const existingPublication = this.dependencies.publishing
      .list()
      .find((record) => record.requestId === requestId);
    if (existingPublication) {
      return {
        status: "already_started",
        publicationId: existingPublication.publication.id,
        state: existingPublication.publication.state,
      } as const;
    }
    if (account.lifecycle !== "active") {
      return {
        status: "account_unknown",
        reason: "账号身份仍在识别，暂不能创建发布任务",
      } as const;
    }
    const platform = platformFor(account.platformId);
    const form = platform.publishing?.forms[request.contentForm];
    if (!form) {
      throw new TypeError(
        `${platform.displayName} does not support this draft`,
      );
    }
    if (!form.submissionModes.includes(submissionMode)) {
      throw new TypeError(
        `${platform.displayName}暂不支持${submissionMode === "automatic" ? "自动提交" : "人工确认"}`,
      );
    }
    const title = request.title.trim();
    const body = request.body.trim();
    const preparedText = preparePublishText(form, body, request.tags);
    const constraints = form?.constraints;
    if (
      constraints?.titleMaxLength !== undefined &&
      title.length > constraints.titleMaxLength
    ) {
      throw new TypeError(
        `${platform.displayName}标题最多 ${constraints.titleMaxLength} 字`,
      );
    }
    if (
      constraints?.bodyMaxLength !== undefined &&
      preparedText.body.length > constraints.bodyMaxLength
    ) {
      throw new TypeError(
        `${platform.displayName}正文最多 ${constraints.bodyMaxLength} 字`,
      );
    }
    const publishRuntime = platform.publishing;
    if (!publishRuntime) {
      throw new TypeError(
        `${platform.displayName} does not support publish observation`,
      );
    }
    const publicationLease = this.dependencies.accountPublications.acquire(
      account.id,
    );
    if (!publicationLease) return { status: "account_busy" } as const;

    let observationOwnsLease = false;
    let publishObservation: HostedPublishObservation | undefined;
    let publicationId: string | undefined;
    try {
      const opened = await this.dependencies.browserSessions.openForAutomation(
        account,
        platform,
      );
      const detected = this.dependencies.recordSessionDetection(
        account.id,
        await this.sessionDetector(
          platform.accounts.detection,
          opened.driver,
          opened.sessionProbeClient,
        ),
      );
      if (detected.status === "login_required") {
        await this.dependencies.browserSessions.closeAutomation(account);
        return { status: "login_required" } as const;
      }
      if (detected.status === "unknown") {
        return { status: "account_unknown", reason: detected.reason } as const;
      }
      const selection = this.dependencies.mediaSelections.acquire(
        request.mediaSelectionId,
        request.accountId,
        request.contentForm,
      );
      let preparation: ReturnType<PublishingPort["startPreparation"]>;
      preparation = this.dependencies.publishing.startPreparation({
        requestId,
        accountId: account.id,
        platformId: platform.id,
        contentForm: request.contentForm,
        title,
        body,
        tags: preparedText.tags,
        submissionMode,
        assets: selection.files,
        rulesVersion: platform.rulesVersion,
      });
      const publication = preparation.record;
      publicationId = publication.publication.id;
      if (!preparation.started) {
        this.dependencies.mediaSelections.release(request.mediaSelectionId);
        return {
          status: "already_started",
          publicationId: publication.publication.id,
          state: publication.publication.state,
        } as const;
      }
      const monitor = publishRuntime.createResultMonitor({
        contentForm: request.contentForm,
        submissionMode,
        session: opened.observationSession,
        clock: {
          now: () => Date.now(),
          sleep: (milliseconds) =>
            new Promise((resolve) => setTimeout(resolve, milliseconds)),
        },
        diagnostics: {
          report(diagnostic) {
            console.error(
              `[publish-monitor:${platform.id}] ${diagnostic.stage}/${diagnostic.code}: ${diagnostic.message}`,
            );
          },
        },
      });
      publishObservation = this.dependencies.publishObservations.attach({
        publicationId: publication.publication.id,
        accountId: account.id,
        platformId: platform.id,
        monitor,
        onFinished: () => publicationLease.release(),
      });
      observationOwnsLease = true;
      await publishObservation.ready();
      await this.workflowExecutor(form.automation.prepare, opened.driver, {
        mediaPaths: selection.filePaths,
        title,
        body,
        description: composePublishDescription(form, {
          title,
          body: preparedText.body,
        }),
        tags: preparedText.tagsToAppend,
      });
      this.dependencies.mediaSelections.consume(request.mediaSelectionId);
      if (submissionMode === "manual_confirmation") {
        await opened.focus();
        this.dependencies.publishing.markAwaitingConfirmation(
          publication.publication.id,
        );
        publishObservation.arm();
        return {
          status: "ready_for_review",
          mediaCount: selection.filePaths.length,
          profileId: opened.profileId,
          publishObservationId: publishObservation.id,
          publicationId: publication.publication.id,
        } as const;
      }

      await opened.focus();
      this.dependencies.publishing.markSubmitting(publication.publication.id);
      publishObservation.arm();
      await this.workflowExecutor(form.automation.submit, opened.driver, {});
      return {
        status: "submission_started",
        mediaCount: selection.filePaths.length,
        profileId: opened.profileId,
        publishObservationId: publishObservation.id,
        publicationId: publication.publication.id,
      } as const;
    } catch (error) {
      // The caller below persists and returns the actionable workflow error.
      // Do not replace it with the host's generic interruption fallback.
      publishObservation?.stop(false);
      this.dependencies.mediaSelections.release(request.mediaSelectionId);
      const message = error instanceof Error ? error.message : "Prepare failed";
      const current = publicationId
        ? this.dependencies.publishing.get(publicationId)
        : undefined;
      try {
        if (
          current?.publication.state === "submitting" ||
          current?.publication.state === "verifying"
        ) {
          this.dependencies.publishing.markSubmissionUncertain(
            current.publication.id,
            message,
          );
        } else if (
          current &&
          current?.publication.state !== "uncertain" &&
          current?.publication.state !== "failed"
        ) {
          this.dependencies.publishing.markPreparationFailed(
            current.publication.id,
            message,
          );
        }
      } catch (persistenceError) {
        console.error(
          "Failed to persist publication failure",
          persistenceError,
        );
      }
      if (current?.publication.state === "published") {
        return {
          status: "already_started",
          publicationId: current.publication.id,
          state: "published",
        } as const;
      }
      if (
        current?.publication.state === "submitting" ||
        current?.publication.state === "verifying" ||
        current?.publication.state === "uncertain"
      ) {
        return {
          status: "uncertain",
          code:
            error instanceof AutomationError
              ? error.details.code
              : "SUBMISSION_RESULT_UNCERTAIN",
          message,
          evidenceId:
            error instanceof AutomationError
              ? (error.details.evidence?.id ?? null)
              : null,
          publicationId: current.publication.id,
        } as const;
      }
      if (error instanceof AutomationError) {
        return {
          status: "failed",
          code: error.details.code,
          message: error.message,
          evidenceId: error.details.evidence?.id ?? null,
        } as const;
      }
      if (error instanceof MediaSelectionUnavailableError) {
        return {
          status: "failed",
          code: "MEDIA_SELECTION_UNAVAILABLE",
          message: "媒体选择已失效，请重新选择文件",
          evidenceId: null,
        } as const;
      }
      return {
        status: "failed",
        code: "UNEXPECTED_ERROR",
        message,
        evidenceId: null,
      } as const;
    } finally {
      if (!observationOwnsLease) publicationLease.release();
    }
  }
}
