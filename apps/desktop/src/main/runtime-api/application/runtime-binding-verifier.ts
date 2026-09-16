import { AccountBindingVerificationError } from "./runtime-account-binding-service.js";
import {
  accountBindingErrorCodes,
  type AccountBindingErrorCode,
} from "@nedia-matrix/runtime-account-binding";
import type { NediaMatrixUseCases } from "../../application/nedia-matrix-application.js";

export class RuntimeBindingError extends Error {
  constructor(
    readonly code: AccountBindingErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class RuntimeBindingVerifier {
  constructor(private readonly application: NediaMatrixUseCases) {}

  async verify(
    platformAccountId: string,
    runtimeAccountId?: string,
    platform?: string,
    notifyOnSuccess = false,
  ): Promise<
    Awaited<ReturnType<NediaMatrixUseCases["accountBindings"]["verify"]>>
  > {
    try {
      return await this.application.accountBindings.verify({
        platformAccountId,
        runtimeAccountId,
        platform,
        notifyOnSuccess,
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
  code: AccountBindingErrorCode;
} {
  return (
    error instanceof Error &&
    accountBindingErrorCodes.includes(
      (error as unknown as { code: never }).code,
    )
  );
}
