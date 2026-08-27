import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import type {
  LocalRuntimeStatus,
  PlatformAccountSummary,
} from "@nedia-matrix/ipc-contracts";

import { AccountBindingVerificationError } from "../accounts/account-binding-application.js";
import { AccountReplacedError } from "../accounts/account-application.js";
import type { NediaMatrixUseCases } from "../application/nedia-matrix-application.js";
import {
  parseRuntimePublicationRequest,
  runtimePublicationEvent,
  runtimePublicationStatus,
} from "./publication-dto.js";
import { RuntimeEventBuffer } from "./runtime-event-buffer.js";

const LOOPBACK_HOST = "127.0.0.1";
type RuntimeEvent =
  | ReturnType<typeof runtimePublicationEvent>
  | { type: "runtime.accounts.changed" };

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

interface LocalRuntimeServerOptions {
  application: NediaMatrixUseCases;
  handshake: LocalRuntimeHandshake;
  port?: number;
}

function runtimeSession(
  account: PlatformAccountSummary,
  replacementAlias?: { candidateAccountId: string },
) {
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
    ...(replacementAlias
      ? {
          resolution: {
            kind: "existing_account_profile_replaced" as const,
            requestedRuntimeAccountId: replacementAlias.candidateAccountId,
          },
        }
      : {}),
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
  private lifecycle = Promise.resolve();
  private readonly events = new RuntimeEventBuffer<RuntimeEvent>();
  private readonly server = createServer((request, response) => {
    this.handle(request, response);
  });

  constructor(private readonly options: LocalRuntimeServerOptions) {}

  start(): Promise<number> {
    return this.enqueueLifecycleOperation(() => this.startListening());
  }

  stop(): Promise<void> {
    return this.enqueueLifecycleOperation(() => this.stopListening());
  }

  private async startListening(): Promise<number> {
    if (this.boundPort !== null) return this.boundPort;

    this.events.open();
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

  private async stopListening(): Promise<void> {
    if (!this.server.listening) {
      this.events.close();
      this.boundPort = null;
      return;
    }
    const stopped = new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    this.events.close();
    this.server.closeAllConnections();
    await stopped;
    this.boundPort = null;
  }

  private enqueueLifecycleOperation<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const result = this.lifecycle.then(operation, operation);
    this.lifecycle = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  status(): LocalRuntimeStatus {
    return {
      status: this.boundPort === null ? "stopped" : "running",
      version: this.options.handshake.runtimeVersion,
      host: LOOPBACK_HOST,
      port: this.boundPort,
    };
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
        this.options.application.accounts
          .list()
          .map((account) => runtimeSession(account)),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/platforms") {
      this.json(
        response,
        200,
        this.options.application.accounts.listPlatforms(),
      );
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
      this.json(response, 200, this.options.application.accountBindings.list());
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
      const account = this.options.application.accounts.create({ platformId });
      this.json(response, 201, runtimeSession(account));
    } catch (error) {
      this.accountActionError(response, error);
    }
  }

  publishPublicationUpdate(publicationId: string): void {
    const summary = this.options.application.publications
      .list()
      .find((publication) => publication.id === publicationId);
    if (summary) this.events.append(runtimePublicationEvent(summary));
  }

  publishAccountsChanged(): void {
    this.events.append({ type: "runtime.accounts.changed" });
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
      const result =
        await this.options.application.publications.prepareRemote(input);
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
      const summary = this.options.application.publications
        .list()
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
    const summary = this.options.application.publications
      .list()
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
      const resolved = this.options.application.accounts.resolve({
        accountId: runtimeAccountId,
      });
      const account = resolved.account;
      if (account.status === "login_required") {
        const platform = this.options.application.accounts
          .listPlatforms()
          .find((candidate) => candidate.id === account.platformId);
        const requestedLoginEntryId =
          typeof body.loginEntryId === "string" ? body.loginEntryId : null;
        const loginEntryId =
          requestedLoginEntryId ?? platform?.loginEntries[0]?.id;
        if (!loginEntryId)
          throw new TypeError("Platform does not have a login entry");
        await this.options.application.accounts.openLogin({
          accountId: runtimeAccountId,
          loginEntryId,
        });
      } else {
        await this.options.application.accounts.open({
          accountId: runtimeAccountId,
        });
      }
      const current = this.options.application.accounts.resolve({
        accountId: runtimeAccountId,
      });
      this.json(
        response,
        200,
        runtimeSession(current.account, current.replacementAlias),
      );
    } catch (error) {
      this.accountActionError(response, error);
    }
  }

  private async refreshAccount(
    response: ServerResponse,
    runtimeAccountId: string,
  ): Promise<void> {
    try {
      await this.options.application.accounts.refresh({
        accountId: runtimeAccountId,
      });
      const resolved = this.options.application.accounts.resolve({
        accountId: runtimeAccountId,
      });
      this.json(
        response,
        200,
        runtimeSession(resolved.account, resolved.replacementAlias),
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
      await this.options.application.accounts.remove({
        accountId: runtimeAccountId,
      });
      this.json(response, 200, { removed: true, runtimeAccountId });
    } catch (error) {
      this.accountActionError(response, error);
    }
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
      const binding = this.options.application.accountBindings.bind({
        platformAccountId,
        runtimeAccountId,
      });
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
  ): Promise<
    Awaited<ReturnType<NediaMatrixUseCases["accountBindings"]["verify"]>>
  > {
    try {
      return await this.options.application.accountBindings.verify({
        platformAccountId,
        runtimeAccountId,
        platform,
      });
    } catch (error) {
      if (error instanceof AccountBindingVerificationError) {
        throw new RuntimeRequestError(error.code, error.message);
      }
      if (hasBindingErrorCode(error)) {
        throw new RuntimeRequestError(error.code, error.message);
      }
      throw error;
    }
  }

  private accountActionError(response: ServerResponse, error: unknown): void {
    if (error instanceof AccountReplacedError) {
      this.json(response, 409, {
        code: "ACCOUNT_REPLACED",
        runtimeAccountId: error.survivingAccountId,
        message: error.message,
      });
      return;
    }
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
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(value));
  }
}

function hasBindingErrorCode(error: unknown): error is Error & {
  code: "ACCOUNT_IDENTITY_MISMATCH" | "NOT_LOGGED_IN";
} {
  return (
    error instanceof Error &&
    (error as { code?: unknown }).code !== undefined &&
    ((error as unknown as { code: unknown }).code ===
      "ACCOUNT_IDENTITY_MISMATCH" ||
      (error as unknown as { code: unknown }).code === "NOT_LOGGED_IN")
  );
}
