import { describe, expect, it } from "vitest";

import { definePlatformModule } from "../src/platform-module.js";

function moduleInput() {
  return {
    id: "test",
    displayName: "Test",
    rulesVersion: "1",
    browser: {
      startUrl: "https://creator.example.test/home",
      allowedHostSuffixes: ["example.test"],
    },
    accounts: {
      implementationStatus: "fixture-tested" as const,
      duplicateProfileReplacement: "enabled" as const,
      loginEntries: [
        {
          id: "default",
          displayName: "Default",
          url: "https://creator.example.test/login",
        },
      ],
      detection: { probes: [] },
    },
  };
}

describe("definePlatformModule", () => {
  it("accepts URLs within the declared browser boundary", () => {
    expect(definePlatformModule(moduleInput()).id).toBe("test");
  });

  it("rejects duplicate login entry identifiers", () => {
    const input = moduleInput();
    input.accounts.loginEntries.push({
      id: "default",
      displayName: "Other",
      url: "https://creator.example.test/other-login",
    });
    expect(() => definePlatformModule(input)).toThrow(/Duplicate login entry/);
  });

  it("rejects capability URLs outside the browser boundary", () => {
    const input = moduleInput();
    input.accounts.loginEntries[0]!.url = "https://attacker.example/login";
    expect(() => definePlatformModule(input)).toThrow(
      /outside allowed platform hosts/,
    );
  });

  it("allows insecure transport only for a loopback fixture", () => {
    const input = moduleInput();
    input.browser.startUrl = "http://creator.example.test/home";
    expect(() => definePlatformModule(input)).toThrow(
      /outside allowed platform hosts/,
    );
  });

  it("accepts numeric publish constraints", () => {
    const input = moduleInput() as ReturnType<typeof moduleInput> & {
      publishing: unknown;
    };
    input.publishing = publishingCapability({
      constraints: { titleMaxLength: 20 },
    });
    expect(() => definePlatformModule(input as never)).not.toThrow();
  });

  it("rejects non-positive publish constraints", () => {
    const input = moduleInput() as ReturnType<typeof moduleInput> & {
      publishing: unknown;
    };
    input.publishing = publishingCapability({
      constraints: { titleMaxLength: 0 },
    });
    expect(() => definePlatformModule(input as never)).toThrow();
  });
});

function publishingCapability(form: { constraints: Record<string, unknown> }) {
  return {
    implementationStatus: "fixture-tested",
    forms: {
      video: {
        ...form,
        submissionModes: ["manual_confirmation"],
        automation: { prepare: {}, submit: {} },
      },
    },
    createResultMonitor() {
      throw new Error("unused fixture");
    },
  };
}
