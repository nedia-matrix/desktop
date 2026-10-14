import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentAddressedPublicationAssetStore } from "../src/main/publishing/infrastructure/content-addressed-asset-store.js";
import { LocalAssetArchiver } from "../src/main/publishing/infrastructure/local-asset-archiver.js";
import { readLocalMediaResources } from "../src/main/publishing/ipc/local-media-resources.js";
import { registerLocalMedia } from "../../../packages/contexts/publishing/src/application/local-media-registration.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nedia-local-archive-"));
  roots.push(root);
  const store = new ContentAddressedPublicationAssetStore(join(root, "assets"));
  const archiver = new LocalAssetArchiver(store, join(root, "staging"));
  return { root, store, archiver };
}

describe("local media archiving", () => {
  it("keeps an independent copy and carries its metadata into the selection", async () => {
    const { root, store, archiver } = await fixture();
    const original = join(root, "photo.jpg");
    await writeFile(original, "original photo bytes");
    const resources = await archiver.archive(
      await readLocalMediaResources([original]),
    );
    const asset = resources[0]!;
    expect(asset).toMatchObject({
      name: "photo.jpg",
      mediaType: "image/jpeg",
      hash: createHash("sha256").update("original photo bytes").digest("hex"),
    });
    expect(await store.resolvePath(asset.localRelativePath!)).toBe(
      asset.reference,
    );
    await writeFile(original, "edited photo");
    expect(await readFile(asset.reference, "utf8")).toBe(
      "original photo bytes",
    );
    await unlink(original);
    expect(await readFile(asset.reference, "utf8")).toBe(
      "original photo bytes",
    );

    const create = vi.fn(() => "selection-1");
    registerLocalMedia(
      { accountId: "account-1", contentForm: "imageText", resources },
      {
        accounts: {
          require: () => ({
            id: "account-1",
            platformId: "mock",
            lifecycle: "active",
            status: "authenticated",
          }),
        },
        platforms: {
          require: () => ({
            publishing: { forms: { imageText: { constraints: {} } } },
          }),
        },
        mediaSelections: { create },
      } as unknown as Parameters<typeof registerLocalMedia>[1],
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceReferences: [asset.reference],
        files: [
          expect.objectContaining({
            localRelativePath: asset.localRelativePath,
            hash: asset.hash,
            mediaType: "image/jpeg",
          }),
        ],
      }),
    );
    expect(await readdir(join(root, "staging"))).toEqual([]);
  });

  it("archives every format supported by the native file picker and deduplicates", async () => {
    const { root, store, archiver } = await fixture();
    for (const extension of [
      "jpg",
      "jpeg",
      "png",
      "webp",
      "mp4",
      "mov",
      "m4v",
      "webm",
    ]) {
      const original = join(root, `media.${extension}`);
      await writeFile(original, extension);
      const resources = await readLocalMediaResources([original]);
      const [first] = await archiver.archive(resources);
      const [second] = await archiver.archive(resources);
      expect(second?.localRelativePath).toBe(first?.localRelativePath);
      expect(await store.resolvePath(first!.localRelativePath!)).toBe(
        first!.reference,
      );
    }
    expect(await store.list()).toHaveLength(8);
  });

  it("cleans staging files when the selected original can no longer be read", async () => {
    const { root, archiver } = await fixture();
    const original = join(root, "photo.jpg");
    await writeFile(original, "photo");
    const resources = await readLocalMediaResources([original]);
    await unlink(original);
    await expect(archiver.archive(resources)).rejects.toThrow();
    expect(await readdir(join(root, "staging"))).toEqual([]);
  });
});
