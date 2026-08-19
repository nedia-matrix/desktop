export const NEDIA_MATRIX_PROTOCOL = "nedia-matrix";
export const NEDIA_MATRIX_OPEN_URL = `${NEDIA_MATRIX_PROTOCOL}://open`;

export function isNediaMatrixOpenUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === `${NEDIA_MATRIX_PROTOCOL}:` &&
      url.hostname === "open" &&
      (url.pathname === "" || url.pathname === "/") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function findNediaMatrixOpenUrl(
  values: readonly string[],
): string | undefined {
  return values.find(
    (value) =>
      value.startsWith(`${NEDIA_MATRIX_PROTOCOL}://`) &&
      isNediaMatrixOpenUrl(value),
  );
}
