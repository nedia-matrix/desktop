import type { IncomingMessage, ServerResponse } from "node:http";

import type { DesktopUseCases } from "../../application/desktop-application.js";
import { RuntimeBindingVerifier } from "../application/runtime-binding-verifier.js";
import { RuntimeEventBuffer } from "../events/runtime-event-buffer.js";
import { runtimePublicationEvent } from "../mapping/runtime-publication-mapper.js";
import { writeJson } from "./http-json.js";
import { RuntimeAccountRoutes } from "./routes/account-routes.js";
import { RuntimeBindingRoutes } from "./routes/binding-routes.js";
import { RuntimeEventRoutes } from "./routes/event-routes.js";
import { RuntimePublicationRoutes } from "./routes/publication-routes.js";

export type RuntimeEvent =
  | ReturnType<typeof runtimePublicationEvent>
  | { type: "runtime.accounts.changed" };

export interface LocalRuntimeHandshake {
  protocolVersion: 1;
  runtimeKind: "desktop_playwright";
  runtimeVersion: string | null;
  instanceId: string;
  supportedTargets: Array<{
    platform: string;
    contentForm: "image_text" | "video" | "long_text";
  }>;
  capabilities: {
    isolatedAccounts: boolean;
    multipleAccountsPerPlatform: boolean;
    backgroundObservation: boolean;
    localPublicationArchive: boolean;
  };
}

export class RuntimeRouter {
  private readonly events = new RuntimeEventBuffer<RuntimeEvent>();
  private readonly accountRoutes: RuntimeAccountRoutes;
  private readonly bindingRoutes: RuntimeBindingRoutes;
  private readonly eventRoutes = new RuntimeEventRoutes(this.events);
  private readonly publicationRoutes: RuntimePublicationRoutes;

  constructor(
    private readonly application: DesktopUseCases,
    private readonly handshake: LocalRuntimeHandshake,
  ) {
    const bindingVerifier = new RuntimeBindingVerifier(application);
    this.accountRoutes = new RuntimeAccountRoutes(application);
    this.bindingRoutes = new RuntimeBindingRoutes(application, bindingVerifier);
    this.publicationRoutes = new RuntimePublicationRoutes(
      application,
      bindingVerifier,
    );
  }

  open(): void {
    this.events.open();
  }

  close(): void {
    this.events.close();
  }

  publishPublicationUpdate(publicationId: string): void {
    const summary = this.application.publications
      .list()
      .find((publication) => publication.id === publicationId);
    if (summary) this.events.append(runtimePublicationEvent(summary));
  }

  publishAccountsChanged(): void {
    this.events.append({ type: "runtime.accounts.changed" });
  }

  route(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
    if (request.method === "GET" && url.pathname === "/v1/runtime") {
      writeJson(response, 200, this.handshake);
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/events") {
      void this.eventRoutes.poll(response, url.searchParams.get("after"));
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/accounts") {
      this.accountRoutes.list(response);
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/platforms") {
      writeJson(response, 200, this.application.accounts.listPlatforms());
      return true;
    }
    if (request.method === "POST" && url.pathname === "/v1/publications") {
      void this.publicationRoutes.create(request, response);
      return true;
    }

    const publicationMatch =
      /^\/v1\/publications\/([A-Za-z0-9._~-]{1,128})$/.exec(url.pathname);
    if (request.method === "GET" && publicationMatch?.[1]) {
      this.publicationRoutes.status(response, publicationMatch[1]);
      return true;
    }
    if (request.method === "POST" && url.pathname === "/v1/accounts") {
      void this.accountRoutes.create(request, response);
      return true;
    }

    const accountMatch = /^\/v1\/accounts\/([A-Za-z0-9._~-]{1,128})$/.exec(
      url.pathname,
    );
    if (request.method === "DELETE" && accountMatch?.[1]) {
      void this.accountRoutes.remove(response, accountMatch[1]);
      return true;
    }
    const accountActionMatch =
      /^\/v1\/accounts\/([A-Za-z0-9._~-]{1,128})\/(open|refresh)$/.exec(
        url.pathname,
      );
    if (request.method === "POST" && accountActionMatch?.[1]) {
      if (accountActionMatch[2] === "open") {
        void this.accountRoutes.open(request, response, accountActionMatch[1]);
      } else {
        void this.accountRoutes.refresh(response, accountActionMatch[1]);
      }
      return true;
    }
    if (request.method === "GET" && url.pathname === "/v1/account-bindings") {
      this.bindingRoutes.list(response);
      return true;
    }

    const bindingMatch =
      /^\/v1\/account-bindings\/([A-Za-z0-9._~-]{1,128})$/.exec(url.pathname);
    if (request.method === "PUT" && bindingMatch?.[1]) {
      void this.bindingRoutes.bind(request, response, bindingMatch[1]);
      return true;
    }
    const bindingVerificationMatch =
      /^\/v1\/account-bindings\/([A-Za-z0-9._~-]{1,128})\/verify$/.exec(
        url.pathname,
      );
    if (request.method === "POST" && bindingVerificationMatch?.[1]) {
      void this.bindingRoutes.verify(response, bindingVerificationMatch[1]);
      return true;
    }
    return false;
  }
}
