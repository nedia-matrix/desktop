import type { PreparePublishDraftRequest } from "./index.js";
import {
  composePublishDescription,
  preparePublishText,
} from "@nedia-matrix/platform-sdk";

import type {
  ManagedPublishObservation,
  PublicationApplicationDependencies,
  PublicationBrowserPage,
  PublishAutomationDiagnosticTrace,
} from "./ports.js";
import {
  type PrepareRemoteDraftRequest,
  validatePublishDraftRequest,
} from "./publish-request-validator.js";
import { handlePublishFailure } from "./publish-failure-handler.js";
import { prepareRemoteDraft } from "./remote-draft-preparer.js";

export type { PrepareRemoteDraftRequest };

export class PublishDraftOrchestrator {
  constructor(
    private readonly dependencies: PublicationApplicationDependencies,
  ) {}

  async prepareRemoteDraft(request: PrepareRemoteDraftRequest) {
    assertAccountId(request.accountId);
    return prepareRemoteDraft(request, this.dependencies, (draft) =>
      this.prepareDraft(draft),
    );
  }

  async prepareDraft(request: PreparePublishDraftRequest) {
    assertAccountId(request.accountId);
    validatePublishDraftRequest(request);
    const submissionMode = request.submissionMode ?? "manual_confirmation";
    const requestId = request.requestId?.trim() ?? this.dependencies.createId();
    const account = this.dependencies.accounts.require(request.accountId);
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
    const platform = this.dependencies.platforms.require(account.platformId);
    const form = platform.publishing?.forms[request.contentForm];
    if (!form) {
      throw new TypeError(
        `${platform.displayName} does not support this draft`,
      );
    }
    const title = request.title.trim();
    const body = request.body.trim();
    const preparedText = preparePublishText(form, body, request.tags);
    const description = composePublishDescription(form, {
      title,
      body: preparedText.body,
    });
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

    const trace = startAutomationTrace(this.dependencies, {
      operation: "publish",
      requestId,
      accountId: account.id,
      platformId: platform.id,
    });

    let observationOwnsLease = false;
    let publishObservation: ManagedPublishObservation | undefined;
    let publicationId: string | undefined;
    let opened: PublicationBrowserPage | undefined;
    try {
      if (!platform.browser.sessionCapabilities?.headlessSync) {
        await this.dependencies.browser.openUserPage(account, platform);
      }
      const verificationStartedAt = Date.now();
      trace?.report({
        component: "session",
        event: "session.detection.started",
        details: { phase: "publish_preflight" },
      });
      const detected = await this.dependencies.verifyAccount({
        accountId: account.id,
      });
      trace?.report({
        component: "session",
        event: "session.detection.completed",
        details: {
          phase: "publish_preflight",
          status: detected.status,
          durationMs: Math.max(0, Date.now() - verificationStartedAt),
        },
      });
      if (detected.status === "login_required") {
        trace?.finish({ outcome: "login_required" });
        return { status: "login_required" } as const;
      }
      if (detected.status === "unknown") {
        trace?.finish({ outcome: "account_unknown", message: detected.reason });
        return { status: "account_unknown", reason: detected.reason } as const;
      }
      const selection = this.dependencies.mediaSelections.acquire(
        request.mediaSelectionId,
        request.accountId,
        request.contentForm,
      );
      const preparation = this.dependencies.publishing.startPreparation({
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
        qualification: {
          capability: form,
          body: preparedText.body,
          platformName: platform.displayName,
        },
      });
      const publication = preparation.record;
      publicationId = publication.publication.id;
      trace?.bind({ publicationId });
      if (!preparation.started) {
        this.dependencies.mediaSelections.release(request.mediaSelectionId);
        trace?.finish({ outcome: "already_started" });
        return {
          status: "already_started",
          publicationId: publication.publication.id,
          state: publication.publication.state,
        } as const;
      }
      opened = await this.dependencies.browser.openForPublication(
        account,
        platform,
        publication.publication.id,
        trace,
      );
      trace?.bind({ pageId: opened.id });
      if (!opened.observationSession) throw new Error("发布页观察端口不可用");
      const publishPage = opened;
      const monitor = publishRuntime.createResultMonitor({
        contentForm: request.contentForm,
        submissionMode,
        session: opened.observationSession,
        clock: this.dependencies.monitorClock,
        diagnostics: {
          report: (diagnostic) => {
            this.dependencies.diagnostics.report({
              platformId: platform.id,
              ...diagnostic,
            });
            trace?.report({
              component: "monitor",
              event: "monitor.diagnostic",
              level: "warn",
              details: {
                stage: diagnostic.stage,
                code: diagnostic.code,
                message: diagnostic.message,
              },
            });
          },
        },
      });
      publishObservation = this.dependencies.observations.attach({
        publicationId: publication.publication.id,
        accountId: account.id,
        platformId: platform.id,
        monitor,
        diagnostics: trace,
        onFinished: async () => {
          try {
            await publishPage.release();
          } finally {
            publicationLease.release();
          }
        },
      });
      observationOwnsLease = true;
      await publishObservation.ready();
      publishObservation.arm();
      await this.dependencies.workflow.execute(
        form.automation.prepare,
        opened.driver,
        {
          mediaReferences: selection.resourceReferences,
          title,
          body,
          description,
          tags: preparedText.tagsToAppend,
        },
        trace ? { trace: trace.execution("prepare") } : undefined,
      );
      this.dependencies.mediaSelections.consume(request.mediaSelectionId);
      const afterPreparation = this.dependencies.publishing.get(
        publication.publication.id,
      );
      if (afterPreparation?.publication.state !== "preparing") {
        await focusForReview(opened, platform.id, this.dependencies);
        return {
          status: "already_started",
          publicationId:
            afterPreparation?.publication.id ?? publication.publication.id,
          state: afterPreparation?.publication.state ?? "uncertain",
        } as const;
      }
      if (submissionMode === "manual_confirmation") {
        await opened.handoff();
        trace?.report({
          component: "application",
          event: "automation.control_completed",
          details: { outcome: "ready_for_review" },
        });
        this.dependencies.publishing.markAwaitingConfirmation(
          publication.publication.id,
        );
        await focusForReview(opened, platform.id, this.dependencies);
        showPublicationNotice(
          this.dependencies,
          account.id,
          publication.publication.id,
        );
        return {
          status: "ready_for_review",
          mediaCount: selection.resourceReferences.length,
          profileId: opened.profileId,
          publishObservationId: publishObservation.id,
          publicationId: publication.publication.id,
        } as const;
      }

      this.dependencies.publishing.markSubmitting(publication.publication.id);
      await opened.verifyIdentity();
      const accountBeforeSubmit = this.dependencies.accounts.require(
        account.id,
      );
      if (
        accountBeforeSubmit.status !== "authenticated" ||
        accountBeforeSubmit.externalAccountId !== account.externalAccountId
      )
        throw new Error("账号身份已变化，已停止自动提交");
      await this.dependencies.workflow.execute(
        form.automation.submit,
        opened.driver,
        {},
        {
          beforeCommit: ({ boundary }) =>
            boundary === "submission"
              ? publishObservation!.beginSubmissionAttempt()
              : Promise.resolve(),
          ...(trace ? { trace: trace.execution("submit") } : {}),
        },
      );
      trace?.report({
        component: "application",
        event: "automation.control_completed",
        details: { outcome: "submission_started" },
      });
      return {
        status: "submission_started",
        mediaCount: selection.resourceReferences.length,
        profileId: opened.profileId,
        publishObservationId: publishObservation.id,
        publicationId: publication.publication.id,
      } as const;
    } catch (error) {
      // Persist and return the actionable workflow error without replacing it
      // with the observation host's generic interruption fallback.
      await publishObservation?.stopSilently();
      this.dependencies.mediaSelections.release(request.mediaSelectionId);
      const result = handlePublishFailure(
        error,
        publicationId,
        this.dependencies.publishing,
        this.dependencies.failureClassifier,
      );
      trace?.finish({
        outcome: result.status,
        message: "message" in result ? result.message : undefined,
      });
      return trace &&
        (result.status === "failed" || result.status === "uncertain")
        ? { ...result, traceId: trace.traceId }
        : result;
    } finally {
      if (!observationOwnsLease) {
        await opened?.release();
        publicationLease.release();
      }
    }
  }
}

function startAutomationTrace(
  dependencies: PublicationApplicationDependencies,
  input: {
    operation: "publish";
    requestId: string;
    accountId: string;
    platformId: string;
  },
): PublishAutomationDiagnosticTrace | undefined {
  let trace: PublishAutomationDiagnosticTrace;
  try {
    const started = dependencies.automationDiagnostics?.start(input);
    if (!started) return undefined;
    trace = started;
  } catch {
    return undefined;
  }
  return {
    traceId: trace.traceId,
    bind: (binding) => {
      try {
        trace.bind(binding);
      } catch {
        // Diagnostics must not affect publication preparation.
      }
    },
    report: (event) => {
      try {
        trace.report(event);
      } catch {
        // Diagnostics must not affect publication preparation.
      }
    },
    execution: (phase) => {
      try {
        return trace.execution(phase);
      } catch {
        return undefined;
      }
    },
    finish: (result) => {
      try {
        trace.finish(result);
      } catch {
        // Diagnostics must not affect publication completion.
      }
    },
  };
}

function assertAccountId(accountId: string): void {
  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    throw new TypeError("Invalid account request");
  }
}

async function focusForReview(
  page: PublicationBrowserPage,
  platformId: string,
  dependencies: PublicationApplicationDependencies,
): Promise<void> {
  await page.focus().catch((error: unknown) =>
    dependencies.diagnostics.report({
      platformId,
      stage: "focus",
      code: "FOCUS_FAILED",
      message:
        error instanceof Error ? error.message : "Unable to focus publish page",
    }),
  );
}

function showPublicationNotice(
  dependencies: PublicationApplicationDependencies,
  accountId: string,
  publicationId: string,
): void {
  try {
    dependencies.notices?.show({
      kind: "publish.awaiting_confirmation",
      accountId,
      publicationId,
    });
  } catch {
    // Presentation failures do not change a completed preparation.
  }
}
