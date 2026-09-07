import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";

import type { PublishContentForm } from "@nedia-matrix/ipc-contracts";

import { assertAccountRequest } from "../../accounts/public.js";
import { platformFor } from "../../platforms/platform-registry.js";
import type { PublishDraftOrchestratorDependencies } from "./publish-draft-orchestrator.js";
import { isContentForm } from "./publish-request-validator.js";

export interface RegisterLocalMediaRequest {
  accountId: string;
  contentForm: PublishContentForm;
  filePaths: readonly string[];
}

type LocalMediaDependencies = Pick<
  PublishDraftOrchestratorDependencies,
  "accountStore" | "mediaSelections"
>;

export async function registerLocalMedia(
  request: RegisterLocalMediaRequest,
  dependencies: LocalMediaDependencies,
) {
  assertAccountRequest(request);
  if (!isContentForm(request.contentForm)) {
    throw new TypeError("Invalid publish content form");
  }
  const account = dependencies.accountStore.require(request.accountId);
  if (account.lifecycle !== "active" || account.status === "login_required") {
    return { status: "login_required" } as const;
  }

  const platform = platformFor(account.platformId);
  const form = platform.publishing?.forms[request.contentForm];
  if (!form) {
    throw new TypeError(
      `${platform.displayName} does not support ${request.contentForm}`,
    );
  }

  const maxMediaCount = form.constraints.mediaMaxCount;
  if (request.filePaths.length === 0) {
    throw new TypeError("A draft must contain at least one media file");
  }
  if (maxMediaCount !== undefined && request.filePaths.length > maxMediaCount) {
    throw new TypeError(
      `A draft can contain at most ${maxMediaCount} media files`,
    );
  }

  const allowedExtensions =
    request.contentForm === "video"
      ? new Set([".mp4", ".mov", ".m4v", ".webm"])
      : new Set([".jpg", ".jpeg", ".png", ".webp"]);
  if (
    request.filePaths.some(
      (filePath) => !allowedExtensions.has(extname(filePath).toLowerCase()),
    )
  ) {
    throw new TypeError("Selected media format is not supported");
  }

  const files = await Promise.all(
    request.filePaths.map(async (filePath) => {
      const metadata = await stat(filePath);
      if (!metadata.isFile()) throw new TypeError("Media must be a file");
      return { name: basename(filePath), size: metadata.size };
    }),
  );
  const selectionId = dependencies.mediaSelections.create({
    accountId: account.id,
    contentForm: request.contentForm,
    filePaths: request.filePaths,
    files,
  });
  return { status: "selected", selectionId, files } as const;
}
