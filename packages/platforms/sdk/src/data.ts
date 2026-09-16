export interface PlatformJsonResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
}

export interface PlatformJsonRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: unknown;
  readonly timeoutMs?: number;
}

export interface PlatformObservedJsonRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly timeoutMs: number;
  readonly replayObserved?: boolean;
}

export interface PlatformScrollRequest {
  readonly selector: string;
}

export interface PlatformScrollResult {
  readonly found: boolean;
  readonly moved: boolean;
  readonly atEnd: boolean;
}

export interface PlatformDataClient {
  navigate(url: string): Promise<void>;
  requestJson(request: PlatformJsonRequest): Promise<PlatformJsonResponse>;
  waitForJsonResponse(
    request: PlatformObservedJsonRequest,
  ): Promise<PlatformJsonResponse | null>;
  scrollToEnd(request: PlatformScrollRequest): Promise<PlatformScrollResult>;
  dispose(): void;
}

export interface PlatformAccountProfileData {
  readonly description?: string;
  readonly followerCount?: number;
  readonly followingCount?: number;
  readonly contentCount?: number;
  readonly likeCount?: number;
}

export interface PlatformAccountProfileCapability {
  readonly implementationStatus:
    "route-only" | "reference-derived" | "fixture-tested" | "live-tested";
  read(client: PlatformDataClient): Promise<PlatformAccountProfileData>;
}

export interface PlatformContentMetricsData {
  readonly viewCount?: number;
  readonly likeCount?: number;
  readonly commentCount?: number;
  readonly shareCount?: number;
  readonly collectCount?: number;
}

export interface PlatformContentData {
  readonly externalContentId: string;
  readonly contentUrl?: string;
  readonly contentType: "video" | "image_text" | "unknown";
  readonly title?: string;
  readonly description?: string;
  readonly coverUrl?: string;
  readonly publishedAt?: string;
  readonly platformStatus?: string;
  readonly metrics: PlatformContentMetricsData;
}

export interface PlatformContentReadResult {
  readonly items: readonly PlatformContentData[];
  readonly complete: boolean;
  readonly pagesRead: number;
  readonly remoteTotal?: number;
  readonly diagnostics?: readonly string[];
}

export interface PlatformContentCapability {
  readonly implementationStatus:
    "route-only" | "reference-derived" | "fixture-tested" | "live-tested";
  read(
    client: PlatformDataClient,
    expectedExternalAccountId: string,
  ): Promise<PlatformContentReadResult>;
}
