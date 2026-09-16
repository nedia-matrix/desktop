import type { MatrixDesktopApi } from "../bridge/api.js";

declare global {
  interface Window {
    matrix: MatrixDesktopApi;
  }
}

export {};
