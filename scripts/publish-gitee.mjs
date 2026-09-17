#!/usr/bin/env node

import { createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const GITEE_REMOTE_NAME = "gitee";
const GITEE_REMOTE_URL = "https://gitee.com/nedia-matrix/desktop.git";
const GITEE_API_BASE = "https://gitee.com/api/v5/repos/nedia-matrix/desktop";
const PUBLIC_ORIGIN_URL = "https://github.com/nedia-matrix/desktop.git";
const VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const MAX_ATTACHMENT_BYTES = 100_000_000;
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

function printHelp() {
  console.log(`用法：pnpm publish:gitee -- --tag v1.2.3 [选项]

选项：
  --platform <auto|mac|win|all>  打包并上传的平台；Mac 的 auto 为 all
  --assets <目录>                安装包目录，默认 apps/desktop/dist
  --skip-build                   跳过打包，只上传现有文件
  --skip-push                    跳过代码和 tag 推送
  --help                         显示帮助

环境变量：
  GITEE_TOKEN                    必填，Gitee 私人令牌
`);
}

function parseArguments(argv) {
  const options = {
    assets: "apps/desktop/dist",
    platform: "auto",
    skipBuild: false,
    skipPush: false,
    tag: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help") {
      printHelp();
      process.exit(0);
    }
    if (argument === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    if (argument === "--skip-push") {
      options.skipPush = true;
      continue;
    }
    if (
      argument === "--tag" ||
      argument === "--platform" ||
      argument === "--assets"
    ) {
      const value = argv[index + 1];
      if (!value) throw new Error(`参数 ${argument} 缺少值。`);
      index += 1;
      if (argument === "--tag") options.tag = value;
      if (argument === "--platform") options.platform = value;
      if (argument === "--assets") options.assets = value;
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }

  if (!VERSION_PATTERN.test(options.tag)) {
    throw new Error("必须通过 --tag 指定 v数字.数字.数字 格式的版本。");
  }
  if (!["auto", "mac", "win", "all"].includes(options.platform)) {
    throw new Error("--platform 必须是 auto、mac、win 或 all。");
  }
  return options;
}

function executable(name) {
  return process.platform === "win32" && name === "pnpm" ? "pnpm.cmd" : name;
}

function run(command, args, options = {}) {
  const result = spawnSync(executable(command), args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? result.stderr.trim() : "";
    throw new Error(
      `${command} ${args.join(" ")} 执行失败${detail ? `：${detail}` : ""}`,
    );
  }
  return options.capture ? result.stdout.trim() : "";
}

function resolvePlatform(requestedPlatform) {
  if (requestedPlatform !== "auto") return requestedPlatform;
  if (process.platform === "darwin") return "all";
  if (process.platform === "win32") return "win";
  throw new Error(
    "当前系统不能自动选择桌面打包平台，请使用 --platform 和 --skip-build。",
  );
}

function selectedPlatforms(platform) {
  return platform === "all" ? ["mac", "win"] : [platform];
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  const file = await openAsBlob(filePath);
  for await (const chunk of file.stream()) hash.update(chunk);
  return hash.digest("hex");
}

async function requestJson(url, options = {}) {
  const {
    allowNotFound = false,
    timeout: timeoutMs = REQUEST_TIMEOUT_MS,
    ...requestOptions
  } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...requestOptions,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...requestOptions.headers,
      },
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (response.status === 404 && allowNotFound) return null;
    if (!response.ok) {
      const detail =
        typeof payload === "string" ? payload : JSON.stringify(payload);
      throw new Error(`Gitee API ${response.status}：${detail}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function authenticatedUrl(path, token, parameters = {}) {
  const url = new URL(`${GITEE_API_BASE}${path}`);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function submitRelease(path, method, token, fields) {
  return requestJson(`${GITEE_API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: token, ...fields }),
  });
}

async function getRelease(tag, token) {
  return requestJson(authenticatedUrl(`/releases/tags/${tag}`, token), {
    allowNotFound: true,
  });
}

async function getAttachments(releaseId, token) {
  const payload = await requestJson(
    authenticatedUrl(`/releases/${releaseId}/attach_files`, token, {
      per_page: 100,
    }),
  );
  if (!Array.isArray(payload)) {
    throw new Error("Gitee 附件接口未返回数组。");
  }
  return payload;
}

async function deleteAttachment(releaseId, attachmentId, token) {
  await requestJson(
    authenticatedUrl(
      `/releases/${releaseId}/attach_files/${attachmentId}`,
      token,
    ),
    { method: "DELETE" },
  );
}

async function uploadAttachment(releaseId, filePath, token) {
  const filename = basename(filePath);
  const file = await openAsBlob(filePath, { type: "application/octet-stream" });
  const form = new FormData();
  form.append("access_token", token);
  form.append("file", file, filename);

  console.log(
    `正在上传 Gitee 附件：${filename}（${(file.size / 1024 / 1024).toFixed(1)} MiB）`,
  );
  const payload = await requestJson(
    `${GITEE_API_BASE}/releases/${releaseId}/attach_files`,
    {
      method: "POST",
      body: form,
      timeout: UPLOAD_TIMEOUT_MS,
    },
  );
  if (!payload?.browser_download_url) {
    throw new Error(`附件 ${filename} 上传成功，但响应中没有下载地址。`);
  }
  console.log(`上传完成：${payload.browser_download_url}`);
}

function previousVersionTag(currentTag) {
  return run("git", ["tag", "--list", "--sort=-version:refname"], {
    capture: true,
  })
    .split(/\r?\n/)
    .find((tag) => VERSION_PATTERN.test(tag) && tag !== currentTag);
}

async function collectArtifacts(assetDirectory, version, platform) {
  const entries = await readdir(assetDirectory, { withFileTypes: true });
  const expectedNames = {
    mac: [
      `NediaMatrix-${version}-mac-arm64.dmg`,
      `NediaMatrix-${version}-mac-x64.dmg`,
    ],
    win: [
      `NediaMatrix-${version}-win-portable-x64.exe`,
      `NediaMatrix-${version}-win-setup-x64.exe`,
    ],
  };
  const requiredNames =
    platform === "all"
      ? [...expectedNames.mac, ...expectedNames.win]
      : expectedNames[platform];
  const availableNames = new Set(
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
  );
  const missingNames = requiredNames.filter(
    (name) => !availableNames.has(name),
  );
  if (missingNames.length > 0) {
    throw new Error(
      `安装包不完整，目录 ${assetDirectory} 缺少：${missingNames.join("、")}`,
    );
  }
  return requiredNames.map((name) => join(assetDirectory, name));
}

async function recompressMacArtifacts(assetDirectory, version) {
  if (process.platform !== "darwin") {
    throw new Error("macOS DMG 只能在 macOS 上转换为 Gitee 所需的 ULMO 格式。");
  }

  for (const arch of ["arm64", "x64"]) {
    const filename = `NediaMatrix-${version}-mac-${arch}.dmg`;
    const sourcePath = join(assetDirectory, filename);
    const imageInfo = run("hdiutil", ["imageinfo", sourcePath], {
      capture: true,
    });
    if (/^Format:\s*ULMO\s*$/m.test(imageInfo)) {
      console.log(`Gitee DMG 已是 ULMO 格式：${filename}`);
      continue;
    }

    const convertedPath = join(assetDirectory, `.${filename}.ulmo.dmg`);
    console.log(`正在将 Gitee DMG 转换为 ULMO：${filename}`);
    run("hdiutil", [
      "convert",
      sourcePath,
      "-format",
      "ULMO",
      "-o",
      convertedPath,
      "-ov",
    ]);
    await rename(convertedPath, sourcePath);
  }
}

async function validateArtifactSizes(artifacts) {
  const oversized = [];
  for (const artifact of artifacts) {
    const { size } = await stat(artifact);
    console.log(
      `Gitee 附件大小：${basename(artifact)} ${(size / 1_000_000).toFixed(2)} MB`,
    );
    if (size > MAX_ATTACHMENT_BYTES) oversized.push({ artifact, size });
  }

  if (oversized.length > 0) {
    const details = oversized
      .map(
        ({ artifact, size }) =>
          `${basename(artifact)}（${(size / 1_000_000).toFixed(2)} MB）`,
      )
      .join("、");
    throw new Error(
      `以下安装包超过 Gitee 单附件 100 MB 限制：${details}。尚未推送 Gitee。`,
    );
  }
}

async function writeChecksums(assetDirectory, platform, artifacts) {
  const checksumPath = join(assetDirectory, `SHA256SUMS-${platform}.txt`);
  const lines = [];
  for (const artifact of artifacts) {
    lines.push(`${await sha256(artifact)}  ${basename(artifact)}`);
  }
  await writeFile(checksumPath, `${lines.join("\n")}\n`, "utf8");
  return checksumPath;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const projectDirectory = resolve(import.meta.dirname, "..");
  process.chdir(projectDirectory);

  const originUrl = run("git", ["remote", "get-url", "origin"], {
    capture: true,
  });
  if (originUrl !== PUBLIC_ORIGIN_URL) {
    throw new Error(
      `publish-gitee 只能在公开仓库中运行；origin 必须是 ${PUBLIC_ORIGIN_URL}，当前是 ${originUrl}。`,
    );
  }

  const token = process.env.GITEE_TOKEN;
  if (!token) throw new Error("未设置 GITEE_TOKEN 环境变量。");

  const packageJson = JSON.parse(
    await readFile(join(projectDirectory, "apps/desktop/package.json"), "utf8"),
  );
  const version = options.tag.slice(1);
  if (packageJson.version !== version) {
    throw new Error(
      `Tag ${options.tag} 与桌面应用版本 v${packageJson.version} 不一致。`,
    );
  }

  const taggedCommit = run("git", ["rev-list", "-n", "1", options.tag], {
    capture: true,
  });
  const headCommit = run("git", ["rev-parse", "HEAD"], { capture: true });
  if (taggedCommit !== headCommit) {
    throw new Error(`Tag ${options.tag} 没有指向当前公开仓库的 HEAD。`);
  }

  const platform = resolvePlatform(options.platform);
  const platforms = selectedPlatforms(platform);
  if (!options.skipBuild) {
    if (platforms.includes("mac") && process.platform !== "darwin") {
      throw new Error("macOS 安装包只能在 macOS 上构建。");
    }
    const buildEnvironment = {
      ...process.env,
      NEDIA_UPDATE_SOURCE: "gitee",
    };
    delete buildEnvironment.GITEE_TOKEN;
    for (const currentPlatform of platforms) {
      const packageCommand =
        currentPlatform === "mac"
          ? "desktop:package:mac"
          : "desktop:package:win";
      console.log(`正在构建 ${currentPlatform} 安装包，更新源为 Gitee。`);
      run("pnpm", [packageCommand], { env: buildEnvironment });
    }
  }

  const assetDirectory = resolve(projectDirectory, options.assets);
  if (platforms.includes("mac")) {
    await recompressMacArtifacts(assetDirectory, version);
  }
  const artifacts = await collectArtifacts(assetDirectory, version, platform);
  await validateArtifactSizes(artifacts);
  const checksum = await writeChecksums(assetDirectory, platform, artifacts);
  const files = [checksum, ...artifacts];

  const existingRemote = run("git", ["remote"], { capture: true })
    .split(/\r?\n/)
    .includes(GITEE_REMOTE_NAME);
  if (existingRemote) {
    run("git", ["remote", "set-url", GITEE_REMOTE_NAME, GITEE_REMOTE_URL]);
  } else {
    run("git", ["remote", "add", GITEE_REMOTE_NAME, GITEE_REMOTE_URL]);
  }

  if (!options.skipPush) {
    const branch = run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      capture: true,
    });
    console.log(`正在推送 Gitee 分支 ${branch} 和 Tag ${options.tag}。`);
    run("git", [
      "push",
      "--atomic",
      GITEE_REMOTE_NAME,
      branch,
      `refs/tags/${options.tag}`,
    ]);
  }

  const previousTag = previousVersionTag(options.tag);
  const releaseBody = previousTag
    ? `**完整变更**: https://gitee.com/nedia-matrix/desktop/compare/${previousTag}...${options.tag}`
    : `NediaMatrix ${options.tag}`;
  let release = await getRelease(options.tag, token);
  if (release?.id) {
    await submitRelease(`/releases/${release.id}`, "PATCH", token, {
      tag_name: options.tag,
      name: options.tag,
      body: releaseBody,
    });
  } else {
    release = await submitRelease("/releases", "POST", token, {
      tag_name: options.tag,
      name: options.tag,
      body: releaseBody,
      target_commitish: headCommit,
      prerelease: "true",
    });
  }
  if (!release?.id) throw new Error("Gitee Release 响应中没有 id。");

  let attachments = await getAttachments(release.id, token);
  for (const file of files) {
    const filename = basename(file);
    const existing = attachments.find(
      (attachment) => attachment.name === filename,
    );
    if (existing) {
      console.log(`正在替换 Gitee 附件：${filename}`);
      await deleteAttachment(release.id, existing.id, token);
    }
    await uploadAttachment(release.id, file, token);
  }

  attachments = await getAttachments(release.id, token);
  const attachmentNames = new Set(
    attachments.map((attachment) => attachment.name),
  );
  const expectedArtifacts = [
    `NediaMatrix-${version}-mac-arm64.dmg`,
    `NediaMatrix-${version}-mac-x64.dmg`,
    `NediaMatrix-${version}-win-portable-x64.exe`,
    `NediaMatrix-${version}-win-setup-x64.exe`,
  ];
  const missingArtifacts = expectedArtifacts.filter(
    (filename) => !attachmentNames.has(filename),
  );
  await submitRelease(`/releases/${release.id}`, "PATCH", token, {
    tag_name: options.tag,
    name: options.tag,
    body: releaseBody,
    prerelease: String(missingArtifacts.length > 0),
  });

  if (missingArtifacts.length > 0) {
    console.log("Gitee Release 已更新，仍缺少以下平台安装包：");
    for (const filename of missingArtifacts) console.log(`  - ${filename}`);
    console.log("补传完成后脚本会自动将 Release 标记为正式版本。");
  } else {
    console.log(`Gitee Release ${options.tag} 已完整发布。`);
  }
}

main().catch((error) => {
  console.error(
    `错误：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
