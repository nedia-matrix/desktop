import type { PublicationRecord } from "@nedia-matrix/application-publishing";
import { describe, expect, it } from "vitest";

import { PublicationArchiveMaintenance } from "../src/main/publishing/publication-archive-maintenance.js";

class MemoryPublications {
  readonly records = new Map<string, PublicationRecord>();

  list() {
    return [...this.records.values()];
  }

  get(id: string) {
    return this.records.get(id);
  }

  save(record: PublicationRecord) {
    this.records.set(record.publication.id, record);
  }

  remove(id: string) {
    this.records.delete(id);
  }
}

class MemoryAssets {
  readonly files = new Map<string, number>();

  async list() {
    return [...this.files].map(([relativePath, size]) => ({
      relativePath,
      size,
    }));
  }

  async remove(relativePath: string) {
    this.files.delete(relativePath);
  }
}

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const pathA = `sha256/aa/${hashA}.png`;
const pathB = `sha256/bb/${hashB}.png`;
const pathC = `sha256/cc/${hashC}.png`;

function publication(
  id: string,
  options: {
    createdAt?: string;
    path?: string;
    retained?: boolean;
    state?: PublicationRecord["publication"]["state"];
  } = {},
): PublicationRecord {
  const createdAt = options.createdAt ?? "2026-08-01T00:00:00.000Z";
  const assetId = `asset-${id}`;
  return {
    requestId: `request-${id}`,
    publication: {
      id,
      platformId: "douyin",
      accountId: "account-1",
      contentRevisionId: `revision-${id}`,
      state: options.state ?? "published",
      transitions: [],
    },
    contentRevision: {
      id: `revision-${id}`,
      contentItemId: id,
      revision: 1,
      title: "标题",
      body: "正文",
      assetIds: [assetId],
      createdAt,
    },
    contentForm: "imageText",
    tags: [],
    submissionMode: "automatic",
    retained: options.retained ?? false,
    assets: [
      {
        id: assetId,
        name: "image.png",
        size: 60,
        role: "image",
        order: 0,
        mediaType: "image/png",
        hash: options.path?.split("/").at(-1)?.split(".")[0] ?? null,
        downloadedAt: createdAt,
        sourceAssetId: null,
        sourceOrigin: "https://assets.example.test",
        localRelativePath: options.path ?? null,
      },
    ],
    rulesVersion: "test",
    createdAt,
    updatedAt: createdAt,
  };
}

function fixture(records: PublicationRecord[], files: Array<[string, number]>) {
  const publications = new MemoryPublications();
  records.forEach((record) => publications.save(record));
  const assets = new MemoryAssets();
  files.forEach(([path, size]) => assets.files.set(path, size));
  return {
    publications,
    assets,
    maintenance: new PublicationArchiveMaintenance(publications, assets),
  };
}

describe("PublicationArchiveMaintenance", () => {
  it("reports deduplicated referenced and orphaned disk usage", async () => {
    const { maintenance } = fixture(
      [
        publication("one", { path: pathA }),
        publication("two", { path: pathA }),
      ],
      [
        [pathA, 60],
        [pathB, 40],
      ],
    );

    await expect(maintenance.usage()).resolves.toEqual({
      assetCount: 2,
      publicationCount: 2,
      referencedBytes: 60,
      retainedPublicationCount: 0,
      totalBytes: 100,
      unreferencedBytes: 40,
    });
  });

  it("cleans expired terminal records but preserves shared, retained, and active data", async () => {
    const old = "2026-07-01T00:00:00.000Z";
    const recent = "2026-08-09T00:00:00.000Z";
    const { assets, maintenance, publications } = fixture(
      [
        publication("expired", {
          createdAt: old,
          path: pathA,
          state: "failed",
        }),
        publication("shared", { createdAt: recent, path: pathA }),
        publication("retained", {
          createdAt: old,
          path: pathB,
          retained: true,
        }),
        publication("active", {
          createdAt: old,
          path: pathC,
          state: "submitting",
        }),
      ],
      [
        [pathA, 60],
        [pathB, 70],
        [pathC, 80],
        [`sha256/dd/${"d".repeat(64)}.png`, 10],
      ],
    );

    const result = await maintenance.cleanup({
      retentionBefore: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      removedPublicationIds: ["expired"],
      removedAssetCount: 1,
      reclaimedBytes: 10,
    });
    expect(publications.records.has("retained")).toBe(true);
    expect(publications.records.has("active")).toBe(true);
    expect(assets.files.has(pathA)).toBe(true);
  });

  it("removes oldest eligible archives until the byte quota is met", async () => {
    const { maintenance, publications } = fixture(
      [
        publication("oldest", {
          createdAt: "2026-07-01T00:00:00.000Z",
          path: pathA,
        }),
        publication("newest", {
          createdAt: "2026-08-01T00:00:00.000Z",
          path: pathB,
        }),
      ],
      [
        [pathA, 60],
        [pathB, 60],
      ],
    );

    const result = await maintenance.cleanup({ maxBytes: 60 });

    expect(result).toMatchObject({
      remainingBytes: 60,
      removedPublicationIds: ["oldest"],
      reclaimedBytes: 60,
    });
    expect(publications.records.has("newest")).toBe(true);
  });

  it("only deletes shared content after its final publication is manually removed", async () => {
    const { assets, maintenance } = fixture(
      [
        publication("one", { path: pathA }),
        publication("two", { path: pathA }),
      ],
      [[pathA, 60]],
    );

    await expect(maintenance.removePublication("one")).resolves.toMatchObject({
      removedAssetCount: 0,
    });
    expect(assets.files.has(pathA)).toBe(true);
    await expect(maintenance.removePublication("two")).resolves.toMatchObject({
      removedAssetCount: 1,
      reclaimedBytes: 60,
    });
    expect(assets.files.has(pathA)).toBe(false);
  });

  it("supports retention pins and refuses to remove active archives", async () => {
    const active = publication("active", { path: pathA, state: "verifying" });
    const terminal = publication("terminal", { path: pathB });
    const { maintenance } = fixture(
      [active, terminal],
      [
        [pathA, 60],
        [pathB, 60],
      ],
    );

    expect(maintenance.setRetained("terminal", true).retained).toBe(true);
    await expect(maintenance.removePublication("active")).rejects.toThrow(
      "active publication archive",
    );
  });
});
