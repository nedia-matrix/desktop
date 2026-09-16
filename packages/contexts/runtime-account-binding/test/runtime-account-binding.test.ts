import { describe, expect, it } from "vitest";

import {
  RuntimeAccountBinding,
  assertRuntimeAccountBindingSnapshot,
} from "../src/index.js";

const binding = {
  platformAccountId: "platform-account-1",
  runtimeAccountId: "runtime-account-1",
  platform: "mock",
  externalAccountId: "external-1",
  boundAt: "2026-09-13T00:00:00.000Z",
};

describe("runtime account binding aggregate", () => {
  it("rehydrates and isolates its snapshot", () => {
    const aggregate = RuntimeAccountBinding.establish({
      externalAccountReference: binding.platformAccountId,
      localAccountId: binding.runtimeAccountId,
      platform: binding.platform,
      externalAccountId: binding.externalAccountId,
      boundAt: binding.boundAt,
    });
    const snapshot = aggregate.toSnapshot();
    expect(snapshot).toEqual(binding);
    expect(
      aggregate.matchesTarget({
        externalAccountReference: binding.platformAccountId,
      }),
    ).toBe(true);
    expect(
      aggregate.matchesAccount({
        id: binding.runtimeAccountId,
        platformId: binding.platform,
        status: "authenticated",
        externalAccountId: binding.externalAccountId,
      }),
    ).toBe(true);
  });

  it("rejects malformed snapshots and mismatched accounts", () => {
    expect(() =>
      assertRuntimeAccountBindingSnapshot({ ...binding, boundAt: "invalid" }),
    ).toThrow("Runtime binding creation time");
    const aggregate = RuntimeAccountBinding.rehydrate(binding);
    expect(
      aggregate.matchesAccount({
        id: binding.runtimeAccountId,
        platformId: binding.platform,
        status: "login_required",
        externalAccountId: binding.externalAccountId,
      }),
    ).toBe(false);
  });
});
