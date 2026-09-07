import { AccountBindingVerificationError } from "./runtime-account-binding-service.js";
import type { DesktopUseCases } from "../../application/desktop-application.js";

export class RuntimeBindingError extends Error {
  constructor(
    readonly code: "ACCOUNT_IDENTITY_MISMATCH" | "NOT_LOGGED_IN",
    message: string,
  ) {
    super(message);
  }
}

export class RuntimeBindingVerifier {
  constructor(private readonly application: DesktopUseCases) {}

  async verify(
    platformAccountId: string,
    runtimeAccountId?: string,
    platform?: string,
  ): Promise<
    Awaited<ReturnType<DesktopUseCases["accountBindings"]["verify"]>>
  > {
    try {
      return await this.application.accountBindings.verify({
        platformAccountId,
        runtimeAccountId,
        platform,
      });
    } catch (error) {
      if (error instanceof AccountBindingVerificationError) {
        throw new RuntimeBindingError(error.code, error.message);
      }
      if (hasBindingErrorCode(error)) {
        throw new RuntimeBindingError(error.code, error.message);
      }
      throw error;
    }
  }
}

function hasBindingErrorCode(error: unknown): error is Error & {
  code: "ACCOUNT_IDENTITY_MISMATCH" | "NOT_LOGGED_IN";
} {
  return (
    error instanceof Error &&
    ((error as unknown as { code: unknown }).code ===
      "ACCOUNT_IDENTITY_MISMATCH" ||
      (error as unknown as { code: unknown }).code === "NOT_LOGGED_IN")
  );
}
