import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  browserRuntimeFromEnvironment,
  loadBrowserRuntime,
  saveBrowserRuntime,
} from "../src/browser-runtime.js";

describe("persistent browser identity", () => {
  it("generates one seed concurrently and retains environment and channel on reopen", async () => {
    const root = await mkdtemp(join(tmpdir(), "nedia-runtime-test-"));
    try {
      const [a, b] = await Promise.all([
        loadBrowserRuntime(root),
        loadBrowserRuntime(root),
      ]);
      expect(a.fingerprintSeed).toBe(b.fingerprintSeed);
      expect(a.fingerprintSeed).toBeGreaterThan(0);
      await saveBrowserRuntime(root, { ...a, channel: "Microsoft Edge" });
      const reopened = await loadBrowserRuntime(root);
      expect(reopened).toEqual({ ...a, channel: "Microsoft Edge" });
      expect(
        JSON.parse(
          await readFile(join(root, "nedia-browser-runtime.json"), "utf8"),
        ),
      ).toEqual(reopened);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("ignores legacy dimensions and removes them on save without changing identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "nedia-runtime-legacy-"));
    try {
      const original = await loadBrowserRuntime(root);
      expect(original).not.toHaveProperty("width");
      expect(original).not.toHaveProperty("height");
      const legacy = {
        ...original,
        channel: "Microsoft Edge",
        width: 1366,
        height: 768,
      };
      await writeFile(
        join(root, "nedia-browser-runtime.json"),
        JSON.stringify(legacy),
      );
      const reopened = await loadBrowserRuntime(root);
      expect(reopened).toEqual({ ...original, channel: "Microsoft Edge" });
      await saveBrowserRuntime(root, legacy);
      expect(
        JSON.parse(
          await readFile(join(root, "nedia-browser-runtime.json"), "utf8"),
        ),
      ).toEqual(reopened);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects corrupt seed metadata rather than changing identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "nedia-runtime-invalid-"));
    try {
      await writeFile(
        join(root, "nedia-browser-runtime.json"),
        '{"version":1,"provider":"system","fingerprintSeed":0}',
      );
      await expect(loadBrowserRuntime(root)).rejects.toThrow(
        "Invalid browser runtime metadata",
      );
      expect(
        await readFile(join(root, "nedia-browser-runtime.json"), "utf8"),
      ).toContain('"fingerprintSeed":0');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("requires an absolute executable path and does not force an environment switch", () => {
    expect(browserRuntimeFromEnvironment({})).toBeUndefined();
    expect(() =>
      browserRuntimeFromEnvironment({
        NEDIA_FINGERPRINT_BROWSER_PATH: "./chrome",
      }),
    ).toThrow("absolute");
    expect(
      browserRuntimeFromEnvironment({
        NEDIA_FINGERPRINT_BROWSER_PATH: "/tmp/chromium",
      }),
    ).toEqual({ provider: "fingerprint", executablePath: "/tmp/chromium" });
  });
});
