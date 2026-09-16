import type { PlatformContentData } from "@nedia-matrix/platform-sdk";

export interface PlatformContentMetricsSnapshot {
  readonly viewCount?: number;
  readonly likeCount?: number;
  readonly commentCount?: number;
  readonly shareCount?: number;
  readonly collectCount?: number;
}

export interface PlatformContentSnapshot {
  readonly id: string;
  readonly accountId: string;
  readonly platformId: string;
  readonly externalContentId: string;
  readonly contentUrl: string | null;
  readonly contentType: "video" | "image_text" | "unknown";
  readonly title: string | null;
  readonly description: string | null;
  readonly coverUrl: string | null;
  readonly publishedAt: string | null;
  readonly platformStatus: string | null;
  readonly metrics: PlatformContentMetricsSnapshot;
  readonly contentObservedAt: string;
  readonly metricsObservedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class PlatformContent {
  private snapshot: PlatformContentSnapshot;

  private constructor(snapshot: PlatformContentSnapshot) {
    assertPlatformContentSnapshot(snapshot);
    this.snapshot = structuredClone(snapshot);
  }

  static create(input: {
    id: string;
    accountId: string;
    platformId: string;
    data: PlatformContentData;
    observedAt: string;
  }): PlatformContent {
    const hasMetrics = Object.keys(input.data.metrics).length > 0;
    return PlatformContent.rehydrate({
      id: input.id,
      accountId: input.accountId,
      platformId: input.platformId,
      externalContentId: input.data.externalContentId,
      contentUrl: input.data.contentUrl ?? null,
      contentType: input.data.contentType,
      title: input.data.title ?? null,
      description: input.data.description ?? null,
      coverUrl: input.data.coverUrl ?? null,
      publishedAt: input.data.publishedAt ?? null,
      platformStatus: input.data.platformStatus ?? null,
      metrics: { ...input.data.metrics },
      contentObservedAt: input.observedAt,
      metricsObservedAt: hasMetrics ? input.observedAt : null,
      createdAt: input.observedAt,
      updatedAt: input.observedAt,
    });
  }

  static rehydrate(snapshot: PlatformContentSnapshot): PlatformContent {
    return new PlatformContent(snapshot);
  }

  observe(data: PlatformContentData, observedAt: string): void {
    if (data.externalContentId !== this.snapshot.externalContentId) {
      throw new TypeError("Platform content identity cannot change");
    }
    const hasMetrics = Object.keys(data.metrics).length > 0;
    const candidate: PlatformContentSnapshot = {
      ...this.snapshot,
      contentUrl: data.contentUrl ?? this.snapshot.contentUrl,
      contentType: data.contentType,
      title: data.title ?? this.snapshot.title,
      description: data.description ?? this.snapshot.description,
      coverUrl: data.coverUrl ?? this.snapshot.coverUrl,
      publishedAt: data.publishedAt ?? this.snapshot.publishedAt,
      platformStatus: data.platformStatus ?? this.snapshot.platformStatus,
      metrics: { ...this.snapshot.metrics, ...data.metrics },
      contentObservedAt: observedAt,
      metricsObservedAt: hasMetrics
        ? observedAt
        : this.snapshot.metricsObservedAt,
      updatedAt: observedAt,
    };
    assertPlatformContentSnapshot(candidate);
    this.snapshot = candidate;
  }

  toSnapshot(): PlatformContentSnapshot {
    return structuredClone(this.snapshot);
  }
}

export function assertPlatformContentSnapshot(
  snapshot: PlatformContentSnapshot,
): PlatformContentSnapshot {
  for (const [name, value] of [
    ["Content ID", snapshot.id],
    ["Account ID", snapshot.accountId],
    ["Platform ID", snapshot.platformId],
    ["External content ID", snapshot.externalContentId],
  ] as const) {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`${name} must be a non-empty string`);
    }
  }
  if (
    !(["video", "image_text", "unknown"] as const).includes(
      snapshot.contentType,
    )
  ) {
    throw new TypeError("Invalid platform content type");
  }
  for (const value of [
    snapshot.title,
    snapshot.description,
    snapshot.coverUrl,
    snapshot.contentUrl,
    snapshot.platformStatus,
  ]) {
    if (value !== null && typeof value !== "string") {
      throw new TypeError("Invalid platform content text field");
    }
  }
  for (const value of Object.values(snapshot.metrics)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("Invalid platform content metric");
    }
  }
  for (const value of [
    snapshot.contentObservedAt,
    snapshot.createdAt,
    snapshot.updatedAt,
  ]) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      throw new TypeError("Invalid platform content timestamp");
    }
  }
  if (
    snapshot.publishedAt !== null &&
    Number.isNaN(Date.parse(snapshot.publishedAt))
  ) {
    throw new TypeError("Invalid platform publication time");
  }
  if (
    snapshot.metricsObservedAt !== null &&
    Number.isNaN(Date.parse(snapshot.metricsObservedAt))
  ) {
    throw new TypeError("Invalid platform metrics time");
  }
  if (
    Date.parse(snapshot.createdAt) > Date.parse(snapshot.updatedAt) ||
    Date.parse(snapshot.contentObservedAt) > Date.parse(snapshot.updatedAt) ||
    (snapshot.metricsObservedAt !== null &&
      Date.parse(snapshot.metricsObservedAt) > Date.parse(snapshot.updatedAt))
  ) {
    throw new TypeError("Platform content timestamps are out of order");
  }
  return snapshot;
}
