import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import type { LocalRuntimeStatus } from "@nedia-matrix/ipc-contracts";

import type { DesktopUseCases } from "../../application/desktop-application.js";
import { writeJson } from "./http-json.js";
import { RuntimeRouter, type LocalRuntimeHandshake } from "./runtime-router.js";

const LOOPBACK_HOST = "127.0.0.1";

export const DEFAULT_LOCAL_RUNTIME_PORT = 17_653;
export type { LocalRuntimeHandshake };

interface LocalRuntimeHttpServerOptions {
  application: DesktopUseCases;
  handshake: LocalRuntimeHandshake;
  port?: number;
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

export class LocalRuntimeHttpServer {
  private boundPort: number | null = null;
  private lifecycle = Promise.resolve();
  private readonly router: RuntimeRouter;
  private readonly server = createServer((request, response) => {
    this.handle(request, response);
  });

  constructor(private readonly options: LocalRuntimeHttpServerOptions) {
    this.router = new RuntimeRouter(options.application, options.handshake);
  }

  start(): Promise<number> {
    return this.enqueueLifecycleOperation(() => this.startListening());
  }

  stop(): Promise<void> {
    return this.enqueueLifecycleOperation(() => this.stopListening());
  }

  status(): LocalRuntimeStatus {
    return {
      status: this.boundPort === null ? "stopped" : "running",
      version: this.options.handshake.runtimeVersion,
      host: LOOPBACK_HOST,
      port: this.boundPort,
    };
  }

  publishPublicationUpdate(publicationId: string): void {
    this.router.publishPublicationUpdate(publicationId);
  }

  publishAccountsChanged(): void {
    this.router.publishAccountsChanged();
  }

  private async startListening(): Promise<number> {
    if (this.boundPort !== null) return this.boundPort;

    this.router.open();
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
      this.router.close();
      this.boundPort = null;
      return;
    }
    const stopped = new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    this.router.close();
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

  private handle(request: IncomingMessage, response: ServerResponse): void {
    if (!this.hasValidHost(request)) {
      writeJson(response, 400, { code: "INVALID_HOST" });
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
    if (!this.router.route(request, response, url)) {
      writeJson(response, 404, { code: "NOT_FOUND" });
    }
  }

  private hasValidHost(request: IncomingMessage): boolean {
    if (this.boundPort === null || !request.headers.host) return false;
    return request.headers.host === `${LOOPBACK_HOST}:${this.boundPort}`;
  }
}
