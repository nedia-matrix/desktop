import { randomUUID } from "node:crypto";

import { executeWorkflow } from "@nedia-matrix/automation-engine";
import type { PublishingService } from "@nedia-matrix/application-publishing";
import type { PreparePublishDraftRequest } from "@nedia-matrix/ipc-contracts";
import {
  composePublishDescription,
  preparePublishText,
} from "@nedia-matrix/platform-core";

import {
  assertAccountRequest,
  type AccountRepository,
  type BrowserSessionPort,
} from "../../accounts/public.js";
import type { AccountPublicationLock } from "./account-publication-lock.js";
import type { MediaSelectionStore } from "../infrastructure/media-selection-store.js";
import type { RemoteAssetDownloader } from "../infrastructure/remote-asset-downloader.js";
import type {
  ManagedPublishObservation,
  PublishObservationManager,
} from "../observations/publish-observation-manager.js";
import {
  type PrepareRemoteDraftRequest,
  validatePublishDraftRequest,
} from "./publish-request-validator.js";
import { handlePublishFailure } from "./publish-failure-handler.js";
import { prepareRemoteDraft } from "./remote-draft-preparer.js";
import { platformFor } from "../../platforms/platform-registry.js";

type AccountStorePort = Pick<AccountRepository, "require">;
type BrowserSessionsPort = Pick<
  BrowserSessionPort,
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
type PublishObservationsPort = Pick<PublishObservationManager, "attach">;
type AccountPublicationsPort = Pick<
  AccountPublicationLock,
  "acquire" | "isActive"
>;
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

export interface PublishDraftOrchestratorDependencies {
  accountPublications: AccountPublicationsPort;
  accountStore: AccountStorePort;
  browserSessions: BrowserSessionsPort;
  mediaSelections: MediaSelectionsPort;
  remoteAssets: RemoteAssetsPort;
  verifyAccount(request: {
    accountId: string;
  }): Promise<
    | { status: "authenticated" }
    | { status: "login_required" }
    | { status: "unknown"; reason: string }
  >;
  publishObservations: PublishObservationsPort;
  publishing: PublishingPort;
  createId?: (() => string) | undefined;
  workflowExecutor?: typeof executeWorkflow | undefined;
}

export type { PrepareRemoteDraftRequest };

export class PublishDraftOrchestrator {
  private readonly createId: () => string;
  private readonly workflowExecutor: typeof executeWorkflow;

  constructor(
    private readonly dependencies: PublishDraftOrchestratorDependencies,
  ) {
    this.createId = dependencies.createId ?? randomUUID;
    this.workflowExecutor = dependencies.workflowExecutor ?? executeWorkflow;
  }

  async prepareRemoteDraft(request: PrepareRemoteDraftRequest) {
    assertAccountRequest(request);
    return prepareRemoteDraft(request, this.dependencies, (draft) =>
      this.prepareDraft(draft),
    );
  }

  async prepareDraft(request: PreparePublishDraftRequest) {
    assertAccountRequest(request);
    validatePublishDraftRequest(request);
    const submissionMode = request.submissionMode ?? "manual_confirmation";
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
    const description = composePublishDescription(form, {
      title,
      body: preparedText.body,
    });
    if (
      form.constraints.titleMaxLength !== undefined &&
      title.length > form.constraints.titleMaxLength
    ) {
      throw new TypeError(
        `${platform.displayName}标题最多 ${form.constraints.titleMaxLength} 字`,
      );
    }
    if (
      form.constraints.bodyMaxLength !== undefined &&
      preparedText.body.length > form.constraints.bodyMaxLength
    ) {
      throw new TypeError(
        `${platform.displayName}正文最多 ${form.constraints.bodyMaxLength} 字`,
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
    let publishObservation: ManagedPublishObservation | undefined;
    let publicationId: string | undefined;
    try {
      const detected = await this.dependencies.verifyAccount({
        accountId: account.id,
      });
      if (detected.status === "login_required") {
        await this.dependencies.browserSessions.closeAutomation(account);
        return { status: "login_required" } as const;
      }
      if (detected.status === "unknown") {
        return { status: "account_unknown", reason: detected.reason } as const;
      }
      const opened = await this.dependencies.browserSessions.openForAutomation(
        account,
        platform,
      );
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
        description,
        tags: preparedText.tagsToAppend,
      });
      this.dependencies.mediaSelections.consume(request.mediaSelectionId);
      const afterPreparation = this.dependencies.publishing.get(
        publication.publication.id,
      );
      if (afterPreparation?.publication.state !== "preparing") {
        await opened.focus();
        return {
          status: "already_started",
          publicationId:
            afterPreparation?.publication.id ?? publication.publication.id,
          state: afterPreparation?.publication.state ?? "uncertain",
        } as const;
      }
      publishObservation.arm();
      if (submissionMode === "manual_confirmation") {
        this.dependencies.publishing.markAwaitingConfirmation(
          publication.publication.id,
        );
        await opened.focus();
        return {
          status: "ready_for_review",
          mediaCount: selection.filePaths.length,
          profileId: opened.profileId,
          publishObservationId: publishObservation.id,
          publicationId: publication.publication.id,
        } as const;
      }

      this.dependencies.publishing.markSubmitting(publication.publication.id);
      await opened.focus();
      await this.workflowExecutor(
        form.automation.submit,
        opened.driver,
        {},
        {
          beforeCommit: ({ boundary }) =>
            boundary === "submission"
              ? publishObservation!.beginSubmissionAttempt()
              : Promise.resolve(),
        },
      );
      return {
        status: "submission_started",
        mediaCount: selection.filePaths.length,
        profileId: opened.profileId,
        publishObservationId: publishObservation.id,
        publicationId: publication.publication.id,
      } as const;
    } catch (error) {
      // Persist and return the actionable workflow error without replacing it
      // with the observation host's generic interruption fallback.
      await publishObservation?.stopSilently();
      this.dependencies.mediaSelections.release(request.mediaSelectionId);
      return handlePublishFailure(
        error,
        publicationId,
        this.dependencies.publishing,
      );
    } finally {
      if (!observationOwnsLease) publicationLease.release();
    }
  }
}
