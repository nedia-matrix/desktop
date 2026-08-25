import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";

import type { PublishingService } from "@nedia-matrix/application-publishing";
import type {
  OpenPublicationRequest,
  PublishContentForm,
  PreparePublishDraftRequest,
} from "@nedia-matrix/ipc-contracts";

import { platformFor } from "../registered-platforms.js";
import { assertAccountRequest } from "../accounts/account-request-validation.js";
import { isContentForm } from "./publish-request-validation.js";
import {
  DraftPreparation,
  type DraftPreparationDependencies,
  type PrepareRemoteDraftRequest,
} from "./draft-preparation.js";
import { requireSafePublicationUrl } from "./publication-link.js";
import { toPublicationSummary } from "./publication-store.js";

type PublicationQueryPort = Pick<PublishingService, "get" | "list">;
type PublicationStatePort = Partial<
  Pick<PublishingService, "recordObservation" | "recoverInterrupted">
>;

export interface PublishingApplicationDependencies extends DraftPreparationDependencies {
  publishing: DraftPreparationDependencies["publishing"] &
    PublicationQueryPort &
    PublicationStatePort;
}

export type { PrepareRemoteDraftRequest };

export interface RegisterLocalMediaRequest {
  accountId: string;
  contentForm: PublishContentForm;
  filePaths: readonly string[];
}

export class PublishingApplication {
  private readonly draftPreparation: DraftPreparation;

  constructor(
    private readonly dependencies: PublishingApplicationDependencies,
  ) {
    this.draftPreparation = new DraftPreparation(dependencies);
  }

  listPublications() {
    return this.dependencies.publishing.list().map(toPublicationSummary);
  }

  publicationUrl(request: OpenPublicationRequest) {
    if (
      typeof request !== "object" ||
      request === null ||
      typeof request.publicationId !== "string" ||
      request.publicationId.length === 0
    ) {
      throw new TypeError("Invalid publication request");
    }
    const record = this.dependencies.publishing.get(request.publicationId);
    if (!record) throw new TypeError("Publication does not exist");
    const platform = platformFor(record.publication.platformId);
    return requireSafePublicationUrl(record, platform);
  }

  prepareRemoteDraft(request: PrepareRemoteDraftRequest) {
    return this.draftPreparation.prepareRemoteDraft(request);
  }

  prepareDraft(request: PreparePublishDraftRequest) {
    return this.draftPreparation.prepareDraft(request);
  }

  async registerLocalMedia(request: RegisterLocalMediaRequest) {
    assertAccountRequest(request);
    if (!isContentForm(request.contentForm)) {
      throw new TypeError("Invalid publish content form");
    }
    const account = this.dependencies.accountStore.require(request.accountId);
    if (account.status === "login_required") {
      return { status: "login_required" } as const;
    }

    const platform = platformFor(account.platformId);
    const form = platform.publishing?.forms[request.contentForm];
    if (!form) {
      throw new TypeError(
        `${platform.displayName} does not support ${request.contentForm}`,
      );
    }

    const maxMediaCount = form.constraints.mediaMaxCount ?? 18;
    if (
      request.filePaths.length === 0 ||
      request.filePaths.length > maxMediaCount
    ) {
      throw new TypeError(
        `A draft can contain at most ${maxMediaCount} media files`,
      );
    }

    const allowedExtensions =
      request.contentForm === "video"
        ? new Set([".mp4", ".mov", ".m4v", ".webm"])
        : new Set([".jpg", ".jpeg", ".png", ".webp"]);
    if (
      request.filePaths.some(
        (filePath) => !allowedExtensions.has(extname(filePath).toLowerCase()),
      )
    ) {
      throw new TypeError("Selected media format is not supported");
    }

    const files = await Promise.all(
      request.filePaths.map(async (filePath) => {
        const metadata = await stat(filePath);
        if (!metadata.isFile()) throw new TypeError("Media must be a file");
        return { name: basename(filePath), size: metadata.size };
      }),
    );
    const selectionId = this.dependencies.mediaSelections.create({
      accountId: account.id,
      contentForm: request.contentForm,
      filePaths: request.filePaths,
      files,
    });
    return { status: "selected", selectionId, files } as const;
  }

  recordObservation(
    publicationId: string,
    result: Parameters<PublishingService["recordObservation"]>[1],
  ) {
    if (!this.dependencies.publishing.recordObservation) {
      throw new TypeError("Publication observation persistence is unavailable");
    }
    return this.dependencies.publishing.recordObservation(
      publicationId,
      result,
    );
  }

  recoverInterrupted() {
    if (!this.dependencies.publishing.recoverInterrupted) {
      throw new TypeError("Publication recovery is unavailable");
    }
    return this.dependencies.publishing.recoverInterrupted();
  }
}
