import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const mainDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/main",
);

function readMainFile(relativePath: string): string {
  return readFileSync(resolve(mainDirectory, relativePath), "utf8");
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
      expect(source).toMatch(/DesktopUseCases/);
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

    expect(source).toMatch(/DesktopUseCases/);
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
    for (const directory of [
      "accounts/application",
      "runtime-api/application",
    ]) {
      for (const source of readTypeScriptFiles(directory)) {
        expect(source).not.toMatch(/from "electron"/);
        expect(source).not.toMatch(/from "electron-store"/);
        expect(source).not.toMatch(/\/infrastructure\//);
      }
    }
  });

  it("uses module public surfaces for root application dependencies", () => {
    const source = readMainFile("application/desktop-application.ts");
    expect(source).toMatch(/accounts\/public\.js/);
    expect(source).toMatch(/publishing\/public\.js/);
    expect(source).toMatch(/runtime-api\/public\.js/);
    expect(source).not.toMatch(/\/infrastructure\//);
  });

  it("keeps the Electron entrypoint free of composition logic", () => {
    expect(readMainFile("index.ts").trim()).toBe(
      'import "./bootstrap/start-desktop.js";',
    );
  });
});
