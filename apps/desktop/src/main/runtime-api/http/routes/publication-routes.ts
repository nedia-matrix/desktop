import type { IncomingMessage, ServerResponse } from "node:http";

import type { DesktopUseCases } from "../../../application/desktop-application.js";
import {
  RuntimeBindingError,
  type RuntimeBindingVerifier,
} from "../../application/runtime-binding-verifier.js";
import {
  parseRuntimePublicationRequest,
  runtimePublicationStatus,
} from "../../mapping/runtime-publication-mapper.js";
import { readJsonRequest, writeJson } from "../http-json.js";

export class RuntimePublicationRoutes {
  constructor(
    private readonly application: DesktopUseCases,
    private readonly bindingVerifier: RuntimeBindingVerifier,
  ) {}

  async create(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const input = parseRuntimePublicationRequest(
        await readJsonRequest(request),
      );
      await this.bindingVerifier.verify(
        input.platformAccountId,
        input.runtimeAccountId,
        input.platform,
      );
      const result = await this.application.publications.prepareRemote(input);
      if (result.status === "login_required") {
        writeJson(response, 409, {
          code: "NOT_LOGGED_IN",
          message: "Runtime account is not logged in",
        });
        return;
      }
      if (result.status === "account_unknown") {
        writeJson(response, 409, {
          code: "ACCOUNT_IDENTITY_MISMATCH",
          message: result.reason,
        });
        return;
      }
      if (result.status === "account_busy") {
        writeJson(response, 409, {
          code: "ACCOUNT_BUSY",
          message: "Runtime account already has an active publication",
        });
        return;
      }
      const summary = this.application.publications
        .list()
        .find((publication) => publication.requestId === input.requestId);
      if (!summary) throw new Error("Publication was not persisted");
      writeJson(response, 202, runtimePublicationStatus(summary));
    } catch (error) {
      const status =
        error instanceof RuntimeBindingError
          ? 409
          : error instanceof TypeError
            ? 400
            : 500;
      writeJson(response, status, {
        code:
          error instanceof RuntimeBindingError
            ? error.code
            : error instanceof TypeError
              ? "INVALID_REQUEST"
              : "PUBLISH_FAILED",
        message: error instanceof Error ? error.message : "Publish failed",
      });
    }
  }

  status(response: ServerResponse, requestId: string): void {
    const summary = this.application.publications
      .list()
      .find((publication) => publication.requestId === requestId);
    writeJson(
      response,
      200,
      summary
        ? runtimePublicationStatus(summary)
        : { requestId, state: "missing" },
    );
  }
}
