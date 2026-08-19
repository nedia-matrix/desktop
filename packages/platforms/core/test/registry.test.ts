import { describe, expect, it } from "vitest";

import { PlatformRegistry } from "../src/registry.js";

describe("PlatformRegistry", () => {
  const module = {
    id: "test",
  } as never;

  it("registers and looks up complete platform modules", () => {
    const registry = new PlatformRegistry([module]);
    expect(registry.get("test")).toBe(module);
    expect(registry.list()).toEqual([module]);
  });

  it("requires registered modules and rejects duplicate ids", () => {
    const registry = new PlatformRegistry([module]);
    expect(registry.require("test")).toBe(module);
    expect(() => registry.require("missing")).toThrow(/not registered/);
    expect(() => new PlatformRegistry([module, module])).toThrow(
      /already registered/,
    );
  });
});
