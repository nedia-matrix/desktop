import type { PublishingService } from "@nedia-matrix/application-publishing";
import type {
  OpenPublicationRequest,
  PreparePublishDraftRequest,
} from "@nedia-matrix/ipc-contracts";

import { platformFor } from "../../platforms/platform-registry.js";
import {
  registerLocalMedia,
  type RegisterLocalMediaRequest,
} from "./local-media-registration.js";
import {
  PublishDraftOrchestrator,
  type PublishDraftOrchestratorDependencies,
  type PrepareRemoteDraftRequest,
} from "./publish-draft-orchestrator.js";
import { requireSafePublicationUrl } from "./publication-link.js";
import { toPublicationSummary } from "../infrastructure/electron-publication-repository.js";

type PublicationQueryPort = Pick<PublishingService, "get" | "list">;
type PublicationStatePort = Partial<
  Pick<PublishingService, "recordObservation" | "recoverInterrupted">
>;

export interface PublicationServiceDependencies extends PublishDraftOrchestratorDependencies {
  publishing: PublishDraftOrchestratorDependencies["publishing"] &
    PublicationQueryPort &
    PublicationStatePort;
}

export type { PrepareRemoteDraftRequest };
export type { RegisterLocalMediaRequest } from "./local-media-registration.js";

export class PublicationService {
  private readonly draftPreparation: PublishDraftOrchestrator;

  constructor(private readonly dependencies: PublicationServiceDependencies) {
    this.draftPreparation = new PublishDraftOrchestrator(dependencies);
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

  registerLocalMedia(request: RegisterLocalMediaRequest) {
    return registerLocalMedia(request, this.dependencies);
  }

  recordObservation(
    publicationId: string,
    result: Parameters<PublishingService["recordObservation"]>[1],
    sequence?: number,
  ) {
    if (!this.dependencies.publishing.recordObservation) {
      throw new TypeError("Publication observation persistence is unavailable");
    }
    return this.dependencies.publishing.recordObservation(
      publicationId,
      result,
      sequence,
    );
  }

  recoverInterrupted() {
    if (!this.dependencies.publishing.recoverInterrupted) {
      throw new TypeError("Publication recovery is unavailable");
    }
    return this.dependencies.publishing.recoverInterrupted();
  }
}
