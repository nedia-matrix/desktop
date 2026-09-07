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
export type SubmissionEvidence =
  | "none"
  | "submission_attempted"
  | "verification_observed"
  | "accepted"
  | "legacy_unknown";

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
  submissionEvidence?: SubmissionEvidence;
  lastObservationSequence?: number;
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
      submissionMode: input.submissionMode ?? "manual_confirmation",
      submissionEvidence: "none",
      lastObservationSequence: 0,
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
    sequence?: number,
  ): PublicationRecord {
    const current = this.require(publicationId);
    const currentSequence = current.lastObservationSequence ?? 0;
    if (sequence !== undefined && sequence <= currentSequence) return current;
    if (
      (result.kind === "published" &&
        current.publication.state === "published") ||
      (result.kind === "failed" && current.publication.state === "failed") ||
      (result.kind === "uncertain" && current.publication.state === "uncertain")
    ) {
      return sequence === undefined
        ? current
        : this.save({ ...current, lastObservationSequence: sequence });
    }
    const evidence = promoteEvidence(
      current.submissionEvidence ?? "legacy_unknown",
      evidenceFor(result),
    );
    let record: PublicationRecord = {
      ...current,
      submissionEvidence: evidence,
      lastObservationSequence: sequence ?? currentSequence,
    };
    if (result.kind === "submission_attempted") {
      if (
        record.publication.state === "preparing" ||
        record.publication.state === "awaiting_confirmation"
      ) {
        record = this.advance(record, "submitting", result.message);
      } else {
        record = { ...record, lastMessage: result.message };
      }
      return this.save(record);
    }
    if (result.kind === "verification_required") {
      return this.save({ ...record, lastMessage: result.message });
    }
    if (result.kind === "verifying") {
      if (record.publication.state === "verifying") {
        return this.save({ ...record, lastMessage: result.message });
      }
      if (
        record.publication.state === "preparing" ||
        record.publication.state === "awaiting_confirmation"
      ) {
        record = this.advance(record, "submitting");
      }
      return this.save(this.advance(record, "verifying", result.message));
    }
    if (result.kind === "cancelled") {
      if (evidence === "none") {
        return this.save(this.advance(record, "cancelled", result.message));
      }
      if (record.publication.state === "preparing") {
        record = this.advance(record, "submitting");
      }
      return this.save(
        this.advance(
          record,
          "uncertain",
          "观察结束前已存在提交证据，请先在平台核实",
        ),
      );
    }
    if (result.kind === "failed" || result.kind === "uncertain") {
      if (
        result.kind === "uncertain" &&
        record.publication.state === "preparing"
      ) {
        record = this.advance(record, "submitting");
      }
      return this.save(this.advance(record, result.kind, result.message));
    }

    if (
      record.publication.state === "preparing" ||
      record.publication.state === "awaiting_confirmation"
    ) {
      record = this.advance(record, "submitting");
    }
    if (record.publication.state === "submitting") {
      record = this.advance(record, "verifying");
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
        if (this.evidence(record) === "none") {
          recovered.push(
            this.transition(
              record.publication.id,
              "failed",
              "应用在草稿准备完成前退出",
            ),
          );
        } else {
          const submitting = this.advance(record, "submitting");
          recovered.push(
            this.save(
              this.advance(
                submitting,
                "uncertain",
                "应用重启后无法排除已经提交，请先在平台核实",
              ),
            ),
          );
        }
      } else if (recoverableActiveStates.includes(record.publication.state)) {
        if (
          this.evidence(record) === "none" &&
          (record.publication.state === "awaiting_confirmation" ||
            record.publication.state === "submitting")
        ) {
          recovered.push(
            this.transition(
              record.publication.id,
              "cancelled",
              "应用退出前没有观察到提交尝试",
            ),
          );
        } else {
          recovered.push(
            this.transition(
              record.publication.id,
              "uncertain",
              "应用重启后无法恢复发布结果监听，请先在平台核实",
            ),
          );
        }
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

  private advance(
    record: PublicationRecord,
    state: PublicationState,
    message?: string,
  ): PublicationRecord {
    return {
      ...record,
      publication: transitionPublication(
        record.publication,
        state,
        this.now(),
        message,
      ),
      ...(message === undefined ? {} : { lastMessage: message }),
    };
  }

  private evidence(record: PublicationRecord): SubmissionEvidence {
    return record.submissionEvidence ?? "legacy_unknown";
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

const evidenceRanks: Readonly<
  Record<Exclude<SubmissionEvidence, "legacy_unknown">, number>
> = {
  none: 0,
  submission_attempted: 1,
  verification_observed: 2,
  accepted: 3,
};

function evidenceFor(
  result: PublishResultEvent,
): Exclude<SubmissionEvidence, "legacy_unknown"> {
  switch (result.kind) {
    case "submission_attempted":
      return "submission_attempted";
    case "verification_required":
      return "verification_observed";
    case "verifying":
    case "published":
    case "failed":
      return "accepted";
    case "uncertain":
    case "cancelled":
      return "none";
  }
}

function promoteEvidence(
  current: SubmissionEvidence,
  next: Exclude<SubmissionEvidence, "legacy_unknown">,
): SubmissionEvidence {
  if (current === "legacy_unknown") return next === "none" ? current : next;
  return evidenceRanks[next] > evidenceRanks[current] ? next : current;
}
