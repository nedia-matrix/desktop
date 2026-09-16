import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  createManagedBrowserPage,
  openPersistentBrowserContext,
} from "@nedia-matrix/automation-playwright";
import { detectPlatformSession } from "@nedia-matrix/automation-engine";
import type { PlatformModule } from "@nedia-matrix/platform-sdk";
import type { PlatformAccountSnapshot } from "@nedia-matrix/account-management";
import { PlaywrightBrowserSessionHost } from "../src/main/accounts/infrastructure/playwright-browser-session-host.js";

// Explicitly opt in: this opens a headed browser with an empty synthetic profile.
describe.skipIf(process.env.MATRIX_BROWSER_INTEGRATION !== "1")(
  "real session host",
  () => {
    it("reuses original profile across modes and isolates user, sync, and review lifetimes", async () => {
      const root = await mkdtemp(join(tmpdir(), "matrix-host-integration-"));
      const server = createServer((req, res) => {
        if (req.url === "/login")
          res.setHeader(
            "Set-Cookie",
            "session=synthetic; Path=/; Max-Age=3600; HttpOnly",
          );
        if (req.url === "/identity") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify(
              req.headers.cookie?.includes("session=synthetic")
                ? { id: "synthetic", name: "Synthetic" }
                : {},
            ),
          );
        } else {
          res.end(
            "<!doctype html><title>Synthetic session</title><input id=title>",
          );
        }
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing server address");
      const origin = `http://127.0.0.1:${address.port}`;
      const platform = {
        browser: {
          startUrl: origin,
          allowedHostSuffixes: ["127.0.0.1"],
          sessionCapabilities: {
            isolatedPages: true,
            parallelSync: true,
            headlessSync: true,
          },
        },
        accounts: {
          detection: {
            probes: [
              {
                identityScheme: "synthetic.id",
                source: { kind: "request", url: `${origin}/identity` },
                fields: { externalAccountId: ["id"], nickname: ["name"] },
              },
            ],
          },
        },
      } as unknown as PlatformModule;
      const account = {
        id: "account",
        profileId: "profile",
        externalAccountId: "synthetic",
        identityScheme: "synthetic.id",
      } as PlatformAccountSnapshot;
      const launches: Array<{ headless?: boolean; profileDirectory: string }> =
        [];
      const host = new PlaywrightBrowserSessionHost(() => undefined, {
        openContext: async (options) => {
          launches.push(options);
          return openPersistentBrowserContext(options);
        },
        createPage: createManagedBrowserPage,
        detectSession: detectPlatformSession,
        removeProfileDirectory: rm,
        profilesRoot: () => root,
        evidenceRoot: () => join(root, "evidence"),
      });
      try {
        await host.openForLogin(account, platform, {
          id: "login",
          displayName: "Login",
          url: `${origin}/login`,
        });
        await host.closeAutomation(account);
        const sync = await host.openForVerification(account, platform);
        expect(
          await detectPlatformSession(
            platform.accounts.detection,
            sync.driver,
            sync.sessionProbeClient,
          ),
        ).toMatchObject({
          status: "authenticated",
          externalAccountId: "synthetic",
        });
        const opening = host.openUserPage(account, platform);
        await sync.close();
        const user = await opening;
        const publication = await host.openForPublication(
          account,
          platform,
          "publication",
        );
        const parallel = await host.openForVerification(account, platform);
        await parallel.close();
        await publication.handoff();
        await expect(publication.driver.navigate(origin)).rejects.toThrow(
          "控制权",
        );
        await user.closeByUser();
        expect(publication.page.isClosed()).toBe(false);
        await publication.release();
        await host.focusPublication("publication");
        expect(publication.page.isClosed()).toBe(false);
        await publication.closeByUser();
        expect(launches.map((item) => item.headless)).toEqual([
          false,
          true,
          false,
        ]);
        expect(
          new Set(launches.map((item) => item.profileDirectory)).size,
        ).toBe(1);
      } finally {
        await host.closeAll();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(root, { recursive: true, force: true });
      }
    }, 60_000);
  },
);
