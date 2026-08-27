import { request as httpRequest } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import type {
  PlatformAccountSummary,
  PublicationSummary,
} from "@nedia-matrix/ipc-contracts";

import {
  LocalRuntimeServer,
  type LocalRuntimeHandshake,
} from "../src/main/local-runtime/local-runtime-server.js";
import { AccountReplacedError } from "../src/main/accounts/account-application.js";
import type { RuntimeAccountBinding } from "../src/main/local-runtime/runtime-account-binding-store.js";

const origin = "https://www.example.com";

function requestStatus(options: {
  headers: Record<string, string>;
  port: number;
}): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        headers: options.headers,
        host: "127.0.0.1",
        path: "/v1/runtime",
        port: options.port,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.end();
  });
}

const handshake: LocalRuntimeHandshake = {
  protocolVersion: 1,
  runtimeKind: "desktop_playwright",
  runtimeVersion: "0.0.0",
  instanceId: "runtime-instance",
  supportedTargets: [
    { platform: "douyin", contentForm: "video" },
    { platform: "xiaohongshu", contentForm: "image_text" },
  ],
  capabilities: {
    isolatedAccounts: true,
    multipleAccountsPerPlatform: true,
    backgroundObservation: true,
    localPublicationArchive: true,
  },
};

const account: PlatformAccountSummary = {
  id: "account-1",
  platformId: "douyin",
  profileId: "matrix-douyin-account-1",
  lifecycle: "active",
  displayName: "抖音账号",
  identityScheme: "douyin.short_id",
  externalAccountId: "external-1",
  nickname: "测试账号",
  avatarUrl: "https://example.com/avatar.png",
  accountInfo: [{ key: "follower_count", value: 12800 }],
  status: "authenticated",
  lastVerifiedAt: "2026-08-10T00:00:00.000Z",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

function createAccountBindings() {
  const bindings: RuntimeAccountBinding[] = [];
  return {
    bindings,
    store: {
      list: () => [...bindings],
      put: (binding: RuntimeAccountBinding) => {
        bindings.splice(
          0,
          bindings.length,
          ...bindings.filter(
            (candidate) =>
              candidate.platformAccountId !== binding.platformAccountId &&
              candidate.runtimeAccountId !== binding.runtimeAccountId,
          ),
          binding,
        );
      },
      removeForRuntimeAccount: (runtimeAccountId: string) => {
        bindings.splice(
          0,
          bindings.length,
          ...bindings.filter(
            (binding) => binding.runtimeAccountId !== runtimeAccountId,
          ),
        );
      },
    },
  };
}

function createRuntimeApplication(
  initialAccounts: PlatformAccountSummary[] = [account],
  options?: {
    publicationBusy?: boolean;
    verificationMismatch?: boolean;
    replacementAlias?: {
      candidateAccountId: string;
      survivingAccountId: string;
    };
  },
) {
  const accounts = initialAccounts.map((stored) => ({
    ...stored,
    accountInfo: [...(stored.accountInfo ?? [])],
  }));
  const actions: string[] = [];
  const publications: PublicationSummary[] = [];
  const accountBindings = createAccountBindings();
  const resolveAccount = (accountId: string) => {
    const replacementAlias =
      options?.replacementAlias?.candidateAccountId === accountId
        ? {
            ...options.replacementAlias,
            createdAt: "2026-08-10T00:00:00.000Z",
            expiresAt: "2026-08-11T00:00:00.000Z",
          }
        : undefined;
    const resolvedAccountId = replacementAlias?.survivingAccountId ?? accountId;
    const resolved = accounts.find(
      (candidate) => candidate.id === resolvedAccountId,
    );
    if (!resolved) throw new TypeError("Runtime account does not exist");
    return {
      account: resolved,
      ...(replacementAlias ? { replacementAlias } : {}),
    };
  };
  const legacyApplication = {
    listPlatforms: () => [
      {
        id: "douyin",
        displayName: "抖音",
        entryUrl: "https://creator.douyin.com/",
        rulesVersion: "1",
        implementationStatus: "live-tested" as const,
        loginEntries: [
          {
            id: "creator",
            displayName: "创作者中心",
            url: "https://creator.douyin.com/",
          },
        ],
        publishCapabilities: [],
      },
    ],
    listAccounts: () => [...accounts],
    listPublications: () => [...publications],
    prepareRemoteDraft: async (request: {
      accountId: string;
      requestId: string;
      contentForm: "video" | "imageText";
      title: string;
      body: string;
    }) => {
      actions.push(`publish:${request.requestId}`);
      if (options?.publicationBusy) {
        return { status: "account_busy" as const };
      }
      publications.push({
        id: "publication-1",
        requestId: request.requestId,
        platformId: "douyin",
        accountId: request.accountId,
        contentForm: request.contentForm,
        title: request.title,
        body: request.body,
        assets: [{ name: "video.mp4", size: 42 }],
        state: "submitting",
        transitions: [],
        rulesVersion: "test",
        retained: false,
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
        lastMessage: "已提交",
        platformContentId: null,
        platformContentUrl: null,
      });
      return {
        status: "submission_started" as const,
        mediaCount: 1,
        profileId: "profile-1",
        publishObservationId: "observation-1",
        publicationId: "publication-1",
      };
    },
    createAccount: ({ platformId }: { platformId: string }) => {
      if (platformId !== "douyin") throw new TypeError("Unknown platform");
      const created: PlatformAccountSummary = {
        ...account,
        id: `account-${accounts.length + 1}`,
        lifecycle: "pending_identity",
        identityScheme: null,
        externalAccountId: null,
        nickname: null,
        status: "login_required",
      };
      accounts.push(created);
      actions.push(`create:${platformId}`);
      return created;
    },
    openLogin: async ({ accountId }: { accountId: string }) => {
      actions.push(`login:${accountId}`);
      return { profileId: `profile:${accountId}` };
    },
    openAccount: async ({ accountId }: { accountId: string }) => {
      actions.push(`open:${accountId}`);
      return {
        profileId: `profile:${accountId}`,
        sessionId: `session:${accountId}`,
      };
    },
    refreshAccount: async ({ accountId }: { accountId: string }) => {
      actions.push(`refresh:${accountId}`);
      const stored = resolveAccount(accountId).account;
      stored.status = "authenticated";
      stored.externalAccountId = "refreshed-external";
      stored.nickname = "刷新后的账号";
      stored.accountInfo = [{ key: "follower_count", value: 25600 }];
      return {
        status: "authenticated" as const,
        identityScheme: "douyin.short_id",
        externalAccountId: stored.externalAccountId,
        nickname: stored.nickname,
        avatarUrl: null,
        accountInfo: [{ key: "follower_count", value: 25600 }],
        source: "api" as const,
      };
    },
    verifyAccount: async ({ accountId }: { accountId: string }) => {
      actions.push(`verify:${accountId}`);
      const stored = accounts.find((candidate) => candidate.id === accountId);
      if (!stored) throw new TypeError("Platform account does not exist");
      if (options?.verificationMismatch) {
        stored.status = "unknown";
        return {
          status: "unknown" as const,
          reason: "Runtime account identity changed",
        };
      }
      stored.status = "authenticated";
      return {
        status: "authenticated" as const,
        identityScheme: "douyin.short_id",
        externalAccountId: stored.externalAccountId!,
        nickname: stored.nickname!,
        avatarUrl: stored.avatarUrl,
        accountInfo: stored.accountInfo ?? [],
        source: "api" as const,
      };
    },
    removeAccount: async ({ accountId }: { accountId: string }) => {
      actions.push(`remove:${accountId}`);
      const resolved = resolveAccount(accountId);
      if (resolved.replacementAlias) {
        throw new AccountReplacedError(resolved.account.id);
      }
      const index = accounts.findIndex(
        (candidate) => candidate.id === accountId,
      );
      if (index === -1) throw new TypeError("Platform account does not exist");
      accounts.splice(index, 1);
      accountBindings.store.removeForRuntimeAccount(accountId);
    },
  };
  return {
    accounts,
    actions,
    publications,
    accountBindings,
    application: {
      accounts: {
        listPlatforms: legacyApplication.listPlatforms,
        list: legacyApplication.listAccounts,
        resolve: ({ accountId }: { accountId: string }) =>
          resolveAccount(accountId),
        create: legacyApplication.createAccount,
        openLogin: legacyApplication.openLogin,
        open: legacyApplication.openAccount,
        refresh: legacyApplication.refreshAccount,
        verify: legacyApplication.verifyAccount,
        remove: legacyApplication.removeAccount,
        cleanupRetiredProfiles: async () => undefined,
      },
      accountBindings: {
        list: () => accountBindings.store.list(),
        bind: (command: {
          platformAccountId: string;
          runtimeAccountId: string;
        }) => {
          const account = accounts.find(
            (candidate) => candidate.id === command.runtimeAccountId,
          );
          if (!account) throw new TypeError("Runtime account does not exist");
          if (!account.externalAccountId) {
            throw new TypeError(
              "Runtime account does not have a stable identity",
            );
          }
          const binding = {
            platformAccountId: command.platformAccountId,
            runtimeAccountId: account.id,
            platform: account.platformId,
            externalAccountId: account.externalAccountId,
            boundAt: "2026-08-10T01:00:00.000Z",
          };
          accountBindings.store.put(binding);
          return binding;
        },
        verify: async (query: {
          platformAccountId: string;
          runtimeAccountId?: string;
          platform?: string;
        }) => {
          const binding = accountBindings.store
            .list()
            .find(
              (candidate) =>
                candidate.platformAccountId === query.platformAccountId,
            );
          if (!binding) throw new Error("Account binding does not exist");
          const detected = await legacyApplication.verifyAccount({
            accountId: binding.runtimeAccountId,
          });
          if (detected.status !== "authenticated") {
            const error = new Error(
              detected.status === "unknown"
                ? detected.reason
                : "Runtime account is not authenticated",
            ) as Error & {
              code: "ACCOUNT_IDENTITY_MISMATCH" | "NOT_LOGGED_IN";
            };
            error.code =
              detected.status === "unknown"
                ? "ACCOUNT_IDENTITY_MISMATCH"
                : "NOT_LOGGED_IN";
            throw error;
          }
          const verified = accounts.find(
            (candidate) => candidate.id === binding.runtimeAccountId,
          );
          if (!verified) throw new Error("Runtime account does not exist");
          return { account: verified, binding };
        },
        removeForRuntimeAccount: (runtimeAccountId: string) =>
          accountBindings.store.removeForRuntimeAccount(runtimeAccountId),
      },
      publications: {
        list: legacyApplication.listPublications,
        publicationUrl: () => {
          throw new Error("not used");
        },
        prepareRemote: legacyApplication.prepareRemoteDraft,
        prepare: () => {
          throw new Error("not used");
        },
      },
    },
  };
}

describe("LocalRuntimeServer", () => {
  const servers: LocalRuntimeServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it("reports whether the local runtime is listening", async () => {
    const runtime = createRuntimeApplication([]);
    const server = new LocalRuntimeServer({
      application: runtime.application,
      handshake,
      port: 0,
    });
    servers.push(server);
    expect(server.status()).toEqual({
      status: "stopped",
      version: handshake.runtimeVersion,
      host: "127.0.0.1",
      port: null,
    });

    const port = await server.start();
    expect(server.status()).toEqual({
      status: "running",
      version: handshake.runtimeVersion,
      host: "127.0.0.1",
      port,
    });

    await server.stop();
    expect(server.status()).toMatchObject({ status: "stopped", port: null });

    const restartedPort = await server.start();
    expect(server.status()).toMatchObject({
      status: "running",
      port: restartedPort,
    });
  });

  it("discovers the runtime and exposes accounts without authorization", async () => {
    const runtime = createRuntimeApplication();
    const server = new LocalRuntimeServer({
      application: runtime.application,
      handshake,
      port: 0,
    });
    servers.push(server);
    const port = await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    const discovery = await fetch(`${baseUrl}/v1/runtime`, {
      headers: { Origin: origin },
    });
    expect(discovery.status).toBe(200);
    expect(discovery.headers.get("access-control-allow-origin")).toBe("*");
    expect(await discovery.json()).toEqual(handshake);

    const preflight = await fetch(`${baseUrl}/v1/accounts`, {
      method: "OPTIONS",
      headers: {
        "Access-Control-Request-Private-Network": "true",
        Origin: origin,
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-private-network")).toBe(
      "true",
    );

    const accounts = await fetch(`${baseUrl}/v1/accounts`);
    expect(accounts.status).toBe(200);
    expect(await accounts.json()).toEqual([
      {
        runtimeAccountId: "account-1",
        platform: "douyin",
        loggedIn: true,
        status: "connected",
        nickname: "测试账号",
        externalAccountId: "external-1",
        avatarUrl: "https://example.com/avatar.png",
        accountInfo: [{ key: "follower_count", value: 12800 }],
        lastVerifiedAt: "2026-08-10T00:00:00.000Z",
      },
    ]);
  });

  it("persists an explicit server-channel to local-runtime account binding", async () => {
    const runtime = createRuntimeApplication();
    const accountBindings = runtime.accountBindings;
    const server = new LocalRuntimeServer({
      application: runtime.application,
      handshake,
      port: 0,
    });
    servers.push(server);
    const port = await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;

    const headers = {
      "Content-Type": "application/json",
    };
    const binding = await fetch(
      `${baseUrl}/v1/account-bindings/platform-account-1`,
      {
        body: JSON.stringify({ runtimeAccountId: account.id }),
        headers,
        method: "PUT",
      },
    );

    expect(binding.status).toBe(200);
    expect(await binding.json()).toEqual({
      platformAccountId: "platform-account-1",
      runtimeAccountId: account.id,
      platform: "douyin",
      externalAccountId: "external-1",
      boundAt: "2026-08-10T01:00:00.000Z",
    });
    const listed = await fetch(`${baseUrl}/v1/account-bindings`, { headers });
    expect(await listed.json()).toEqual(accountBindings.bindings);
  });

  it("creates, opens, refreshes, and removes an isolated account", async () => {
    const runtime = createRuntimeApplication([]);
    const accountBindings = runtime.accountBindings;
    const server = new LocalRuntimeServer({
      application: runtime.application,
      handshake,
      port: 0,
    });
    servers.push(server);
    const port = await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      "Content-Type": "application/json",
    };

    const createdResponse = await fetch(`${baseUrl}/v1/accounts`, {
      body: JSON.stringify({ platform: "douyin" }),
      headers,
      method: "POST",
    });
    const created = (await createdResponse.json()) as {
      runtimeAccountId: string;
    };
    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({ platform: "douyin", status: "expired" });

    const openResponse = await fetch(
      `${baseUrl}/v1/accounts/${created.runtimeAccountId}/open`,
      {
        body: "{}",
        headers,
        method: "POST",
      },
    );
    expect(openResponse.status).toBe(200);
    expect(runtime.actions).toContain(`login:${created.runtimeAccountId}`);

    const refreshResponse = await fetch(
      `${baseUrl}/v1/accounts/${created.runtimeAccountId}/refresh`,
      {
        body: "{}",
        headers,
        method: "POST",
      },
    );
    expect(await refreshResponse.json()).toMatchObject({
      externalAccountId: "refreshed-external",
      status: "connected",
    });

    accountBindings.store.put({
      platformAccountId: "platform-account-1",
      runtimeAccountId: created.runtimeAccountId,
      platform: "douyin",
      externalAccountId: "refreshed-external",
      boundAt: "2026-08-10T01:00:00.000Z",
    });
    const removeResponse = await fetch(
      `${baseUrl}/v1/accounts/${created.runtimeAccountId}`,
      {
        headers,
        method: "DELETE",
      },
    );
    expect(removeResponse.status).toBe(200);
    expect(runtime.accounts).toEqual([]);
    expect(accountBindings.bindings).toEqual([]);
  });

  it("resolves a replaced candidate id without adding a new HTTP flow", async () => {
    const runtime = createRuntimeApplication([account], {
      replacementAlias: {
        candidateAccountId: "candidate-account",
        survivingAccountId: account.id,
      },
    });
    const server = new LocalRuntimeServer({
      application: runtime.application,
      handshake,
      port: 0,
    });
    servers.push(server);
    const port = await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = { "Content-Type": "application/json" };

    const refreshResponse = await fetch(
      `${baseUrl}/v1/accounts/candidate-account/refresh`,
      { body: "{}", headers, method: "POST" },
    );
    expect(refreshResponse.status).toBe(200);
    expect(await refreshResponse.json()).toMatchObject({
      runtimeAccountId: account.id,
      resolution: {
        kind: "existing_account_profile_replaced",
        requestedRuntimeAccountId: "candidate-account",
      },
    });

    const removeResponse = await fetch(
      `${baseUrl}/v1/accounts/candidate-account`,
      { headers, method: "DELETE" },
    );
    expect(removeResponse.status).toBe(409);
    expect(await removeResponse.json()).toMatchObject({
      code: "ACCOUNT_REPLACED",
      runtimeAccountId: account.id,
    });
    expect(runtime.accounts).toEqual([
      expect.objectContaining({ id: account.id }),
    ]);
  });

  it("rejects a binding when the verified stable identity changed", async () => {
    const runtime = createRuntimeApplication([account], {
      verificationMismatch: true,
    });
    const accountBindings = runtime.accountBindings;
    accountBindings.store.put({
      platformAccountId: "platform-account-1",
      runtimeAccountId: account.id,
      platform: "douyin",
      externalAccountId: "external-1",
      boundAt: "2026-08-10T01:00:00.000Z",
    });
    const server = new LocalRuntimeServer({
      application: runtime.application,
      handshake,
      port: 0,
    });
    servers.push(server);
    const port = await server.start();
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/account-bindings/platform-account-1/verify`,
      {
        body: "{}",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "ACCOUNT_IDENTITY_MISMATCH",
    });

    const publication = await fetch(
      `http://127.0.0.1:${port}/v1/publications`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: "identity-mismatch",
          target: {
            platform: "douyin",
            contentForm: "video",
            platformAccountId: "platform-account-1",
            runtimeAccountId: account.id,
          },
          content: {
            title: "不会发布",
            body: { type: "plain_text", text: "正文" },
            video: {
              url: "https://assets.example.test/video.mp4",
              name: "video.mp4",
              type: "video/mp4",
            },
          },
          limits: {},
        }),
      },
    );
    expect(publication.status).toBe(409);
    expect(await publication.json()).toMatchObject({
      code: "ACCOUNT_IDENTITY_MISMATCH",
    });
    expect(runtime.actions).not.toContain("publish:identity-mismatch");
  });

  it("creates a bound publication once and restores its final status by request id", async () => {
    const runtime = createRuntimeApplication();
    const accountBindings = runtime.accountBindings;
    accountBindings.store.put({
      platformAccountId: "platform-account-1",
      runtimeAccountId: account.id,
      platform: "douyin",
      externalAccountId: "external-1",
      boundAt: "2026-08-10T01:00:00.000Z",
    });
    const server = new LocalRuntimeServer({
      application: runtime.application,
      handshake,
      port: 0,
    });
    servers.push(server);
    const port = await server.start();
    const baseUrl = `http://127.0.0.1:${port}`;
    const headers = {
      "Content-Type": "application/json",
    };

    const created = await fetch(`${baseUrl}/v1/publications`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId: "request-1",
        target: {
          platform: "douyin",
          contentForm: "video",
          platformAccountId: "platform-account-1",
          runtimeAccountId: account.id,
        },
        content: {
          title: "测试视频",
          body: { type: "plain_text", text: "正文" },
          video: {
            url: "https://assets.example.test/video.mp4",
            name: "video.mp4",
            type: "video/mp4",
          },
        },
        limits: {},
      }),
    });
    expect(created.status).toBe(202);
    expect(await created.json()).toMatchObject({
      requestId: "request-1",
      state: "submitting",
    });
    expect(
      runtime.actions.filter((action) => action.startsWith("publish:")),
    ).toEqual(["publish:request-1"]);

    Object.assign(runtime.publications[0]!, {
      state: "published",
      platformContentId: "work-1",
      platformContentUrl: "https://www.douyin.com/video/work-1",
    });
    server.publishPublicationUpdate("publication-1");
    const status = await fetch(`${baseUrl}/v1/publications/request-1`, {
      headers,
    });
    expect(await status.json()).toMatchObject({
      requestId: "request-1",
      state: "published",
      result: {
        ok: true,
        platformPostId: "work-1",
      },
    });

    const events = await fetch(`${baseUrl}/v1/events?after=0`, { headers });
    expect(await events.json()).toMatchObject({
      cursor: 1,
      reset: false,
      events: [
        {
          type: "runtime.publish.result",
          requestId: "request-1",
          result: { state: "published", platformPostId: "work-1" },
        },
      ],
    });
  });

  it("reports an account-level publication conflict without creating history", async () => {
    const runtime = createRuntimeApplication([account], {
      publicationBusy: true,
    });
    const accountBindings = runtime.accountBindings;
    accountBindings.store.put({
      platformAccountId: "platform-account-1",
      runtimeAccountId: account.id,
      platform: "douyin",
      externalAccountId: "external-1",
      boundAt: "2026-08-10T01:00:00.000Z",
    });
    const server = new LocalRuntimeServer({
      application: runtime.application,
      handshake,
      port: 0,
    });
    servers.push(server);
    const port = await server.start();
    const response = await fetch(`http://127.0.0.1:${port}/v1/publications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: "request-busy",
        target: {
          platform: "douyin",
          contentForm: "video",
          platformAccountId: "platform-account-1",
          runtimeAccountId: account.id,
        },
        content: {
          title: "测试视频",
          body: { type: "plain_text", text: "正文" },
          video: {
            url: "https://assets.example.test/video.mp4",
            name: "video.mp4",
            type: "video/mp4",
          },
        },
        limits: {},
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "ACCOUNT_BUSY" });
    expect(runtime.publications).toEqual([]);
  });

  it("allows missing origins and rejects forged Host headers", async () => {
    const runtime = createRuntimeApplication([]);
    const server = new LocalRuntimeServer({
      application: runtime.application,
      handshake,
      port: 0,
    });
    servers.push(server);
    const port = await server.start();

    expect((await fetch(`http://127.0.0.1:${port}/v1/runtime`)).status).toBe(
      200,
    );
    expect(
      await requestStatus({
        headers: { Host: `localhost:${port}`, Origin: origin },
        port,
      }),
    ).toBe(400);
  });
});
