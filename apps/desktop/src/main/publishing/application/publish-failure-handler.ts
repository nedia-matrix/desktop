import { AutomationError } from "@nedia-matrix/automation-engine";

import { MediaSelectionUnavailableError } from "../infrastructure/media-selection-store.js";
import type { PublishDraftOrchestratorDependencies } from "./publish-draft-orchestrator.js";

type FailurePersistence = Pick<
  PublishDraftOrchestratorDependencies["publishing"],
  "get" | "markPreparationFailed" | "markSubmissionUncertain"
>;

export function handlePublishFailure(
  error: unknown,
  publicationId: string | undefined,
  publishing: FailurePersistence,
) {
  const message = error instanceof Error ? error.message : "Prepare failed";
  const current = publicationId ? publishing.get(publicationId) : undefined;
  try {
    if (
      (current?.publication.state === "submitting" &&
        current.submissionEvidence !== "none") ||
      current?.publication.state === "verifying"
    ) {
      publishing.markSubmissionUncertain(current.publication.id, message);
    } else if (
      current &&
      current.publication.state !== "uncertain" &&
      current.publication.state !== "failed"
    ) {
      publishing.markPreparationFailed(current.publication.id, message);
    }
  } catch (persistenceError) {
    console.error("Failed to persist publication failure", persistenceError);
  }
  if (current?.publication.state === "published") {
    return {
      status: "already_started",
      publicationId: current.publication.id,
      state: "published",
    } as const;
  }
  if (
    (current?.publication.state === "submitting" &&
      current.submissionEvidence !== "none") ||
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
}
