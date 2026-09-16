import type { PublishResultEvent } from "@nedia-matrix/platform-sdk";

import {
  toPublicationSummary,
  type OpenPublicationRequest,
  type PreparePublishDraftRequest,
  type PreparePublishDraftResult,
  type PublicationSnapshot,
  type PublicationSummary,
} from "./index.js";
import {
  registerLocalMedia,
  type RegisterLocalMediaCommand,
  type RegisterLocalMediaResult,
} from "./local-media-registration.js";
import type { PublicationApplicationDependencies } from "./ports.js";
import {
  PublishDraftOrchestrator,
  type PrepareRemoteDraftRequest,
} from "./publish-draft-orchestrator.js";
import { requireSafePublicationUrl } from "./publication-link.js";

export interface PublicationUseCases {
  list(): PublicationSummary[];
  openReview(request: OpenPublicationRequest): Promise<void>;
  publicationUrl(request: OpenPublicationRequest): string;
  prepareRemote(
    request: PrepareRemoteDraftRequest,
  ): Promise<PreparePublishDraftResult>;
  prepare(
    request: PreparePublishDraftRequest,
  ): Promise<PreparePublishDraftResult>;
  registerLocalMedia(
    command: RegisterLocalMediaCommand,
  ): RegisterLocalMediaResult;
  recordObservation(
    publicationId: string,
    result: PublishResultEvent,
    sequence?: number,
  ): PublicationSnapshot;
  recoverInterrupted(): PublicationSnapshot[];
}

export class PublicationService implements PublicationUseCases {
  private readonly draftPreparation: PublishDraftOrchestrator;

  constructor(
    private readonly dependencies: PublicationApplicationDependencies,
  ) {
    this.draftPreparation = new PublishDraftOrchestrator(dependencies);
  }

  list(): PublicationSummary[] {
    return this.dependencies.publishing.list().map(toPublicationSummary);
  }

  async openReview(request: OpenPublicationRequest): Promise<void> {
    if (
      !request ||
      typeof request.publicationId !== "string" ||
      !this.dependencies.publishing.get(request.publicationId)
    ) {
      throw new TypeError("Publication does not exist");
    }
    await this.dependencies.browser.focusPublication(request.publicationId);
  }

  publicationUrl(request: OpenPublicationRequest): string {
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
    const platform = this.dependencies.platforms.require(
      record.publication.platformId,
    );
    return requireSafePublicationUrl(record, platform);
  }

  prepareRemote(
    request: PrepareRemoteDraftRequest,
  ): Promise<PreparePublishDraftResult> {
    return this.draftPreparation.prepareRemoteDraft(request);
  }

  prepare(
    request: PreparePublishDraftRequest,
  ): Promise<PreparePublishDraftResult> {
    return this.draftPreparation.prepareDraft(request);
  }

  registerLocalMedia(
    command: RegisterLocalMediaCommand,
  ): RegisterLocalMediaResult {
    return registerLocalMedia(command, this.dependencies);
  }

  recordObservation(
    publicationId: string,
    result: PublishResultEvent,
    sequence?: number,
  ): PublicationSnapshot {
    return this.dependencies.publishing.recordObservation(
      publicationId,
      result,
      sequence,
    );
  }

  recoverInterrupted(): PublicationSnapshot[] {
    return this.dependencies.publishing.recoverInterrupted();
  }
}

export type { PrepareRemoteDraftRequest };
export type {
  RegisterLocalMediaCommand,
  RegisterLocalMediaResult,
} from "./local-media-registration.js";
