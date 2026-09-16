import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  openPersistentBrowserContext,
  createManagedBrowserPage,
} from "../dist/index.js";

const server = createServer((request, response) => {
  if (request.url === "/login")
    response.setHeader(
      "Set-Cookie",
      "session=synthetic-account; Path=/; Max-Age=3600; HttpOnly",
    );
  if (request.url === "/identity") {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        account: request.headers.cookie?.includes("session=synthetic-account")
          ? "synthetic-account"
          : null,
      }),
    );
  } else if (request.url === "/publish") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ contentId: "synthetic-content-1" }));
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(
      `<input id="title"><input id="file" type="file"><button id="publish" onclick="fetch('/publish',{method:'POST'})">Publish</button>`,
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const root = await mkdtemp(join(tmpdir(), "matrix-page-isolation-"));
const options = {
  profileDirectory: join(root, "profile"),
  profileId: "synthetic",
  evidenceDirectory: join(root, "evidence"),
  browser: { startUrl: origin, allowedHostSuffixes: ["127.0.0.1"] },
  sessionDetection: { probes: [] },
};
const artifactDirectory = resolve(process.cwd(), "output/playwright");
const report = {
  checks: [],
  channel: null,
  version: null,
  date: new Date().toISOString(),
  realPlatform: false,
};
let browser;
try {
  browser = await openPersistentBrowserContext({ ...options, headless: false });
  report.channel = browser.channel;
  report.version = browser.context.browser()?.version();
  const user = await createManagedBrowserPage(browser, options, "user");
  await user.driver.navigate(`${origin}/login`);
  await user.page.evaluate(() =>
    localStorage.setItem("identity", "synthetic-account"),
  );
  await user.handoff();
  const publish = await createManagedBrowserPage(
    browser,
    options,
    "publish",
    "publication-1",
  );
  await publish.driver.navigate(origin);
  const sync = await createManagedBrowserPage(browser, options, "sync");
  await sync.driver.navigate(`${origin}/identity`);
  assert.equal(
    (
      await browser.context.request
        .get(`${origin}/identity`)
        .then((r) => r.json())
    ).account,
    "synthetic-account",
  );
  await sync.close();
  assert.equal(user.page.url(), `${origin}/login`);
  assert.equal(publish.page.isClosed(), false);
  report.checks.push(
    "same-context shared cookie; scoped sync leaves user and publish intact",
  );
  const title = (
    await publish.driver.query({ kind: "css", selector: "#title" })
  )[0];
  await publish.driver.fill(title, "合成测试 title");
  const file = join(root, "fixture.txt");
  await writeFile(file, "synthetic");
  const input = (
    await publish.driver.query({ kind: "css", selector: "#file" })
  )[0];
  await publish.driver.uploadFiles(input, [file]);
  assert.equal(
    await publish.page.locator("#file").evaluate((el) => el.files[0].name),
    "fixture.txt",
  );
  assert.equal(
    await publish.page.locator("#title").inputValue(),
    "合成测试 title",
  );
  report.checks.push("background page driver fill and upload");
  const observed = [];
  const observedResult = Promise.withResolvers();
  const reads = [];
  const unsubscribe = publish.observationSession.responses.subscribe((r) => {
    if (r.url === `${origin}/publish`)
      reads.push(
        r.readText(1000).then((body) => {
          observed.push(JSON.parse(body).contentId);
          observedResult.resolve();
        }, observedResult.reject),
      );
  });
  await user.page.evaluate(() =>
    fetch("/publish", { method: "POST" }).then((r) => r.json()),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(observed, []);
  await publish.handoff();
  await assert.rejects(publish.driver.fill(title, "must not write"), /控制权/);
  const response = publish.page.waitForResponse(
    (r) => r.url() === `${origin}/publish`,
  );
  await publish.page.locator("#publish").click();
  await response;
  const resultTimer = setTimeout(
    () => observedResult.reject(new Error("CDP result timed out")),
    5000,
  );
  try {
    await observedResult.promise;
  } finally {
    clearTimeout(resultTimer);
  }
  await Promise.all(reads);
  assert.deepEqual(observed, ["synthetic-content-1"]);
  unsubscribe();
  await user.closeByUser();
  assert.equal(publish.page.isClosed(), false);
  await publish.release();
  assert.equal(publish.page.isClosed(), false);
  await mkdir(artifactDirectory, { recursive: true });
  await publish.page.screenshot({
    path: join(artifactDirectory, "session-isolation.png"),
  });
  report.checks.push(
    "handoff revokes old control; only publication page response yields content ID; human page survives release",
  );
  await publish.closeByUser();
  await browser.close();
  browser = await openPersistentBrowserContext({
    ...options,
    headless: true,
    preferredChannel: report.channel,
  });
  const hidden = await createManagedBrowserPage(browser, options, "sync");
  await hidden.driver.navigate(origin);
  assert.equal(
    await hidden.page.evaluate(() => localStorage.getItem("identity")),
    "synthetic-account",
  );
  assert.equal(
    (
      await browser.context.request
        .get(`${origin}/identity`)
        .then((r) => r.json())
    ).account,
    "synthetic-account",
  );
  report.checks.push(
    "headed to headless reopens original profile and preserves cookie/localStorage without copying",
  );
  await hidden.close();
  await browser.close();
  browser = undefined;
  report.passed = true;
  await writeFile(
    join(artifactDirectory, "session-isolation.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
