import type { PublicationRecord } from "@nedia-matrix/application-publishing";
import { describe, expect, it } from "vitest";

import {
  assertSupportedPublicationStoreVersion,
  mergeStoredPublication,
  parseStoredPublications,
  removeStoredPublication,
  toPublicationSummary,
} from "../src/main/publishing/publication-store.js";

const record: PublicationRecord = {
  requestId: "request-1",
  publication: {
    id: "publication-1",
    platformId: "douyin",
    accountId: "account-1",
    contentRevisionId: "revision-1",
    state: "awaiting_confirmation",
    transitions: [
      {
        from: "preparing",
        to: "awaiting_confirmation",
        occurredAt: "2026-08-09T10:00:00.000Z",
      },
    ],
  },
  contentRevision: {
    id: "revision-1",
    contentItemId: "publication-1",
    revision: 1,
    title: "标题",
    body: "正文",
    assetIds: ["asset-1"],
    createdAt: "2026-08-09T10:00:00.000Z",
  },
  contentForm: "imageText",
  tags: [],
  submissionMode: "manual_confirmation",
  retained: false,
  assets: [
    {
      id: "asset-1",
      name: "image.jpg",
      size: 42,
      role: "image",
      order: 0,
      mediaType: null,
      hash: null,
      downloadedAt: null,
      sourceAssetId: null,
      sourceOrigin: null,
      localRelativePath: null,
    },
  ],
  rulesVersion: "0.4.0-live",
  createdAt: "2026-08-09T10:00:00.000Z",
  updatedAt: "2026-08-09T10:00:00.000Z",
};

describe("publication store mapping", () => {
  it("ignores malformed persisted values", () => {
    expect(parseStoredPublications([null, {}, record])).toEqual([record]);
  });

  it("exposes history without internal asset identifiers or file paths", () => {
    const summary = toPublicationSummary(record);

    expect(summary.assets).toEqual([{ name: "image.jpg", size: 42 }]);
    expect(summary.transitions[0]).toMatchObject({
      to: "awaiting_confirmation",
      reason: null,
    });
  });

  it("preserves malformed records when saving a valid publication", () => {
    const malformed = { publication: { id: "damaged" }, raw: "keep me" };

    const merged = mergeStoredPublication([malformed], record);

    expect(merged).toEqual([malformed, record]);
    expect(removeStoredPublication(merged, record.publication.id)).toEqual([
      malformed,
    ]);
  });

  it("refuses to rewrite a store created by a newer schema", () => {
    expect(() => assertSupportedPublicationStoreVersion(5)).toThrow(
      "Unsupported publication store schema version: 5",
    );
  });

  it("migrates the legacy publishing state without replaying submission", () => {
    const legacy = {
      ...record,
      publication: {
        ...record.publication,
        state: "publishing",
        transitions: [
          {
            from: "preparing",
            to: "publishing",
            occurredAt: "2026-08-09T10:00:00.000Z",
          },
        ],
      },
    };

    expect(parseStoredPublications([legacy])[0]?.publication).toMatchObject({
      state: "submitting",
      transitions: [{ from: "preparing", to: "submitting" }],
    });
    expect(() => assertSupportedPublicationStoreVersion(1)).not.toThrow();
  });

  it("migrates schema v2 records to an honest local archive snapshot", () => {
    const legacy = {
      ...record,
      tags: undefined,
      submissionMode: undefined,
      assets: [{ id: "asset-1", name: "image.jpg", size: 42 }],
    };

    expect(parseStoredPublications([legacy])[0]).toMatchObject({
      tags: [],
      submissionMode: "legacy_unknown",
      retained: false,
      assets: [
        {
          role: "image",
          order: 0,
          hash: null,
          localRelativePath: null,
        },
      ],
    });
    expect(() => assertSupportedPublicationStoreVersion(2)).not.toThrow();
    expect(() => assertSupportedPublicationStoreVersion(3)).not.toThrow();
  });
});
