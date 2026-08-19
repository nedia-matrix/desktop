import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import type {
  LocalRuntimeDiagnostics,
  LocalRuntimeRequestLog,
  PlatformAccountSummary,
} from "@nedia-matrix/ipc-contracts";

import type { AccountApplication } from "../accounts/account-application.js";
import type { PublishingApplication } from "../publishing/publishing-application.js";
import type {
  RuntimeAccountBinding,
  RuntimeAccountBindingStore,
} from "./runtime-account-binding-store.js";
import { parseWebOrigin } from "./web-origin.js";
import {
  parseRuntimePublicationRequest,
  runtimePublicationEvent,
  runtimePublicationStatus,
} from "./publication-dto.js";
import { RuntimeEventBuffer } from "./runtime-event-buffer.js";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_REQUEST_LOGS = 500;

class RuntimeRequestError extends Error {
  constructor(
    readonly code: "ACCOUNT_IDENTITY_MISMATCH" | "NOT_LOGGED_IN",
    message: string,
  ) {
    super(message);
  }
}

export const DEFAULT_LOCAL_RUNTIME_PORT = 17_653;

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

type LocalRuntimeApplication = Pick<
  AccountApplication,
  | "createAccount"
  | "listAccounts"
  | "listPlatforms"
  | "openAccount"
  | "openLogin"
  | "refreshAccount"
  | "verifyAccount"
  | "removeAccount"
> &
  Pick<PublishingApplication, "listPublications" | "prepareRemoteDraft">;

type RuntimeAccountBindingsPort = Pick<
  RuntimeAccountBindingStore,
  "list" | "put" | "removeForRuntimeAccount"
>;

interface LocalRuntimeServerOptions {
  application: LocalRuntimeApplication;
  accountBindings: RuntimeAccountBindingsPort;
  handshake: LocalRuntimeHandshake;
  port?: number;
  now?: () => Date;
}

function runtimeSession(account: PlatformAccountSummary) {
  return {
    runtimeAccountId: account.id,
    platform: account.platformId,
    loggedIn: account.status === "authenticated",
    status:
      account.status === "authenticated"
        ? ("connected" as const)
        : account.status === "login_required"
          ? ("expired" as const)
          : ("unknown" as const),
    nickname: account.nickname,
    externalAccountId: account.externalAccountId,
    avatarUrl: account.avatarUrl,
    accountInfo: account.accountInfo ?? [],
    lastVerifiedAt: account.lastVerifiedAt,
  };
}

export function readLocalRuntimePort(value: unknown): number {
  if (value === undefined || value === "") return DEFAULT_LOCAL_RUNTIME_PORT;
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError(
      "MATRIX_RUNTIME_PORT must be an integer from 0 to 65535",
    );
  }
  return port;
}

export class LocalRuntimeServer {
  private boundPort: number | null = null;
  private nextRequestLogId = 1;
  private readonly requestLogs: LocalRuntimeRequestLog[] = [];
  private readonly responseErrorCodes = new WeakMap<ServerResponse, string>();
  private readonly events = new RuntimeEventBuffer<
    ReturnType<typeof runtimePublicationEvent>
  >();
  private readonly server = createServer((request, response) => {
    this.observeRequest(request, response);
    this.handle(request, response);
  });

  constructor(private readonly options: LocalRuntimeServerOptions) {}

  async start(): Promise<number> {
    if (this.boundPort !== null) return this.boundPort;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once("error", onError);
      this.server.listen(
        this.options.port ?? DEFAULT_LOCAL_RUNTIME_PORT,
        LOOPBACK_HOST,
        () => {
          this.server.off("error", onError);
          resolve();
        },
      );
    });

    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Local runtime server did not expose a TCP address");
    }
    this.boundPort = address.port;
    return address.port;
  }

  async stop(): Promise<void> {
    this.events.close();
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    this.boundPort = null;
  }

  diagnostics(): LocalRuntimeDiagnostics {
    return {
      status: this.boundPort === null ? "stopped" : "running",
      version: this.options.handshake.runtimeVersion,
      host: LOOPBACK_HOST,
      port: this.boundPort,
      requests: [...this.requestLogs].reverse(),
    };
  }

  clearRequestLogs(): void {
    this.requestLogs.length = 0;
  }

  private observeRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const startedAt = (this.options.now ?? (() => new Date()))();
    const path = this.requestPath(request);
    const origin = parseWebOrigin(request.headers.origin);

    response.once("finish", () => {
      const finishedAt = (this.options.now ?? (() => new Date()))();
      this.requestLogs.push({
        id: this.nextRequestLogId++,
        timestamp: startedAt.toISOString(),
        method: request.method ?? "UNKNOWN",
        path,
        statusCode: response.statusCode,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        origin,
        errorCode: this.responseErrorCodes.get(response) ?? null,
      });
      if (this.requestLogs.length > MAX_REQUEST_LOGS) {
        this.requestLogs.splice(0, this.requestLogs.length - MAX_REQUEST_LOGS);
      }
    });
  }

  private requestPath(request: IncomingMessage): string {
    try {
      return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      return "/";
    }
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    if (!this.hasValidHost(request)) {
      this.json(response, 400, { code: "INVALID_HOST" });
      return;
    }

    response.setHeader("Access-Control-Allow-Origin", "*");
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader(
        "Access-Control-Allow-Methods",
        "DELETE, GET, POST, PUT, OPTIONS",
      );
      if (
        request.headers["access-control-request-private-network"] === "true"
      ) {
        response.setHeader("Access-Control-Allow-Private-Network", "true");
      }
      response.statusCode = 204;
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/v1/runtime") {
      this.json(response, 200, this.options.handshake);
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/events") {
      void this.pollEvents(response, url.searchParams.get("after"));
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/accounts") {
      this.json(
        response,
        200,
        this.options.application.listAccounts().map(runtimeSession),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/platforms") {
      this.json(response, 200, this.options.application.listPlatforms());
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/publications") {
      void this.createPublication(request, response);
      return;
    }

    const publicationMatch =
      /^\/v1\/publications\/([A-Za-z0-9._~-]{1,128})$/.exec(url.pathname);
    if (request.method === "GET" && publicationMatch?.[1]) {
      this.publicationStatus(response, publicationMatch[1]);
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/accounts") {
      void this.createAccount(request, response);
      return;
    }

    const accountMatch = /^\/v1\/accounts\/([A-Za-z0-9._~-]{1,128})$/.exec(
      url.pathname,
    );
    if (request.method === "DELETE" && accountMatch?.[1]) {
      void this.removeAccount(response, accountMatch[1]);
      return;
    }

    const accountActionMatch =
      /^\/v1\/accounts\/([A-Za-z0-9._~-]{1,128})\/(open|refresh)$/.exec(
        url.pathname,
      );
    if (request.method === "POST" && accountActionMatch?.[1]) {
      const action = accountActionMatch[2];
      if (action === "open") {
        void this.openAccount(request, response, accountActionMatch[1]);
      } else {
        void this.refreshAccount(response, accountActionMatch[1]);
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/account-bindings") {
      this.json(response, 200, this.options.accountBindings.list());
      return;
    }

    const bindingMatch =
      /^\/v1\/account-bindings\/([A-Za-z0-9._~-]{1,128})$/.exec(url.pathname);
    if (request.method === "PUT" && bindingMatch?.[1]) {
      void this.bindAccount(request, response, bindingMatch[1]);
      return;
    }

    const bindingVerificationMatch =
      /^\/v1\/account-bindings\/([A-Za-z0-9._~-]{1,128})\/verify$/.exec(
        url.pathname,
      );
    if (request.method === "POST" && bindingVerificationMatch?.[1]) {
      void this.verifyAccountBinding(response, bindingVerificationMatch[1]);
      return;
    }

    this.json(response, 404, { code: "NOT_FOUND" });
  }

  private async createAccount(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const body = await this.readJsonRequest(request);
      const platformId = typeof body.platform === "string" ? body.platform : "";
      const account = this.options.application.createAccount({ platformId });
      this.json(response, 201, runtimeSession(account));
    } catch (error) {
      this.accountActionError(response, error);
    }
  }

  publishPublicationUpdate(publicationId: string): void {
    const summary = this.options.application
      .listPublications()
      .find((publication) => publication.id === publicationId);
    if (summary) this.events.append(runtimePublicationEvent(summary));
  }

  private async pollEvents(
    response: ServerResponse,
    afterValue: string | null,
  ): Promise<void> {
    try {
      const after = afterValue === null ? 0 : Number(afterValue);
      const envelope = await this.events.poll(after, 20_000);
      if (!response.destroyed) this.json(response, 200, envelope);
    } catch (error) {
      if (!response.destroyed) {
        this.json(response, 400, {
          code: "INVALID_EVENT_CURSOR",
          message: error instanceof Error ? error.message : "Invalid cursor",
        });
      }
    }
  }

  private async createPublication(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const input = parseRuntimePublicationRequest(
        await this.readJsonRequest(request),
      );
      await this.requireVerifiedBinding(
        input.platformAccountId,
        input.runtimeAccountId,
        input.platform,
      );
      const result = await this.options.application.prepareRemoteDraft(input);
      if (result.status === "login_required") {
        this.json(response, 409, {
          code: "NOT_LOGGED_IN",
          message: "Runtime account is not logged in",
        });
        return;
      }
      if (result.status === "account_unknown") {
        this.json(response, 409, {
          code: "ACCOUNT_IDENTITY_MISMATCH",
          message: result.reason,
        });
        return;
      }
      if (result.status === "account_busy") {
        this.json(response, 409, {
          code: "ACCOUNT_BUSY",
          message: "Runtime account already has an active publication",
        });
        return;
      }
      const summary = this.options.application
        .listPublications()
        .find((publication) => publication.requestId === input.requestId);
      if (!summary) throw new Error("Publication was not persisted");
      this.json(response, 202, runtimePublicationStatus(summary));
    } catch (error) {
      const status =
        error instanceof RuntimeRequestError
          ? 409
          : error instanceof TypeError
            ? 400
            : 500;
      this.json(response, status, {
        code:
          error instanceof RuntimeRequestError
            ? error.code
            : error instanceof TypeError
              ? "INVALID_REQUEST"
              : "PUBLISH_FAILED",
        message: error instanceof Error ? error.message : "Publish failed",
      });
    }
  }

  private publicationStatus(response: ServerResponse, requestId: string): void {
    const summary = this.options.application
      .listPublications()
      .find((publication) => publication.requestId === requestId);
    this.json(
      response,
      200,
      summary
        ? runtimePublicationStatus(summary)
        : { requestId, state: "missing" },
    );
  }

  private async openAccount(
    request: IncomingMessage,
    response: ServerResponse,
    runtimeAccountId: string,
  ): Promise<void> {
    try {
      const body = await this.readJsonRequest(request);
      const account = this.requireAccount(runtimeAccountId);
      if (account.status === "login_required") {
        const platform = this.options.application
          .listPlatforms()
          .find((candidate) => candidate.id === account.platformId);
        const requestedLoginEntryId =
          typeof body.loginEntryId === "string" ? body.loginEntryId : null;
        const loginEntryId =
          requestedLoginEntryId ?? platform?.loginEntries[0]?.id;
        if (!loginEntryId)
          throw new TypeError("Platform does not have a login entry");
        await this.options.application.openLogin({
          accountId: runtimeAccountId,
          loginEntryId,
        });
      } else {
        await this.options.application.openAccount({
          accountId: runtimeAccountId,
        });
      }
      this.json(response, 200, runtimeSession(account));
    } catch (error) {
      this.accountActionError(response, error);
    }
  }

  private async refreshAccount(
    response: ServerResponse,
    runtimeAccountId: string,
  ): Promise<void> {
    try {
      await this.options.application.refreshAccount({
        accountId: runtimeAccountId,
      });
      this.json(
        response,
        200,
        runtimeSession(this.requireAccount(runtimeAccountId)),
      );
    } catch (error) {
      this.accountActionError(response, error);
    }
  }

  private async removeAccount(
    response: ServerResponse,
    runtimeAccountId: string,
  ): Promise<void> {
    try {
      await this.options.application.removeAccount({
        accountId: runtimeAccountId,
      });
      this.options.accountBindings.removeForRuntimeAccount(runtimeAccountId);
      this.json(response, 200, { removed: true, runtimeAccountId });
    } catch (error) {
      this.accountActionError(response, error);
    }
  }

  private requireAccount(runtimeAccountId: string): PlatformAccountSummary {
    const account = this.options.application
      .listAccounts()
      .find((candidate) => candidate.id === runtimeAccountId);
    if (!account) throw new TypeError("Runtime account does not exist");
    return account;
  }

  private async bindAccount(
    request: IncomingMessage,
    response: ServerResponse,
    platformAccountId: string,
  ): Promise<void> {
    try {
      const body = await this.readJsonRequest(request);
      const runtimeAccountId =
        typeof body.runtimeAccountId === "string" ? body.runtimeAccountId : "";
      const account = this.options.application
        .listAccounts()
        .find((candidate) => candidate.id === runtimeAccountId);
      if (!account) throw new TypeError("Runtime account does not exist");
      if (!account.externalAccountId) {
        throw new TypeError("Runtime account does not have a stable identity");
      }
      const binding: RuntimeAccountBinding = {
        platformAccountId,
        runtimeAccountId: account.id,
        platform: account.platformId,
        externalAccountId: account.externalAccountId,
        boundAt: (this.options.now ?? (() => new Date()))().toISOString(),
      };
      this.options.accountBindings.put(binding);
      this.json(response, 200, binding);
    } catch (error) {
      this.json(response, 400, {
        code: "INVALID_ACCOUNT_BINDING",
        message: error instanceof Error ? error.message : "Invalid binding",
      });
    }
  }

  private async verifyAccountBinding(
    response: ServerResponse,
    platformAccountId: string,
  ): Promise<void> {
    try {
      const { account, binding } =
        await this.requireVerifiedBinding(platformAccountId);
      this.json(response, 200, {
        binding,
        session: runtimeSession(account),
      });
    } catch (error) {
      this.json(response, 409, {
        code: "ACCOUNT_IDENTITY_MISMATCH",
        message:
          error instanceof Error
            ? error.message
            : "Runtime account identity does not match the binding",
      });
    }
  }

  private async requireVerifiedBinding(
    platformAccountId: string,
    runtimeAccountId?: string,
    platform?: string,
  ): Promise<{
    account: PlatformAccountSummary;
    binding: RuntimeAccountBinding;
  }> {
    const binding = this.options.accountBindings
      .list()
      .find((candidate) => candidate.platformAccountId === platformAccountId);
    if (!binding) {
      throw new RuntimeRequestError(
        "ACCOUNT_IDENTITY_MISMATCH",
        "Account binding does not exist",
      );
    }
    if (
      (runtimeAccountId !== undefined &&
        runtimeAccountId !== binding.runtimeAccountId) ||
      (platform !== undefined && platform !== binding.platform)
    ) {
      throw new RuntimeRequestError(
        "ACCOUNT_IDENTITY_MISMATCH",
        "Publication target does not match account binding",
      );
    }
    const detected = await this.options.application.verifyAccount({
      accountId: binding.runtimeAccountId,
    });
    if (detected.status === "login_required") {
      throw new RuntimeRequestError(
        "NOT_LOGGED_IN",
        "Runtime account is not authenticated",
      );
    }
    if (detected.status === "unknown") {
      throw new RuntimeRequestError(
        "ACCOUNT_IDENTITY_MISMATCH",
        detected.reason,
      );
    }
    const account = this.requireAccount(binding.runtimeAccountId);
    if (account.status !== "authenticated") {
      throw new RuntimeRequestError(
        "NOT_LOGGED_IN",
        "Runtime account is not authenticated",
      );
    }
    if (
      account.platformId !== binding.platform ||
      account.externalAccountId !== binding.externalAccountId
    ) {
      throw new RuntimeRequestError(
        "ACCOUNT_IDENTITY_MISMATCH",
        "Runtime account identity does not match the binding",
      );
    }
    return { account, binding };
  }

  private accountActionError(response: ServerResponse, error: unknown): void {
    this.json(response, 400, {
      code: "ACCOUNT_ACTION_FAILED",
      message: error instanceof Error ? error.message : "Account action failed",
    });
  }

  private readJsonRequest(
    request: IncomingMessage,
  ): Promise<Record<string, unknown>> {
    if (
      request.headers["content-type"]?.split(";", 1)[0] !== "application/json"
    ) {
      throw new TypeError("Content-Type must be application/json");
    }
    return this.readJsonBody(request);
  }

  private async readJsonBody(
    request: IncomingMessage,
  ): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 262_144) throw new TypeError("Request body is too large");
      chunks.push(buffer);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("Request body must be an object");
    }
    return value as Record<string, unknown>;
  }

  private hasValidHost(request: IncomingMessage): boolean {
    if (this.boundPort === null || !request.headers.host) return false;
    return request.headers.host === `${LOOPBACK_HOST}:${this.boundPort}`;
  }

  private json(response: ServerResponse, status: number, value: unknown): void {
    if (
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "string"
    ) {
      this.responseErrorCodes.set(response, value.code);
    }
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(value));
  }
}
