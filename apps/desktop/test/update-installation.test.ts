import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  installationTarget,
  recordUpdateStartup,
  type InstallContext,
} from "../src/main/updates/update-installation.js";
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "nedia-install-test-"));
  directories.push(directory);
  // Use a canonical path on macOS, where /var is a symlink to /private/var.
  const { realpath } = await import("node:fs/promises");
  const root = await realpath(directory);
  const target = join(root, "NediaMatrix.app");
  await mkdir(target);
  const context: InstallContext = {
    packaged: true,
    platform: "darwin",
    arch: "arm64",
    distribution: "app-zip",
    executable: join(target, "Contents", "MacOS", "NediaMatrix"),
    resources: root,
    userData: root,
    currentVersion: "0.4.0",
  };
  return { context, root, target };
}
it("rejects development installs and ambiguous portable launcher paths", async () => {
  const { context, root } = await setup();
  await expect(
    installationTarget({ ...context, packaged: false }),
  ).rejects.toThrow("开发环境");
  const windows = { ...context, platform: "win32", distribution: "portable" };
  await expect(installationTarget(windows)).rejects.toThrow("原始 EXE");
  const launcher = join(root, "renamed portable.exe");
  await writeFile(launcher, "fixture");
  await expect(
    installationTarget({
      ...windows,
      portableExecutable: launcher,
      portableDirectory: root,
    }),
  ).resolves.toBe(launcher);
  await expect(
    installationTarget({
      ...windows,
      portableExecutable: launcher,
      portableDirectory: join(root, "wrong"),
    }),
  ).rejects.toThrow("不一致");
});
it("rejects a symlink target instead of following it for replacement", async () => {
  const { context, target, root } = await setup();
  const linked = join(root, "Linked.app");
  await symlink(target, linked);
  await expect(
    installationTarget({
      ...context,
      executable: join(linked, "Contents", "MacOS", "NediaMatrix"),
    }),
  ).rejects.toThrow("目标类型");
});
it("records migration and success only for the matching version, target and distribution", async () => {
  const { context, root, target } = await setup();
  const id = "12345678-1234-1234-1234-123456789abc";
  const directory = join(root, "application-updates", "installations", id);
  await mkdir(directory, { recursive: true });
  const journal = {
    stage: "launching",
    request: {
      id,
      appId: "com.nediamatrix.desktop",
      version: "0.4.0",
      target,
      distribution: "app-zip",
      platform: "darwin",
      arch: "arm64",
    },
  };
  await writeFile(join(directory, "journal.json"), JSON.stringify(journal));
  await recordUpdateStartup({ ...context, currentVersion: "0.3.3" }, true);
  await expect(readFile(join(directory, "success"))).rejects.toThrow();
  await recordUpdateStartup(context, false);
  expect(await readFile(join(directory, "migration-started"), "utf8")).toBe(id);
  await expect(readFile(join(directory, "success"))).rejects.toThrow();
  await recordUpdateStartup(context, true);
  expect(await readFile(join(directory, "success"), "utf8")).toBe(id);
});
it("ignores malformed unrelated journals so they cannot prevent application startup", async () => {
  const { context, root } = await setup();
  const directory = join(
    root,
    "application-updates",
    "installations",
    "12345678-1234-1234-1234-123456789abc",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "journal.json"), "incomplete");
  await expect(recordUpdateStartup(context, false)).resolves.toBeUndefined();
});

async function portableInstallation(stage = "launching") {
  const { context, root } = await setup();
  const target = join(root, "改名的绿色版 app.exe");
  await writeFile(target, "new version");
  const portable: InstallContext = {
    ...context,
    platform: "win32",
    arch: "x64",
    distribution: "portable",
    portableExecutable: target,
    portableDirectory: root,
  };
  const id = "12345678-1234-1234-1234-123456789abc";
  const directory = join(root, "application-updates", "installations", id);
  await mkdir(directory, { recursive: true });
  const backup = `${target}.nedia-backup-${id}`;
  await writeFile(backup, "old version");
  const journal = {
    stage,
    backup,
    request: {
      id,
      appId: "com.nediamatrix.desktop",
      version: portable.currentVersion,
      target,
      distribution: "portable",
      platform: "win32",
      arch: "x64",
    },
  };
  await writeFile(join(directory, "journal.json"), JSON.stringify(journal));
  return { context: portable, directory, target, backup, id, journal, root };
}

it("recycles the original portable EXE only after confirmed startup and never touches the new EXE", async () => {
  const { context, directory, backup, target, id, root } =
    await portableInstallation();
  const trash = vi.fn(async (file: string) => {
    expect(await readFile(join(directory, "success"), "utf8")).toBe(id);
    await rename(file, join(root, "fake-recycle-bin"));
  });
  await recordUpdateStartup(context, false, trash);
  expect(trash).not.toHaveBeenCalled();
  expect(await readFile(backup, "utf8")).toBe("old version");
  await recordUpdateStartup(context, true, trash);
  expect(trash).toHaveBeenCalledExactlyOnceWith(backup);
  expect(await readFile(target, "utf8")).toBe("new version");
  expect(
    JSON.parse(await readFile(join(directory, "backup-recycle.json"), "utf8"))
      .status,
  ).toBe("recycled");
  await recordUpdateStartup(context, true, trash);
  expect(trash).toHaveBeenCalledOnce();
});

it("retains the old EXE when recycling fails without changing update success", async () => {
  const { context, directory, backup, id } = await portableInstallation();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const trash = vi.fn(async () => {
    throw new Error("Recycle Bin unavailable");
  });
  await expect(
    recordUpdateStartup(context, true, trash),
  ).resolves.toBeUndefined();
  expect(await readFile(backup, "utf8")).toBe("old version");
  expect(await readFile(join(directory, "success"), "utf8")).toBe(id);
  expect(
    JSON.parse(await readFile(join(directory, "backup-recycle.json"), "utf8")),
  ).toMatchObject({ status: "failed", error: "Recycle Bin unavailable" });
});

it.each(["backup-pending", "replace-pending", "launch-pending"])(
  "does not recycle an unconfirmed update in %s",
  async (stage) => {
    const { context, backup } = await portableInstallation(stage);
    const trash = vi.fn();
    await recordUpdateStartup(context, true, trash);
    expect(trash).not.toHaveBeenCalled();
    expect(await readFile(backup, "utf8")).toBe("old version");
  },
);

it("rejects a tampered backup path and a symlink without recycling unrelated files", async () => {
  const { context, directory, journal, backup, root } =
    await portableInstallation();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const unrelated = join(root, "unrelated.exe");
  await writeFile(unrelated, "keep");
  const trash = vi.fn();
  await writeFile(
    join(directory, "journal.json"),
    JSON.stringify({ ...journal, backup: unrelated }),
  );
  await recordUpdateStartup(context, true, trash);
  expect(trash).not.toHaveBeenCalled();
  await writeFile(join(directory, "journal.json"), JSON.stringify(journal));
  await rm(backup);
  await symlink(unrelated, backup);
  await recordUpdateStartup(context, true, trash);
  expect(trash).not.toHaveBeenCalled();
  expect(await readFile(unrelated, "utf8")).toBe("keep");
});

it("does not recycle macOS backups", async () => {
  const { context, root, target } = await setup();
  const id = "12345678-1234-1234-1234-123456789abc";
  const directory = join(root, "application-updates", "installations", id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "journal.json"),
    JSON.stringify({
      stage: "launching",
      request: {
        id,
        appId: "com.nediamatrix.desktop",
        version: context.currentVersion,
        target,
        distribution: "app-zip",
        platform: "darwin",
        arch: "arm64",
      },
    }),
  );
  const trash = vi.fn();
  await recordUpdateStartup(context, true, trash);
  expect(trash).not.toHaveBeenCalled();
});

it("can recycle a completed portable update after a restart when its success marker exists", async () => {
  const { context, directory, backup, id, root } =
    await portableInstallation("completed");
  const trash = vi.fn(async (file: string) => {
    await rename(file, join(root, "fake-recycle-bin"));
  });
  await recordUpdateStartup(context, true, trash);
  expect(trash).not.toHaveBeenCalled();
  await writeFile(join(directory, "success"), id);
  await recordUpdateStartup(context, true, trash);
  expect(trash).toHaveBeenCalledExactlyOnceWith(backup);
});

it("does not recycle NSIS files", async () => {
  const { context, directory, target, journal } =
    await portableInstallation("installer-starting");
  const nsis = { ...context, distribution: "nsis", executable: target };
  await writeFile(
    join(directory, "journal.json"),
    JSON.stringify({
      ...journal,
      request: { ...journal.request, distribution: "nsis" },
    }),
  );
  const trash = vi.fn();
  await recordUpdateStartup(nsis, true, trash);
  expect(trash).not.toHaveBeenCalled();
});

it("merges concurrent startup confirmations into one recycling operation", async () => {
  const { context, root } = await portableInstallation();
  let finish!: () => void;
  const trash = vi.fn(async (file: string) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await rename(file, join(root, "fake-recycle-bin"));
  });
  const first = recordUpdateStartup(context, true, trash);
  const second = recordUpdateStartup(context, true, trash);
  await vi.waitFor(() => expect(trash).toHaveBeenCalledOnce());
  finish();
  await Promise.all([first, second]);
  expect(trash).toHaveBeenCalledOnce();
});
