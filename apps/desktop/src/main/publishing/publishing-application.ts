import type { PublishingService } from "@nedia-matrix/application-publishing";
import type {
  OpenPublicationRequest,
  PreparePublishDraftRequest,
} from "@nedia-matrix/ipc-contracts";

import { platformFor } from "../registered-platforms.js";
import {
  DraftPreparation,
  type DraftPreparationDependencies,
  type PrepareRemoteDraftRequest,
} from "./draft-preparation.js";
import { requireSafePublicationUrl } from "./publication-link.js";
import { toPublicationSummary } from "./publication-store.js";

type PublicationQueryPort = Pick<PublishingService, "get" | "list">;

export interface PublishingApplicationDependencies extends DraftPreparationDependencies {
  publishing: DraftPreparationDependencies["publishing"] & PublicationQueryPort;
}

export type { PrepareRemoteDraftRequest };

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
}
