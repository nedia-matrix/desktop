import { describe, expect, it } from "vitest";

import { AccountPublicationLock } from "../src/main/publishing/account-publication-lock.js";

describe("AccountPublicationLock", () => {
  it("allows only one active publication per account", () => {
    const publications = new AccountPublicationLock();
    const first = publications.acquire("account-1");

    expect(first).not.toBeNull();
    expect(publications.isActive("account-1")).toBe(true);
    expect(publications.acquire("account-1")).toBeNull();
    expect(publications.acquire("account-2")).not.toBeNull();

    first?.release();
    expect(publications.isActive("account-1")).toBe(false);
    expect(publications.acquire("account-1")).not.toBeNull();
  });

  it("makes lease release idempotent", () => {
    const publications = new AccountPublicationLock();
    const first = publications.acquire("account-1");

    first?.release();
    const second = publications.acquire("account-1");
    first?.release();

    expect(second).not.toBeNull();
    expect(publications.acquire("account-1")).toBeNull();
  });
});
