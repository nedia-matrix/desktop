import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";

import {
  ipcChannels,
  type SelectPublishMediaRequest,
} from "@nedia-matrix/ipc-contracts";
import { dialog, ipcMain, shell } from "electron";

import type { PlatformAccountStore } from "../accounts/account-store.js";
import type { MediaSelectionStore } from "./media-selection-store.js";
import { platformFor } from "../registered-platforms.js";
import { assertAccountRequest } from "../accounts/account-request-validation.js";
import { isContentForm } from "./publish-request-validation.js";
import type { PublishingApplication } from "./publishing-application.js";

type PublishIpcApplication = Pick<
  PublishingApplication,
  "listPublications" | "publicationUrl" | "prepareDraft"
>;

interface PublishIpcDependencies {
  application: PublishIpcApplication;
  accountStore: PlatformAccountStore;
  mediaSelections: MediaSelectionStore;
}

export function registerPublishIpcHandlers({
  application,
  accountStore,
  mediaSelections,
}: PublishIpcDependencies): void {
  ipcMain.handle(ipcChannels.listPublications, () =>
    application.listPublications(),
  );
  ipcMain.handle(ipcChannels.openPublication, async (_event, request) =>
    shell.openExternal(application.publicationUrl(request)),
  );

  ipcMain.handle(
    ipcChannels.selectPublishMedia,
    async (_event, request: SelectPublishMediaRequest) => {
      assertAccountRequest(request);
      if (!isContentForm(request.contentForm)) {
        throw new TypeError("Invalid publish content form");
      }
      const account = accountStore.require(request.accountId);
      if (account.status === "login_required") {
        return { status: "login_required" } as const;
      }
      const platform = platformFor(account.platformId);
      const form = platform.publishing?.forms[request.contentForm];
      if (!form) {
        throw new TypeError(
          `${platform.displayName} does not support ${request.contentForm}`,
        );
      }

      const result = await dialog.showOpenDialog({
        title:
          request.contentForm === "video" ? "选择发布视频" : "选择发布图片",
        properties:
          request.contentForm === "video"
            ? ["openFile"]
            : ["openFile", "multiSelections"],
        filters:
          request.contentForm === "video"
            ? [{ name: "视频", extensions: ["mp4", "mov", "m4v", "webm"] }]
            : [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp"] }],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { status: "cancelled" } as const;
      }
      const maxMediaCount = form.constraints.mediaMaxCount ?? 18;
      if (result.filePaths.length > maxMediaCount) {
        throw new TypeError(
          `A draft can contain at most ${maxMediaCount} media files`,
        );
      }

      const allowedExtensions =
        request.contentForm === "video"
          ? new Set([".mp4", ".mov", ".m4v", ".webm"])
          : new Set([".jpg", ".jpeg", ".png", ".webp"]);
      if (
        result.filePaths.some(
          (filePath) => !allowedExtensions.has(extname(filePath).toLowerCase()),
        )
      ) {
        throw new TypeError("Selected media format is not supported");
      }

      const files = await Promise.all(
        result.filePaths.map(async (filePath) => {
          const metadata = await stat(filePath);
          if (!metadata.isFile()) throw new TypeError("Media must be a file");
          return { name: basename(filePath), size: metadata.size };
        }),
      );
      const selectionId = mediaSelections.create({
        accountId: account.id,
        contentForm: request.contentForm,
        filePaths: result.filePaths,
        files,
      });
      return { status: "selected", selectionId, files } as const;
    },
  );

  ipcMain.handle(ipcChannels.preparePublishDraft, (_event, request) =>
    application.prepareDraft(request),
  );
}
