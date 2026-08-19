import {
  createContentRevision,
  createPublication,
  transitionPublication,
  type ContentRevision,
  type Publication,
  type PublicationState,
} from "@nedia-matrix/domain-core";
import type { PublishResultEvent } from "@nedia-matrix/platform-core";

export type PublicationContentForm = "video" | "imageText";
export type PublicationSubmissionMode =
  "automatic" | "manual_confirmation" | "legacy_unknown";

export interface PublicationAssetSnapshot {
  id: string;
  name: string;
  size: number;
  role: "image" | "video" | "cover" | "inline_image";
  order: number;
  mediaType: string | null;
  hash: string | null;
  downloadedAt: string | null;
  sourceAssetId: string | null;
  sourceOrigin: string | null;
  localRelativePath: string | null;
}

export interface PublicationRecord {
  requestId: string;
  publication: Readonly<Publication>;
  contentRevision: Readonly<ContentRevision>;
  contentForm: PublicationContentForm;
  tags: readonly string[];
  submissionMode: PublicationSubmissionMode;
  retained: boolean;
  assets: readonly PublicationAssetSnapshot[];
  rulesVersion: string;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string;
}

export interface PublicationRepository {
  list(): PublicationRecord[];
  get(publicationId: string): PublicationRecord | undefined;
  save(record: PublicationRecord): void;
}

export interface StartPublicationInput {
  requestId: string;
  platformId: string;
  accountId: string;
  contentForm: PublicationContentForm;
  title: string;
  body: string;
  tags?: readonly string[];
  submissionMode?: Exclude<PublicationSubmissionMode, "legacy_unknown">;
  assets: readonly (Pick<PublicationAssetSnapshot, "name" | "size"> &
    Partial<Omit<PublicationAssetSnapshot, "id" | "name" | "size">>)[];
  rulesVersion: string;
}

export interface StartPreparationResult {
  record: PublicationRecord;
  started: boolean;
}

export interface PublishingClock {
  now(): Date;
}

export interface PublishingIdFactory {
  create(): string;
}

const recoverableActiveStates: readonly PublicationState[] = [
  "awaiting_confirmation",
  "submitting",
  "verifying",
];

export class PublishingService {
  constructor(
    private readonly repository: PublicationRepository,
    private readonly clock: PublishingClock,
    private readonly ids: PublishingIdFactory,
  ) {}

  list(): PublicationRecord[] {
    return this.repository.list();
  }

  get(publicationId: string): PublicationRecord | undefined {
    return this.repository.get(publicationId);
  }

  startPreparation(input: StartPublicationInput): StartPreparationResult {
    const existing = this.repository
      .list()
      .find((record) => record.requestId === input.requestId);
    if (existing) return { record: existing, started: false };
    const occurredAt = this.now();
    const publicationId = this.ids.create();
    const contentRevisionId = this.ids.create();
    const assets = input.assets.map((asset, order) => ({
      ...asset,
      id: this.ids.create(),
      role: asset.role ?? (input.contentForm === "video" ? "video" : "image"),
      order: asset.order ?? order,
      mediaType: asset.mediaType ?? null,
      hash: asset.hash ?? null,
      downloadedAt: asset.downloadedAt ?? null,
      sourceAssetId: asset.sourceAssetId ?? null,
      sourceOrigin: asset.sourceOrigin ?? null,
      localRelativePath: asset.localRelativePath ?? null,
    }));
    const contentRevision = createContentRevision({
      id: contentRevisionId,
      contentItemId: publicationId,
      revision: 1,
      title: input.title,
      body: input.body,
      assetIds: assets.map(({ id }) => id),
      createdAt: occurredAt,
    });
    const draft = createPublication({
      id: publicationId,
      platformId: input.platformId,
      accountId: input.accountId,
      contentRevisionId,
    });
    const validated = transitionPublication(draft, "validated", occurredAt);
    const preparing = transitionPublication(validated, "preparing", occurredAt);
    const record: PublicationRecord = {
      requestId: input.requestId,
      publication: preparing,
      contentRevision,
      contentForm: input.contentForm,
      tags: [...(input.tags ?? [])],
      submissionMode: input.submissionMode ?? "automatic",
      retained: false,
      assets,
      rulesVersion: input.rulesVersion,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    this.repository.save(record);
    return { record, started: true };
  }

  markAwaitingConfirmation(publicationId: string): PublicationRecord {
    return this.transition(publicationId, "awaiting_confirmation");
  }

  markSubmitting(publicationId: string): PublicationRecord {
    return this.transition(publicationId, "submitting");
  }

  markPreparationFailed(
    publicationId: string,
    message: string,
  ): PublicationRecord {
    return this.transition(publicationId, "failed", message);
  }

  markSubmissionUncertain(
    publicationId: string,
    message: string,
  ): PublicationRecord {
    const current = this.require(publicationId);
    if (current.publication.state === "uncertain") return current;
    return this.transition(publicationId, "uncertain", message);
  }

  recordObservation(
    publicationId: string,
    result: PublishResultEvent,
  ): PublicationRecord {
    const current = this.require(publicationId);
    if (
      (result.kind === "published" &&
        current.publication.state === "published") ||
      (result.kind === "failed" && current.publication.state === "failed") ||
      (result.kind === "uncertain" && current.publication.state === "uncertain")
    ) {
      return current;
    }
    if (result.kind === "verification_required") {
      return this.save({ ...current, lastMessage: result.message });
    }
    if (result.kind === "verifying") {
      if (current.publication.state === "verifying") {
        return this.save({ ...current, lastMessage: result.message });
      }
      if (current.publication.state === "awaiting_confirmation") {
        this.transition(publicationId, "submitting");
      }
      return this.transition(publicationId, "verifying", result.message);
    }
    if (result.kind === "failed" || result.kind === "uncertain") {
      return this.transition(publicationId, result.kind, result.message);
    }

    let record = current;
    if (record.publication.state === "awaiting_confirmation") {
      record = this.transition(publicationId, "submitting");
    }
    if (record.publication.state === "submitting") {
      record = this.transition(publicationId, "verifying");
    }
    const published = transitionPublication(
      record.publication,
      "published",
      this.now(),
    );
    return this.save({
      ...record,
      publication: {
        ...published,
        ...(result.contentId === null
          ? {}
          : { platformContentId: result.contentId }),
        ...(result.contentUrl === null
          ? {}
          : { platformContentUrl: result.contentUrl }),
      },
      lastMessage: "发布成功",
    });
  }

  recoverInterrupted(): PublicationRecord[] {
    const recovered: PublicationRecord[] = [];
    for (const record of this.repository.list()) {
      if (record.publication.state === "preparing") {
        recovered.push(
          this.transition(
            record.publication.id,
            "failed",
            "应用在草稿准备完成前退出",
          ),
        );
      } else if (recoverableActiveStates.includes(record.publication.state)) {
        recovered.push(
          this.transition(
            record.publication.id,
            "uncertain",
            "应用重启后无法恢复发布结果监听，请先在平台核实",
          ),
        );
      }
    }
    return recovered;
  }

  private transition(
    publicationId: string,
    state: PublicationState,
    message?: string,
  ): PublicationRecord {
    const current = this.require(publicationId);
    const publication = transitionPublication(
      current.publication,
      state,
      this.now(),
      message,
    );
    return this.save({
      ...current,
      publication,
      ...(message === undefined ? {} : { lastMessage: message }),
    });
  }

  private require(publicationId: string): PublicationRecord {
    const record = this.repository.get(publicationId);
    if (!record) throw new TypeError("Publication does not exist");
    return record;
  }

  private save(record: PublicationRecord): PublicationRecord {
    const saved = { ...record, updatedAt: this.now() };
    this.repository.save(saved);
    return saved;
  }

  private now(): string {
    return this.clock.now().toISOString();
  }
}
