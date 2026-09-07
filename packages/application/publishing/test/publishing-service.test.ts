import { describe, expect, it } from "vitest";

import {
  PublishingService,
  type PublicationRecord,
  type PublicationRepository,
} from "../src/index.js";

class MemoryPublicationRepository implements PublicationRepository {
  readonly records = new Map<string, PublicationRecord>();

  list(): PublicationRecord[] {
    return [...this.records.values()];
  }

  get(publicationId: string): PublicationRecord | undefined {
    return this.records.get(publicationId);
  }

  save(record: PublicationRecord): void {
    this.records.set(record.publication.id, record);
  }
}

function fixture() {
  const repository = new MemoryPublicationRepository();
  let sequence = 0;
  const service = new PublishingService(
    repository,
    { now: () => new Date("2026-08-09T10:00:00.000Z") },
    { create: () => `id-${++sequence}` },
  );
  return { repository, service };
}

function start(service: PublishingService): PublicationRecord {
  return service.startPreparation({
    requestId: "request-1",
    platformId: "douyin",
    accountId: "account-1",
    contentForm: "imageText",
    title: "标题",
    body: "正文",
    submissionMode: "automatic",
    tags: ["测试"],
    assets: [
      {
        name: "image.jpg",
        size: 42,
        mediaType: "image/jpeg",
        hash: "a".repeat(64),
        downloadedAt: "2026-08-09T09:59:00.000Z",
        sourceAssetId: "remote-1",
        sourceOrigin: "https://assets.example.test",
        localRelativePath: `sha256/aa/${"a".repeat(64)}.jpg`,
      },
    ],
    rulesVersion: "0.4.0-live",
  }).record;
}

describe("PublishingService", () => {
  it("persists an immutable content snapshot before preparation starts", () => {
    const { repository, service } = fixture();
    const record = start(service);

    expect(record.publication.state).toBe("preparing");
    expect(record.publication.transitions.map(({ to }) => to)).toEqual([
      "validated",
      "preparing",
    ]);
    expect(repository.get(record.publication.id)?.contentRevision.body).toBe(
      "正文",
    );
    expect(record.assets[0]).toMatchObject({ name: "image.jpg", size: 42 });
    expect(record).toMatchObject({
      tags: ["测试"],
      submissionMode: "automatic",
      assets: [
        {
          role: "image",
          order: 0,
          mediaType: "image/jpeg",
          sourceOrigin: "https://assets.example.test",
        },
      ],
    });
  });

  it("returns the existing publication for a repeated request id", () => {
    const { repository, service } = fixture();
    const first = start(service);

    const repeated = service.startPreparation({
      requestId: "request-1",
      platformId: "douyin",
      accountId: "account-1",
      contentForm: "imageText",
      title: "不同标题",
      body: "不同正文",
      assets: [],
      rulesVersion: "new-version",
    });

    expect(repeated).toEqual({ record: first, started: false });
    expect(repository.records.size).toBe(1);
  });

  it("moves a reviewed draft through verification to a published identity", () => {
    const { service } = fixture();
    const preparing = start(service);
    service.markAwaitingConfirmation(preparing.publication.id);
    service.recordObservation(preparing.publication.id, {
      kind: "verifying",
      message: "平台已受理",
    });
    const published = service.recordObservation(preparing.publication.id, {
      kind: "published",
      contentId: "work-1",
      contentUrl: "https://example.com/work-1",
    });

    expect(published.publication.state).toBe("published");
    expect(published.publication.platformContentId).toBe("work-1");
  });

  it("marks an interrupted manual task without submission evidence as cancelled", () => {
    const { service } = fixture();
    const preparing = start(service);
    service.markAwaitingConfirmation(preparing.publication.id);

    const recovered = service.recoverInterrupted();

    expect(recovered[0]?.publication.state).toBe("cancelled");
  });

  it("accepts a retried terminal observation after the first save may have succeeded", () => {
    const { service } = fixture();
    const preparing = start(service);
    service.markAwaitingConfirmation(preparing.publication.id);
    const result = {
      kind: "published" as const,
      contentId: "work-1",
      contentUrl: "https://example.com/work-1",
    };
    service.recordObservation(preparing.publication.id, result);

    const retried = service.recordObservation(preparing.publication.id, result);

    expect(retried.publication.state).toBe("published");
    expect(
      retried.publication.transitions.filter(({ to }) => to === "published"),
    ).toHaveLength(1);
  });

  it("persists the irreversible submission boundary before observation", () => {
    const { service } = fixture();
    const preparing = start(service);

    service.markSubmitting(preparing.publication.id);
    const submitting = service.recordObservation(
      preparing.publication.id,
      {
        kind: "submission_attempted",
        source: "application_commit",
        message: "即将点击发布",
      },
      1,
    );

    expect(submitting.publication.state).toBe("submitting");
    expect(submitting.submissionEvidence).toBe("submission_attempted");
    expect(service.recoverInterrupted()[0]?.publication.state).toBe(
      "uncertain",
    );
  });
});
