import { readFileSync } from "node:fs";
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

describe("adapter architecture boundaries", () => {
  it("routes business IPC handlers through the root application port", () => {
    for (const file of [
      "accounts/account-ipc.ts",
      "publishing/publish-ipc.ts",
    ]) {
      const source = readMainFile(file);
      expect(source).toMatch(/NediaMatrixUseCases/);
      for (const forbiddenImport of [
        /account-application/,
        /account-store/,
        /media-selection-store/,
        /publication-store/,
        /PublishingService/,
      ]) {
        expect(source).not.toMatch(forbiddenImport);
      }
    }
  });

  it("keeps HTTP business logic behind the application capability port", () => {
    const source = readMainFile("local-runtime/local-runtime-server.ts");

    expect(source).toMatch(/NediaMatrixUseCases/);
    expect(source).not.toMatch(/runtime-account-binding-store/);
    expect(source).not.toMatch(/publication-store/);
    expect(source).not.toMatch(/account-store/);
    expect(source).not.toMatch(/media-selection-store/);
    expect(source).not.toMatch(/PublishingService/);
    expect(source).not.toMatch(/DraftPreparation/);
  });

  it("keeps publication observation persistence expressed as a narrow port", () => {
    const source = readMainFile("publishing/publication-observation-sink.ts");

    expect(source).toMatch(/interface ObservationPersistence/);
    expect(source).toMatch(/recordObservation\(/);
    expect(source).not.toMatch(/PublishingService/);
    expect(source).not.toMatch(/PublicationRepository/);
  });
});
