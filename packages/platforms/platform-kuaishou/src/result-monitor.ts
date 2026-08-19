import {
  PublishMonitorLifecycle,
  type ObservedHttpResponse,
  type PublishMonitorContext,
  type PublishResultEvent,
  type PublishResultMonitor,
} from "@nedia-matrix/platform-core";

const publishRefreshPath = "/rest/cp/works/v2/video/pc/publish/refresh";
const maxResponseBytes = 2_000_000;
const verificationTimeoutMs = 120_000;
const verificationPollIntervalMs = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type PublishRefreshClassification =
  | { kind: "waiting" }
  | { kind: "published"; workId: string }
  | { kind: "uncertain"; message: string };

function normalizedWorkId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function classifyPublishRefresh(body: unknown): PublishRefreshClassification {
  if (
    !isRecord(body) ||
    !isRecord(body.data) ||
    !Array.isArray(body.data.list)
  ) {
    return {
      kind: "uncertain",
      message: "快手发布刷新响应缺少有效作品状态",
    };
  }

  const first = body.data.list[0];
  if (!isRecord(first)) {
    return {
      kind: "uncertain",
      message: "快手发布刷新响应缺少有效作品状态",
    };
  }

  const workId = normalizedWorkId(first.workId);
  if (workId) return { kind: "published", workId };
  if (first.publishStatus === 2) return { kind: "waiting" };
  if (first.publishStatus !== 4) {
    return {
      kind: "uncertain",
      message: `快手返回未知发布状态：${String(first.publishStatus)}`,
    };
  }

  return {
    kind: "uncertain",
    message: "快手返回发布成功状态，但没有有效作品 ID",
  };
}

function isPublishRefreshResponse(response: ObservedHttpResponse): boolean {
  return (
    response.method.toUpperCase() === "POST" &&
    new RegExp(
      `^https://cp\\.kuaishou\\.com${publishRefreshPath.replaceAll("/", "\\/")}(?:[?#].*)?$`,
    ).test(response.url)
  );
}

export function createKuaishouPublishResultMonitor(
  context: PublishMonitorContext,
): PublishResultMonitor {
  if (context.contentForm !== "video" && context.contentForm !== "imageText") {
    throw new TypeError("Kuaishou does not support long-text publishing");
  }
  const { session, clock } = context;
  const lifecycle = new PublishMonitorLifecycle();
  const listeners = new Set<(event: PublishResultEvent) => void>();
  let responseQueue = Promise.resolve();
  let verificationRun = 0;

  const emit = (event: PublishResultEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const stop = (): void => {
    if (!lifecycle.complete()) return;
    verificationRun += 1;
    unsubscribeResponses();
    unsubscribeClose();
  };
  const finish = (event: PublishResultEvent): void => {
    if (lifecycle.state === "completed") return;
    emit(event);
    stop();
  };

  const beginVerification = (): void => {
    if (!lifecycle.beginVerification()) return;
    emit({
      kind: "verifying",
      message: "快手页面已提交，正在等待发布结果",
    });
    void waitForVerification(++verificationRun);
  };

  async function inspectResponse(
    response: ObservedHttpResponse,
  ): Promise<void> {
    if (
      !isPublishRefreshResponse(response) ||
      lifecycle.state === "observing_draft" ||
      lifecycle.state === "completed"
    ) {
      return;
    }
    if (lifecycle.state === "armed") beginVerification();
    if (response.status >= 400) {
      context.diagnostics.report({
        stage: "response",
        code: "publish_refresh_failed",
        message: `快手发布刷新接口返回 ${response.status}`,
      });
      finish({
        kind: "uncertain",
        message: `快手发布刷新接口返回 ${response.status}，请核实平台结果`,
      });
      return;
    }
    const body = JSON.parse(
      await response.readText(maxResponseBytes),
    ) as unknown;
    const result = classifyPublishRefresh(body);
    if (result.kind === "waiting") return;
    if (result.kind === "uncertain") {
      finish({ kind: "uncertain", message: result.message });
      return;
    }
    const contentUrl = `https://www.kuaishou.com/short-video/${result.workId}`;
    finish({ kind: "published", contentId: result.workId, contentUrl });
  }

  async function waitForVerification(run: number): Promise<void> {
    const deadline = clock.now() + verificationTimeoutMs;
    while (lifecycle.state === "verifying" && run === verificationRun) {
      if (clock.now() >= deadline) {
        finish({
          kind: "uncertain",
          message: "快手已出现提交迹象，但未收到明确发布结果，请勿直接重复发布",
        });
        return;
      }
      await clock.sleep(verificationPollIntervalMs);
    }
  }

  const unsubscribeResponses = session.responses.subscribe((response) => {
    responseQueue = responseQueue
      .then(() => inspectResponse(response))
      .catch(() => {
        context.diagnostics.report({
          stage: "response",
          code: "response_parse_failed",
          message: "无法解析快手发布刷新响应",
        });
        if (lifecycle.state !== "completed") {
          finish({
            kind: "uncertain",
            message: "无法解析快手发布刷新响应，请核实平台结果",
          });
        }
      });
  });
  const unsubscribeClose = session.page.subscribeClose(() => {
    if (lifecycle.state === "armed" || lifecycle.state === "verifying") {
      finish({
        kind: "uncertain",
        message: "快手发布窗口已关闭，请先在平台核实结果",
      });
    } else {
      stop();
    }
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async ready() {},
    arm() {
      if (!lifecycle.arm()) return;
      if (context.submissionMode === "automatic") beginVerification();
    },
    stop,
  };
}
