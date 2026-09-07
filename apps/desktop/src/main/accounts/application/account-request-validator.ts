import type {
  CreatePlatformAccountRequest,
  OpenPlatformLoginRequest,
  PlatformAccountRequest,
} from "@nedia-matrix/ipc-contracts";

export function assertPlatformRequest(
  request: unknown,
): asserts request is CreatePlatformAccountRequest {
  const candidate = request as Partial<CreatePlatformAccountRequest> | null;
  if (
    !candidate ||
    typeof candidate.platformId !== "string" ||
    candidate.platformId.length === 0
  ) {
    throw new TypeError("Invalid platform request");
  }
}

export function assertAccountRequest(
  request: unknown,
): asserts request is PlatformAccountRequest {
  const candidate = request as Partial<PlatformAccountRequest> | null;
  if (
    !candidate ||
    typeof candidate.accountId !== "string" ||
    candidate.accountId.length === 0 ||
    candidate.accountId.length > 128
  ) {
    throw new TypeError("Invalid platform account request");
  }
}

export function assertLoginRequest(
  request: unknown,
): asserts request is OpenPlatformLoginRequest {
  assertAccountRequest(request);
  const candidate = request as Partial<OpenPlatformLoginRequest>;
  if (
    typeof candidate.loginEntryId !== "string" ||
    candidate.loginEntryId.length === 0 ||
    candidate.loginEntryId.length > 128
  ) {
    throw new TypeError("Invalid platform login entry");
  }
}
