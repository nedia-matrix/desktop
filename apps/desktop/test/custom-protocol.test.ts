import { describe, expect, it } from "vitest";

import {
  findNediaMatrixOpenUrl,
  isNediaMatrixOpenUrl,
  NEDIA_MATRIX_OPEN_URL,
} from "../src/main/shell/protocol/custom-protocol.js";

describe("nedia-matrix open protocol", () => {
  it("accepts only the parameter-free open action", () => {
    expect(isNediaMatrixOpenUrl(NEDIA_MATRIX_OPEN_URL)).toBe(true);
    expect(isNediaMatrixOpenUrl("nedia-matrix://open/")).toBe(true);
    expect(isNediaMatrixOpenUrl("nedia-matrix://open?nonce=unexpected")).toBe(
      false,
    );
    expect(isNediaMatrixOpenUrl("nedia-matrix://connect")).toBe(false);
  });

  it("finds the open URL in process arguments", () => {
    expect(
      findNediaMatrixOpenUrl(["electron", "main.js", NEDIA_MATRIX_OPEN_URL]),
    ).toBe(NEDIA_MATRIX_OPEN_URL);
  });
});
