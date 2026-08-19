import { describe, expect, it } from "vitest";

import { parseStoredRuntimeAccountBindings } from "../src/main/local-runtime/runtime-account-binding-store.js";

describe("runtime account binding store", () => {
  it("keeps only complete stable identity mappings", () => {
    expect(
      parseStoredRuntimeAccountBindings([
        {
          platformAccountId: "platform-account-1",
          runtimeAccountId: "runtime-account-1",
          platform: "douyin",
          externalAccountId: "external-account-1",
          boundAt: "2026-08-10T01:00:00.000Z",
        },
        { platformAccountId: "incomplete" },
      ]),
    ).toEqual([
      {
        platformAccountId: "platform-account-1",
        runtimeAccountId: "runtime-account-1",
        platform: "douyin",
        externalAccountId: "external-account-1",
        boundAt: "2026-08-10T01:00:00.000Z",
      },
    ]);
  });
});
