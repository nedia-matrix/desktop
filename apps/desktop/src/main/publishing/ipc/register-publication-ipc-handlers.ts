import { ipcChannels } from "../../../bridge/channels.js";
import type { SelectPublishMediaRequest } from "@nedia-matrix/publishing";
import { dialog, ipcMain, shell } from "electron";

import type { NediaMatrixUseCases } from "../../application/nedia-matrix-application.js";
import { readLocalMediaResources } from "./local-media-resources.js";

type PublishIpcApplication = Pick<NediaMatrixUseCases, "publications">;

interface PublishIpcDependencies {
  application: PublishIpcApplication;
}

export function registerPublicationIpcHandlers({
  application,
}: PublishIpcDependencies): void {
  ipcMain.handle(ipcChannels.listPublications, () =>
    application.publications.list(),
  );
  ipcMain.handle(ipcChannels.openPublicationReview, (_event, request) =>
    application.publications.openReview(request),
  );
  ipcMain.handle(ipcChannels.openPublication, async (_event, request) =>
    shell.openExternal(application.publications.publicationUrl(request)),
  );

  ipcMain.handle(
    ipcChannels.selectPublishMedia,
    async (_event, request: SelectPublishMediaRequest) => {
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
      const resources = await readLocalMediaResources(result.filePaths);
      return application.publications.registerLocalMedia({
        ...request,
        resources,
      });
    },
  );

  ipcMain.handle(ipcChannels.preparePublishDraft, (_event, request) =>
    application.publications.prepare(request),
  );
}
