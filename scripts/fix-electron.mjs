import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, "..");
const require = createRequire(import.meta.url);
const platform = process.env.npm_config_platform || process.platform;
const architecture = process.env.npm_config_arch || process.arch;
const cacheDirectory =
  process.env.electron_config_cache ||
  join(homedir(), "Library", "Caches", "electron");

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function findCachedArchive(version) {
  if (!existsSync(cacheDirectory)) return null;
  const archiveName = `electron-v${version}-${platform}-${architecture}.zip`;
  for (const entry of readdirSync(cacheDirectory)) {
    const archive = join(cacheDirectory, entry, archiveName);
    if (existsSync(archive)) return archive;
  }
  return null;
}

function isCompleteInstallation(packageDirectory) {
  return (
    existsSync(join(packageDirectory, "path.txt")) &&
    existsSync(
      join(packageDirectory, "dist", "Electron.app", "Contents", "Frameworks"),
    )
  );
}

async function reinstallFromArchive(packageDirectory, archive) {
  const distDirectory = join(packageDirectory, "dist");
  rmSync(distDirectory, { recursive: true, force: true });
  mkdirSync(distDirectory, { recursive: true });
  await run("unzip", ["-q", archive, "-d", distDirectory]);
  writeFileSync(
    join(packageDirectory, "path.txt"),
    "Electron.app/Contents/MacOS/Electron",
  );
}

async function main() {
  if (process.platform !== "darwin") return;

  const packageJsonPath = require.resolve("electron/package.json", {
    paths: [join(workspaceRoot, "apps", "desktop")],
  });
  const packageDirectory = dirname(packageJsonPath);
  if (isCompleteInstallation(packageDirectory)) return;

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const version = packageJson.version;
  let archive = findCachedArchive(version);
  if (!archive) {
    await run(process.execPath, [join(packageDirectory, "install.js")]);
    if (isCompleteInstallation(packageDirectory)) return;
    archive = findCachedArchive(version);
  }
  if (!archive) {
    throw new Error(`Electron ${version} is installed without its app bundle`);
  }

  await reinstallFromArchive(packageDirectory, archive);
  if (!isCompleteInstallation(packageDirectory)) {
    throw new Error(
      `Electron ${version} app bundle is incomplete after repair`,
    );
  }
}

main().catch((error) => {
  console.error("[fix-electron]", error);
  process.exitCode = 1;
});
