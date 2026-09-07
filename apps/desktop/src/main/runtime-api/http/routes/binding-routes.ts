import type { IncomingMessage, ServerResponse } from "node:http";

import type { DesktopUseCases } from "../../../application/desktop-application.js";
import { RuntimeBindingVerifier } from "../../application/runtime-binding-verifier.js";
import { toRuntimeAccountSession } from "../../mapping/runtime-account-mapper.js";
import { readJsonRequest, writeJson } from "../http-json.js";

export class RuntimeBindingRoutes {
  constructor(
    private readonly application: DesktopUseCases,
    private readonly verifier: RuntimeBindingVerifier,
  ) {}

  list(response: ServerResponse): void {
    writeJson(response, 200, this.application.accountBindings.list());
  }

  async bind(
    request: IncomingMessage,
    response: ServerResponse,
    platformAccountId: string,
  ): Promise<void> {
    try {
      const body = await readJsonRequest(request);
      const runtimeAccountId =
        typeof body.runtimeAccountId === "string" ? body.runtimeAccountId : "";
      const binding = this.application.accountBindings.bind({
        platformAccountId,
        runtimeAccountId,
      });
      writeJson(response, 200, binding);
    } catch (error) {
      writeJson(response, 400, {
        code: "INVALID_ACCOUNT_BINDING",
        message: error instanceof Error ? error.message : "Invalid binding",
      });
    }
  }

  async verify(
    response: ServerResponse,
    platformAccountId: string,
  ): Promise<void> {
    try {
      const { account, binding } =
        await this.verifier.verify(platformAccountId);
      writeJson(response, 200, {
        binding,
        session: toRuntimeAccountSession(account),
      });
    } catch (error) {
      writeJson(response, 409, {
        code: "ACCOUNT_IDENTITY_MISMATCH",
        message:
          error instanceof Error
            ? error.message
            : "Runtime account identity does not match the binding",
      });
    }
  }
}
