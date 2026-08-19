import type {
  PublicationRecord,
  PublicationRepository,
} from "@nedia-matrix/application-publishing";
import { publicationStates } from "@nedia-matrix/domain-core";
import type { PublicationState } from "@nedia-matrix/domain-core";
import type { PublicationSummary } from "@nedia-matrix/ipc-contracts";
import Store from "electron-store";

type PublicationStoreSchema = {
  schemaVersion?: unknown;
  publications?: unknown;
};

export const publicationStoreSchemaVersion = 4;

function normalizePublicationState(value: unknown): PublicationState | null {
  if (value === "publishing") return "submitting";
  return publicationStates.find((state) => state === value) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAsset(
  value: Record<string, unknown>,
  contentForm: PublicationRecord["contentForm"],
  order: number,
): PublicationRecord["assets"][number] {
  const role = ["image", "video", "cover", "inline_image"].find(
    (candidate) => candidate === value.role,
  ) as PublicationRecord["assets"][number]["role"] | undefined;
  return {
    id: value.id as string,
    name: value.name as string,
    size: value.size as number,
    role: role ?? (contentForm === "video" ? "video" : "image"),
    order: typeof value.order === "number" ? value.order : order,
    mediaType: typeof value.mediaType === "string" ? value.mediaType : null,
    hash: typeof value.hash === "string" ? value.hash : null,
    downloadedAt:
      typeof value.downloadedAt === "string" ? value.downloadedAt : null,
    sourceAssetId:
      typeof value.sourceAssetId === "string" ? value.sourceAssetId : null,
    sourceOrigin:
      typeof value.sourceOrigin === "string" ? value.sourceOrigin : null,
    localRelativePath:
      typeof value.localRelativePath === "string"
        ? value.localRelativePath
        : null,
  };
}

function parsePublicationRecord(value: unknown): PublicationRecord | null {
  if (!isRecord(value) || !isRecord(value.publication)) return null;
  const publication = value.publication;
  const contentRevision = value.contentRevision;
  const transitions = publication.transitions;
  const assets = value.assets;
  if (
    typeof publication.id !== "string" ||
    typeof publication.platformId !== "string" ||
    typeof publication.accountId !== "string" ||
    typeof publication.contentRevisionId !== "string" ||
    (publication.platformContentId !== undefined &&
      typeof publication.platformContentId !== "string") ||
    (publication.platformContentUrl !== undefined &&
      typeof publication.platformContentUrl !== "string") ||
    normalizePublicationState(publication.state) === null ||
    !Array.isArray(transitions) ||
    !transitions.every(
      (transition) =>
        isRecord(transition) &&
        normalizePublicationState(transition.from) !== null &&
        normalizePublicationState(transition.to) !== null &&
        typeof transition.occurredAt === "string" &&
        (transition.reason === undefined ||
          typeof transition.reason === "string"),
    ) ||
    !isRecord(contentRevision) ||
    typeof contentRevision.id !== "string" ||
    typeof contentRevision.contentItemId !== "string" ||
    typeof contentRevision.revision !== "number" ||
    (contentRevision.title !== undefined &&
      typeof contentRevision.title !== "string") ||
    typeof contentRevision.body !== "string" ||
    !Array.isArray(contentRevision.assetIds) ||
    !contentRevision.assetIds.every((id) => typeof id === "string") ||
    typeof contentRevision.createdAt !== "string" ||
    !Array.isArray(assets) ||
    !assets.every(
      (asset) =>
        isRecord(asset) &&
        typeof asset.id === "string" &&
        typeof asset.name === "string" &&
        typeof asset.size === "number",
    ) ||
    (value.contentForm !== "video" && value.contentForm !== "imageText") ||
    typeof value.rulesVersion !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    (value.lastMessage !== undefined && typeof value.lastMessage !== "string")
  ) {
    return null;
  }
  const contentForm = value.contentForm as PublicationRecord["contentForm"];
  return {
    ...(value as unknown as PublicationRecord),
    requestId:
      typeof value.requestId === "string"
        ? value.requestId
        : `legacy:${String(publication.id)}`,
    publication: {
      ...(publication as unknown as PublicationRecord["publication"]),
      state: normalizePublicationState(publication.state)!,
      transitions: transitions.map((transition) => {
        const stored = transition as Record<string, unknown>;
        return {
          from: normalizePublicationState(stored.from)!,
          to: normalizePublicationState(stored.to)!,
          occurredAt: stored.occurredAt as string,
          ...(typeof stored.reason === "string"
            ? { reason: stored.reason }
            : {}),
        };
      }),
    },
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    submissionMode:
      value.submissionMode === "automatic" ||
      value.submissionMode === "manual_confirmation"
        ? value.submissionMode
        : "legacy_unknown",
    retained: value.retained === true,
    assets: assets.map((asset, order) =>
      normalizeAsset(asset as Record<string, unknown>, contentForm, order),
    ),
  };
}

export function parseStoredPublications(value: unknown): PublicationRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parsePublicationRecord)
    .filter((record): record is PublicationRecord => record !== null);
}

export function assertSupportedPublicationStoreVersion(value: unknown): void {
  if (
    value === undefined ||
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === publicationStoreSchemaVersion
  )
    return;
  throw new Error(
    `Unsupported publication store schema version: ${String(value)}`,
  );
}

export function mergeStoredPublication(
  value: unknown,
  record: PublicationRecord,
): unknown[] {
  const stored = Array.isArray(value) ? [...value] : [];
  const index = stored.findIndex(
    (candidate) =>
      parsePublicationRecord(candidate)?.publication.id ===
      record.publication.id,
  );
  if (index === -1) stored.push(record);
  else stored[index] = record;
  return stored;
}

export function removeStoredPublication(
  value: unknown,
  publicationId: string,
): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (candidate) =>
      parsePublicationRecord(candidate)?.publication.id !== publicationId,
  );
}

export function toPublicationSummary(
  record: PublicationRecord,
): PublicationSummary {
  const { publication, contentRevision } = record;
  return {
    id: publication.id,
    requestId: record.requestId,
    platformId: publication.platformId,
    accountId: publication.accountId,
    contentForm: record.contentForm,
    title: contentRevision.title ?? null,
    body: contentRevision.body,
    assets: record.assets.map(({ name, size }) => ({ name, size })),
    state: publication.state,
    transitions: publication.transitions.map((transition) => ({
      ...transition,
      reason: transition.reason ?? null,
    })),
    rulesVersion: record.rulesVersion,
    retained: record.retained,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastMessage: record.lastMessage ?? null,
    platformContentId: publication.platformContentId ?? null,
    platformContentUrl: publication.platformContentUrl ?? null,
  };
}

export class ElectronPublicationRepository implements PublicationRepository {
  private readonly store = new Store<PublicationStoreSchema>({
    name: "matrix-publications",
  });

  list(): PublicationRecord[] {
    assertSupportedPublicationStoreVersion(this.store.get("schemaVersion"));
    return parseStoredPublications(this.store.get("publications")).sort(
      (left, right) => right.createdAt.localeCompare(left.createdAt),
    );
  }

  get(publicationId: string): PublicationRecord | undefined {
    return this.list().find(
      (record) => record.publication.id === publicationId,
    );
  }

  save(record: PublicationRecord): void {
    assertSupportedPublicationStoreVersion(this.store.get("schemaVersion"));
    const records = mergeStoredPublication(
      this.store.get("publications"),
      record,
    );
    this.store.set("schemaVersion", publicationStoreSchemaVersion);
    this.store.set("publications", records);
  }

  remove(publicationId: string): void {
    assertSupportedPublicationStoreVersion(this.store.get("schemaVersion"));
    const records = removeStoredPublication(
      this.store.get("publications"),
      publicationId,
    );
    this.store.set("schemaVersion", publicationStoreSchemaVersion);
    this.store.set("publications", records);
  }
}
