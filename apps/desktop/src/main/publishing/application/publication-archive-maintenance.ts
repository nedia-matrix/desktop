import type { PublicationRecord } from "@nedia-matrix/application-publishing";

import type {
  ContentAddressedPublicationAssetStore,
  StoredPublicationAsset,
} from "../infrastructure/content-addressed-asset-store.js";
import type { ElectronPublicationRepository } from "../infrastructure/electron-publication-repository.js";

type ArchiveRepositoryPort = Pick<
  ElectronPublicationRepository,
  "get" | "list" | "remove" | "save"
>;
type AssetStorePort = Pick<
  ContentAddressedPublicationAssetStore,
  "list" | "remove"
>;

export interface PublicationArchiveUsage {
  assetCount: number;
  publicationCount: number;
  referencedBytes: number;
  retainedPublicationCount: number;
  totalBytes: number;
  unreferencedBytes: number;
}

export interface PublicationArchiveCleanupPolicy {
  maxBytes?: number;
  retentionBefore?: Date;
}

export interface PublicationArchiveCleanupResult {
  remainingBytes: number;
  removedAssetCount: number;
  removedPublicationIds: string[];
  reclaimedBytes: number;
}

const removableStates = new Set(["published", "failed", "uncertain"]);

export class PublicationArchiveMaintenance {
  constructor(
    private readonly publications: ArchiveRepositoryPort,
    private readonly assets: AssetStorePort,
  ) {}

  async usage(): Promise<PublicationArchiveUsage> {
    const publications = this.publications.list();
    const assets = await this.assets.list();
    const referencedPaths = publicationAssetPaths(publications);
    const referencedBytes = sumAssetBytes(assets, referencedPaths);
    const totalBytes = sumAssetBytes(assets);
    return {
      assetCount: assets.length,
      publicationCount: publications.length,
      referencedBytes,
      retainedPublicationCount: publications.filter(({ retained }) => retained)
        .length,
      totalBytes,
      unreferencedBytes: totalBytes - referencedBytes,
    };
  }

  setRetained(publicationId: string, retained: boolean): PublicationRecord {
    const record = this.requirePublication(publicationId);
    const updated = { ...record, retained };
    this.publications.save(updated);
    return updated;
  }

  async removePublication(
    publicationId: string,
  ): Promise<PublicationArchiveCleanupResult> {
    const record = this.requirePublication(publicationId);
    if (!removableStates.has(record.publication.state)) {
      throw new TypeError("An active publication archive cannot be removed");
    }
    this.publications.remove(publicationId);
    return this.removeUnreferencedAssets([publicationId]);
  }

  async cleanup(
    policy: PublicationArchiveCleanupPolicy,
  ): Promise<PublicationArchiveCleanupResult> {
    validatePolicy(policy);
    const initialAssets = await this.assets.list();
    const initialBytes = sumAssetBytes(initialAssets);
    const removedPublicationIds: string[] = [];
    let remaining = this.publications.list();
    const candidates = remaining
      .filter(
        (record) =>
          !record.retained && removableStates.has(record.publication.state),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    for (const candidate of candidates) {
      const expired =
        policy.retentionBefore !== undefined &&
        candidate.createdAt < policy.retentionBefore.toISOString();
      const overQuota =
        policy.maxBytes !== undefined &&
        sumAssetBytes(initialAssets, publicationAssetPaths(remaining)) >
          policy.maxBytes;
      if (!expired && !overQuota) continue;
      this.publications.remove(candidate.publication.id);
      removedPublicationIds.push(candidate.publication.id);
      remaining = remaining.filter(
        (record) => record.publication.id !== candidate.publication.id,
      );
    }
    return this.removeUnreferencedAssets(
      removedPublicationIds,
      initialAssets,
      initialBytes,
    );
  }

  private async removeUnreferencedAssets(
    removedPublicationIds: string[],
    inventory?: StoredPublicationAsset[],
    initialBytes?: number,
  ): Promise<PublicationArchiveCleanupResult> {
    const assets = inventory ?? (await this.assets.list());
    const beforeBytes = initialBytes ?? sumAssetBytes(assets);
    const referencedPaths = publicationAssetPaths(this.publications.list());
    const unreferenced = assets.filter(
      ({ relativePath }) => !referencedPaths.has(relativePath),
    );
    await Promise.all(
      unreferenced.map(({ relativePath }) => this.assets.remove(relativePath)),
    );
    const reclaimedBytes = sumAssetBytes(unreferenced);
    return {
      remainingBytes: beforeBytes - reclaimedBytes,
      removedAssetCount: unreferenced.length,
      removedPublicationIds,
      reclaimedBytes,
    };
  }

  private requirePublication(publicationId: string): PublicationRecord {
    const record = this.publications.get(publicationId);
    if (!record) throw new TypeError("Publication does not exist");
    return record;
  }
}

function publicationAssetPaths(
  publications: readonly PublicationRecord[],
): Set<string> {
  return new Set(
    publications.flatMap(({ assets }) =>
      assets.flatMap(({ localRelativePath }) =>
        localRelativePath === null ? [] : [localRelativePath],
      ),
    ),
  );
}

function sumAssetBytes(
  assets: readonly StoredPublicationAsset[],
  includedPaths?: ReadonlySet<string>,
): number {
  return assets.reduce(
    (total, asset) =>
      includedPaths === undefined || includedPaths.has(asset.relativePath)
        ? total + asset.size
        : total,
    0,
  );
}

function validatePolicy(policy: PublicationArchiveCleanupPolicy): void {
  if (
    policy.maxBytes !== undefined &&
    (!Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 0)
  ) {
    throw new TypeError("Archive maxBytes must be a non-negative safe integer");
  }
  if (
    policy.retentionBefore !== undefined &&
    !Number.isFinite(policy.retentionBefore.getTime())
  ) {
    throw new TypeError("Archive retentionBefore must be a valid date");
  }
}
