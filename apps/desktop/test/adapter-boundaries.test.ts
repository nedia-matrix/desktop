import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const mainDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/main",
);
const workspaceDirectory = resolve(mainDirectory, "../../../..");

function readMainFile(relativePath: string): string {
  return readFileSync(resolve(mainDirectory, relativePath), "utf8");
}

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(resolve(workspaceDirectory, relativePath), "utf8");
}

function readWorkspaceTypeScriptFiles(relativeDirectory: string): string[] {
  const directory = resolve(workspaceDirectory, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    return entry.isDirectory()
      ? readWorkspaceTypeScriptFiles(relativePath)
      : entry.name.endsWith(".ts")
        ? [readWorkspaceFile(relativePath)]
        : [];
  });
}

function readTypeScriptFiles(relativeDirectory: string): string[] {
  const directory = resolve(mainDirectory, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    return entry.isDirectory()
      ? readTypeScriptFiles(relativePath)
      : entry.name.endsWith(".ts")
        ? [readMainFile(relativePath)]
        : [];
  });
}

describe("adapter architecture boundaries", () => {
  it("routes business IPC handlers through the root application port", () => {
    for (const file of [
      "accounts/ipc/register-account-ipc-handlers.ts",
      "publishing/ipc/register-publication-ipc-handlers.ts",
    ]) {
      const source = readMainFile(file);
      expect(source).toMatch(/NediaMatrixUseCases/);
      for (const forbiddenImport of [
        /\/infrastructure\//,
        /PublishingService/,
      ]) {
        expect(source).not.toMatch(forbiddenImport);
      }
    }
  });

  it("keeps HTTP business logic behind the application capability port", () => {
    const source = readMainFile(
      "runtime-api/http/local-runtime-http-server.ts",
    );

    expect(source).toMatch(/NediaMatrixUseCases/);
    expect(source).not.toMatch(/runtime-account-binding-store/);
    expect(source).not.toMatch(/publication-store/);
    expect(source).not.toMatch(/account-store/);
    expect(source).not.toMatch(/media-selection-store/);
    expect(source).not.toMatch(/PublishingService/);
    expect(source).not.toMatch(/PublishDraftOrchestrator/);
  });

  it("keeps publication observation persistence expressed as a narrow port", () => {
    const source = readMainFile(
      "publishing/observations/publication-observation-queue.ts",
    );

    expect(source).toMatch(/interface ObservationPersistence/);
    expect(source).toMatch(/recordObservation\(/);
    expect(source).not.toMatch(/PublishingService/);
    expect(source).not.toMatch(/PublicationRepository/);
  });

  it("keeps application services independent from Electron adapters", () => {
    for (const directory of ["application"]) {
      for (const source of readTypeScriptFiles(directory)) {
        expect(source).not.toMatch(/from "electron"/);
        expect(source).not.toMatch(/from "electron-store"/);
        expect(source).not.toMatch(/\/infrastructure\//);
      }
    }
  });

  it("uses module public surfaces for root application dependencies", () => {
    const source = readMainFile("application/nedia-matrix-application.ts");
    expect(source).toMatch(/@nedia-matrix\/account-management/);
    expect(source).toMatch(/@nedia-matrix\/publishing/);
    expect(source).not.toMatch(/\/infrastructure\//);
  });

  it("keeps concept packages independent from Desktop and concrete adapters", () => {
    const conceptSources = [
      ...readWorkspaceTypeScriptFiles("packages/contexts/account-management"),
      ...readWorkspaceTypeScriptFiles("packages/contexts/publishing"),
    ];
    for (const source of conceptSources) {
      expect(source).not.toMatch(/apps\/desktop/);
      expect(source).not.toMatch(/from "electron"/);
    }

    for (const source of readWorkspaceTypeScriptFiles(
      "packages/contexts/account-management/src/application",
    )) {
      expect(source).not.toMatch(/@nedia-matrix\/automation-playwright/);
      expect(source).not.toMatch(/@nedia-matrix\/ipc-contracts/);
    }
  });

  it("keeps context domains independent from application and adapters", () => {
    for (const directory of [
      "packages/contexts/account-management/src/domain",
      "packages/contexts/publishing/src/domain",
    ]) {
      for (const source of readWorkspaceTypeScriptFiles(directory)) {
        expect(source).not.toMatch(/\/application\//);
        expect(source).not.toMatch(/apps\/desktop|electron|sqlite|playwright/i);
      }
    }

    const publishingManifest = readWorkspaceFile(
      "packages/contexts/publishing/package.json",
    );
    expect(publishingManifest).not.toMatch(/account-management/);
  });

  it("keeps the manifest package as a pure compiler-boundary package", () => {
    for (const source of readWorkspaceTypeScriptFiles(
      "packages/platforms/manifest/src",
    )) {
      expect(source).not.toMatch(/apps\/desktop/);
      expect(source).not.toMatch(/from "electron"/);
      expect(source).not.toMatch(/automation-playwright/);
    }
    const manifest = readWorkspaceFile(
      "packages/platforms/manifest/package.json",
    );
    expect(manifest).toMatch(/@nedia-matrix\/automation-engine/);
    expect(manifest).toMatch(/@nedia-matrix\/platform-sdk/);
    expect(manifest).not.toMatch(/@nedia-matrix\/desktop/);
  });

  it("does not restore horizontal domain or IPC contract packages", () => {
    const manifests = readWorkspaceFile("pnpm-lock.yaml");
    expect(manifests).not.toMatch(/@nedia-matrix\/domain-core/);
    expect(manifests).not.toMatch(/@nedia-matrix\/ipc-contracts/);
    expect(manifests).not.toMatch(/@nedia-matrix\/account-core/);
    expect(manifests).not.toMatch(/@nedia-matrix\/account-application/);
    expect(manifests).not.toMatch(/@nedia-matrix\/publishing-core/);
    expect(manifests).not.toMatch(/@nedia-matrix\/publishing-application/);
    expect(manifests).not.toMatch(/@nedia-matrix\/platform-core/);
    expect(manifests).not.toMatch(/@nedia-matrix\/automation-contracts/);
  });

  it("keeps the Platform SDK free of Desktop Catalog ownership", () => {
    const sdkIndex = readWorkspaceFile("packages/platforms/sdk/src/index.ts");
    const sdkManifest = readWorkspaceFile(
      "packages/platforms/sdk/package.json",
    );

    expect(sdkIndex).not.toMatch(/registry/);
    expect(sdkManifest).not.toMatch(/\.\/registry/);
    expect(readMainFile("platforms/platform-registry.ts")).toMatch(
      /class DesktopPlatformRegistry/,
    );
    expect(
      existsSync(resolve(workspaceDirectory, "packages/platforms/core")),
    ).toBe(false);
  });

  it("keeps aggregate snapshots distinct from external views", () => {
    const publishing = readWorkspaceTypeScriptFiles(
      "packages/contexts/publishing/src",
    ).join("\n");
    expect(publishing).not.toMatch(/PublicationRecord/);
    expect(publishing).not.toMatch(/PublicationAggregate/);
    expect(publishing).toMatch(/class Publication/);
    expect(publishing).toMatch(/interface PublicationSnapshot/);
    expect(publishing).toMatch(/interface PublicationSummary/);

    const accountDomain = readWorkspaceTypeScriptFiles(
      "packages/contexts/account-management/src/domain",
    ).join("\n");
    expect(accountDomain).toMatch(/platformAccountStatuses/);
    expect(accountDomain).toMatch(/platformAccountLifecycles/);
    expect(accountDomain).toMatch(/class PlatformAccount/);
    expect(accountDomain).toMatch(/interface PlatformAccountSnapshot/);
    expect(
      readWorkspaceFile(
        "packages/contexts/account-management/src/application/account-types.ts",
      ),
    ).toMatch(/interface PlatformAccountView/);
  });

  it("keeps the Electron entrypoint free of composition logic", () => {
    expect(readMainFile("index.ts").trim()).toBe(
      'import "./bootstrap/start-desktop.js";',
    );
  });
});
