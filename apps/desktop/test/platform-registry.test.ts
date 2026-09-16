import type { PlatformModule } from "@nedia-matrix/platform-sdk";
import { describe, expect, it } from "vitest";

import {
  createPlatformCatalogHost,
  createPlatformRegistry,
} from "../src/main/platforms/platform-registry.js";

const module = { id: "fixture" } as never as PlatformModule;

describe("Desktop PlatformRegistry", () => {
  it("supports lookup and returns a snapshot list", () => {
    const registry = createPlatformRegistry([module]);

    expect(registry.get("fixture")).toBe(module);
    expect(registry.require("fixture")).toBe(module);
    expect(registry.list()).toEqual([module]);
  });

  it("rejects duplicate module ids and missing required modules", () => {
    expect(() => createPlatformRegistry([module, module])).toThrow(
      "already registered",
    );
    expect(() => createPlatformRegistry([]).require("missing")).toThrow(
      "not registered",
    );
  });

  it("atomically replaces the active snapshot after validating candidates", () => {
    const host = createPlatformCatalogHost([module]);
    const replacement = { ...module, id: "replacement" };

    host.replace([replacement]);

    expect(host.get("fixture")).toBeUndefined();
    expect(host.require("replacement")).toBe(replacement);
  });

  it("keeps the previous snapshot when a candidate is invalid", () => {
    const host = createPlatformCatalogHost([module]);
    const replacement = { ...module, id: "replacement" };

    expect(() => host.replace([replacement, replacement])).toThrow(
      "already registered",
    );
    expect(host.require("fixture")).toBe(module);
    expect(host.get("replacement")).toBeUndefined();
  });
});
