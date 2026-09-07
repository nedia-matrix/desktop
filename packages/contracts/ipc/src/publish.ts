import type { PublicationState } from "@nedia-matrix/domain-core";

import type { PlatformAccountRequest } from "./platform-account.js";

export type PublishContentForm = "video" | "imageText";
export type SubmissionMode = "automatic" | "manual_confirmation";

export type PublicationStatus = PublicationState;

export interface PublicationSummary {
  id: string;
  requestId: string;
  platformId: string;
  accountId: string;
  contentForm: PublishContentForm;
  title: string | null;
  body: string;
  assets: readonly { name: string; size: number }[];
  state: PublicationStatus;
  transitions: readonly {
    from: PublicationStatus;
    to: PublicationStatus;
    occurredAt: string;
    reason: string | null;
  }[];
  rulesVersion: string;
  retained: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessage: string | null;
  platformContentId: string | null;
  platformContentUrl: string | null;
}

export interface OpenPublicationRequest {
  publicationId: string;
}

export interface SelectPublishMediaRequest extends PlatformAccountRequest {
  contentForm: PublishContentForm;
}

export type SelectPublishMediaResult =
  | { status: "cancelled" }
  | {
      status: "selected";
      selectionId: string;
      files: readonly { name: string; size: number }[];
    };

export interface PreparePublishDraftRequest extends PlatformAccountRequest {
  requestId?: string;
  contentForm: PublishContentForm;
  mediaSelectionId: string;
  title: string;
  body: string;
  tags?: readonly string[];
  submissionMode?: SubmissionMode;
}

export type PreparePublishDraftResult =
  | {
      status: "ready_for_review";
      mediaCount: number;
      profileId: string;
      publishObservationId: string | null;
      publicationId: string;
    }
  | {
      status: "submission_started";
      mediaCount: number;
      profileId: string;
      publishObservationId: string;
      publicationId: string;
    }
  | {
      status: "already_started";
      publicationId: string;
      state: PublicationStatus;
    }
  | { status: "account_busy" }
  | { status: "login_required" }
  | { status: "account_unknown"; reason: string }
  | {
      status: "failed";
      code: string;
      message: string;
      evidenceId: string | null;
    }
  | {
      status: "uncertain";
      code: string;
      message: string;
      evidenceId: string | null;
      publicationId: string;
    };

export type PublishResultStatus =
  | "submission_attempted"
  | "verification_required"
  | "verifying"
  | "published"
  | "failed"
  | "uncertain"
  | "cancelled";

export interface PublishResultUpdate {
  observationId: string;
  publicationId: string;
  accountId: string;
  status: PublishResultStatus;
  message: string | null;
  platformContentId: string | null;
  platformContentUrl: string | null;
}
