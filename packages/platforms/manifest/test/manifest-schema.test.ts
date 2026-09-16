import { describe, expect, it } from "vitest";

import {
  parsePlatformManifest,
  platformManifestV1Schema,
} from "../src/index.js";

const page = {
  id: "account",
  states: {},
  targets: {
    loggedOut: {
      candidates: [{ kind: "text", text: { value: "Log in", exact: true } }],
    },
  },
};

const minimalManifest = {
  schemaVersion: 1,
  id: "custom:example",
  displayName: "Example",
  browser: {
    startUrl: "https://creator.example.test/home",
    allowedHostSuffixes: ["example.test"],
  },
  accounts: {
    loginEntries: [
      {
        id: "default",
        displayName: "Sign in",
        url: "https://creator.example.test/login",
      },
    ],
    detection: {
      probes: [
        {
          identityScheme: "external",
          source: {
            kind: "request",
            url: "https://creator.example.test/api/me",
          },
          fields: {
            externalAccountId: ["id"],
            nickname: ["name"],
          },
        },
      ],
    },
  },
};

describe("PlatformManifestV1 schema", () => {
  it("parses a minimal account manifest and preserves defaults", () => {
    const result = parsePlatformManifest(minimalManifest);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.schemaVersion).toBe(1);
    expect(result.manifest.accounts.detection.probes).toHaveLength(1);
  });

  it("requires a custom namespace and rejects unknown fields", () => {
    expect(
      platformManifestV1Schema.safeParse({
        ...minimalManifest,
        id: "douyin",
      }).success,
    ).toBe(false);
    expect(
      platformManifestV1Schema.safeParse({
        ...minimalManifest,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("requires a probe or complete DOM fallback", () => {
    expect(
      platformManifestV1Schema.safeParse({
        ...minimalManifest,
        accounts: {
          ...minimalManifest.accounts,
          detection: { probes: [] },
        },
      }).success,
    ).toBe(false);
    expect(
      platformManifestV1Schema.safeParse({
        ...minimalManifest,
        accounts: {
          ...minimalManifest.accounts,
          detection: {
            probes: [],
            domFallback: {
              identityScheme: "external",
              page,
              loggedOutTargetId: "loggedOut",
              nicknameTargetId: "nickname",
              accountIdTargetId: "accountId",
              accountIdAttributes: ["data-id"],
            },
          },
        },
      }).success,
    ).toBe(true);
  });
});
