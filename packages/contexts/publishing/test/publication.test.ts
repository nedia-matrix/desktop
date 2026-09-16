import { describe, expect, it } from "vitest";

import {
  InvalidPublicationTransitionError,
  createContentRevision,
  createPublication,
  PublicationQualification,
  transitionPublication,
} from "../src/index.js";

describe("publishing core", () => {
  it("creates immutable content revisions and publications", () => {
    const revision = createContentRevision({
      id: "revision-1",
      contentItemId: "content-1",
      revision: 1,
      body: "body",
      assetIds: ["asset-1"],
      createdAt: "2026-09-10T00:00:00.000Z",
    });
    const publication = createPublication({
      id: "publication-1",
      platformId: "platform-1",
      accountId: "account-1",
      contentRevisionId: revision.id,
    });

    expect(revision.assetIds).toEqual(["asset-1"]);
    expect(Object.isFrozen(revision.assetIds)).toBe(true);
    expect(publication.state).toBe("draft");
  });

  it("enforces publication transitions", () => {
    const publication = createPublication({
      id: "publication-1",
      platformId: "platform-1",
      accountId: "account-1",
      contentRevisionId: "revision-1",
    });

    expect(
      transitionPublication(
        publication,
        "validated",
        "2026-09-10T00:00:00.000Z",
      ).state,
    ).toBe("validated");
    expect(() =>
      transitionPublication(
        publication,
        "published",
        "2026-09-10T00:00:00.000Z",
      ),
    ).toThrow(InvalidPublicationTransitionError);
  });

  it("qualifies a publication against provider capability data", () => {
    const capability = {
      constraints: { titleMaxLength: 5, bodyMaxLength: 6, mediaMaxCount: 1 },
      submissionModes: ["automatic"] as const,
      automation: {} as never,
    };

    expect(() =>
      PublicationQualification.assertSatisfied({
        contentForm: "imageText",
        submissionMode: "automatic",
        title: "title",
        body: "body",
        assetCount: 1,
        capability,
      }),
    ).not.toThrow();
    expect(() =>
      PublicationQualification.assertSatisfied({
        contentForm: "imageText",
        submissionMode: "automatic",
        title: "long title",
        body: "body",
        assetCount: 1,
        capability,
      }),
    ).toThrow("标题最多");
    expect(() =>
      PublicationQualification.assertSatisfied({
        contentForm: "imageText",
        submissionMode: "manual_confirmation",
        title: "title",
        body: "body",
        assetCount: 1,
        capability,
      }),
    ).toThrow("人工确认");
  });
});
