import type { MatrixDesktopApi } from "@nedia-matrix/ipc-contracts";

declare global {
  interface Window {
    matrix: MatrixDesktopApi;
  }
}

export {};
