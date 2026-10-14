import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicationAssetSnapshot } from "@nedia-matrix/publishing";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  openPath: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      mocks.handlers.set(name, handler),
  },
  shell: { openPath: mocks.openPath },
}));
import { ipcChannels } from "../src/bridge/channels.js";
import { registerPublicationAssetIpc } from "../src/main/publishing/ipc/register-publication-asset-ipc.js";

function fixture() {
  const assets = [
    { localRelativePath: "sha256/aa/image.jpg" },
  ] as PublicationAssetSnapshot[];
  const resolvePath = vi.fn(
    async () => "/archive/image.jpg" as string | undefined,
  );
  registerPublicationAssetIpc({
    getAssets: (id) => (id === "publication-1" ? assets : undefined),
    resolvePath,
  });
  const open = (request: unknown) =>
    mocks.handlers.get(ipcChannels.openPublicationAsset)!(null, request);
  return { open, resolvePath, assets };
}
const request = { publicationId: "publication-1", assetIndex: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.handlers.clear();
  mocks.openPath.mockResolvedValue("");
});

describe("opening archived publication assets", () => {
  it("opens the stored file with the system and ignores renderer-supplied paths", async () => {
    const { open, resolvePath } = fixture();
    await expect(
      open({ ...request, path: "/outside/file" }),
    ).resolves.toBeUndefined();
    expect(resolvePath).toHaveBeenCalledExactlyOnceWith("sha256/aa/image.jpg");
    expect(mocks.openPath).toHaveBeenCalledExactlyOnceWith(
      "/archive/image.jpg",
    );
  });

  it("rejects invalid requests before resolving any file", async () => {
    const { open, resolvePath } = fixture();
    for (const input of [
      null,
      {},
      { ...request, publicationId: "" },
      { ...request, assetIndex: -1 },
      { ...request, assetIndex: 0.5 },
      { ...request, assetIndex: "0" },
    ]) {
      await expect(open(input)).rejects.toThrow(
        "Invalid publication asset request",
      );
    }
    expect(resolvePath).not.toHaveBeenCalled();
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("reports unknown, unarchived and missing files without opening them", async () => {
    const { open, resolvePath, assets } = fixture();
    await expect(
      open({ ...request, publicationId: "unknown" }),
    ).rejects.toThrow("素材记录不存在");
    await expect(open({ ...request, assetIndex: 1 })).rejects.toThrow(
      "素材记录不存在",
    );
    resolvePath.mockResolvedValue(undefined);
    await expect(open(request)).rejects.toThrow("素材文件已缺失或被清理");
    assets[0]!.localRelativePath = null;
    await expect(open(request)).rejects.toThrow("该素材没有本地归档文件");
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("surfaces system application errors", async () => {
    const { open } = fixture();
    mocks.openPath.mockResolvedValue("No application associated");
    await expect(open(request)).rejects.toThrow(
      "无法打开素材文件：No application associated",
    );
  });
});
