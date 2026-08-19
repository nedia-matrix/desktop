import {
  PublishMonitorLifecycle,
  type PublishMonitorContext,
  type PublishResultEvent,
  type PublishResultMonitor,
} from "@nedia-matrix/platform-core";

import {
  classifyDouyinPublishResponse,
  isDouyinPublishResponseCandidate,
  type DouyinPublishSignal,
} from "./publish-result.js";

const VERIFICATION_TIMEOUT_MS = 95_000;
const VERIFICATION_POLL_INTERVAL_MS = 500;
const SUCCESS_INDICATOR_POLL_INTERVAL_MS = 300;
const MAX_RESPONSE_BYTES = 2_000_000;

export function createDouyinPublishResultMonitor(
  context: PublishMonitorContext,
): PublishResultMonitor {
  const { session } = context;
  const { clock } = context;
  if (context.contentForm === "longText") {
    throw new TypeError("Douyin does not support long-text publishing");
  }
  const contentForm = context.contentForm;
  const listeners = new Set<(event: PublishResultEvent) => void>();
  const lifecycle = new PublishMonitorLifecycle();
  let verificationRun = 0;
  let pageWatchRun = 0;
  let responseQueue = Promise.resolve();
  const reportedDiagnostics = new Set<string>();

  const reportOnce = (
    stage: "response" | "page",
    code: string,
    message: string,
  ): void => {
    const key = `${stage}:${code}`;
    if (reportedDiagnostics.has(key)) return;
    reportedDiagnostics.add(key);
    context.diagnostics.report({ stage, code, message });
  };

  const emit = (event: PublishResultEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const cleanup = (): void => {
    unsubscribeResponses();
    unsubscribeClose();
    verificationRun += 1;
    pageWatchRun += 1;
  };

  const stop = (): void => {
    if (!lifecycle.complete()) return;
    cleanup();
  };

  const finish = (event: PublishResultEvent): void => {
    if (lifecycle.state === "completed") return;
    emit(event);
    stop();
  };

  const handleSignal = (signal: DouyinPublishSignal): void => {
    if (
      lifecycle.state === "observing_draft" ||
      lifecycle.state === "completed"
    ) {
      return;
    }
    switch (signal.kind) {
      case "ignore":
        return;
      case "verification_required":
        lifecycle.requireVerification();
        verificationRun += 1;
        emit({
          kind: "verification_required",
          message: signal.message ?? "平台要求完成安全验证",
        });
        return;
      case "accepted":
        if (!lifecycle.beginVerification()) return;
        emit({
          kind: "verifying",
          message: signal.message ?? "平台已受理，正在确认作品",
        });
        void waitForPublishedIdentity(++verificationRun);
        return;
      case "published":
        finish({
          kind: "published",
          contentId: signal.postId,
          contentUrl: signal.postUrl,
        });
        return;
      case "failed":
        finish({ kind: "failed", message: signal.error });
    }
  };

  async function waitForPublishedIdentity(run: number): Promise<void> {
    const deadline = clock.now() + VERIFICATION_TIMEOUT_MS;
    while (lifecycle.state === "verifying" && run === verificationRun) {
      if (clock.now() >= deadline) break;
      await clock.sleep(VERIFICATION_POLL_INTERVAL_MS);
    }
    if (lifecycle.state !== "verifying" || run !== verificationRun) return;
    finish({
      kind: "uncertain",
      message: "平台已受理，但未在限定时间内确认到新作品，请勿直接重复发布",
    });
  }

  async function watchForPublishSuccess(run: number): Promise<void> {
    while (lifecycle.state === "armed" && run === pageWatchRun) {
      let successVisible = false;
      try {
        successVisible = await session.page.isTextVisible("发布成功");
      } catch {
        reportOnce(
          "page",
          "success_indicator_read_failed",
          "无法读取抖音发布成功提示，将继续监听平台响应",
        );
      }
      if (successVisible) {
        handleSignal({
          kind: "accepted",
          message: "页面已显示发布成功，正在确认作品",
        });
        return;
      }
      await clock.sleep(SUCCESS_INDICATOR_POLL_INTERVAL_MS);
    }
  }

  async function inspectResponse(
    response: Parameters<Parameters<typeof session.responses.subscribe>[0]>[0],
    eligibleAtArrival: boolean,
  ): Promise<void> {
    if (!eligibleAtArrival) return;
    if (!isDouyinPublishResponseCandidate(response)) return;
    handleSignal(
      classifyDouyinPublishResponse(
        {
          method: response.method,
          url: response.url,
          httpStatus: response.status,
          body: await response.readText(MAX_RESPONSE_BYTES),
        },
        contentForm,
      ),
    );
  }

  const unsubscribeResponses = session.responses.subscribe((response) => {
    const eligibleAtArrival =
      lifecycle.state === "armed" || lifecycle.state === "verifying";
    responseQueue = responseQueue
      .then(() => inspectResponse(response, eligibleAtArrival))
      .catch(() => {
        reportOnce(
          "response",
          "publish_response_read_failed",
          "无法读取抖音发布响应，将继续等待明确的发布结果",
        );
      });
  });
  const unsubscribeClose = session.page.subscribeClose(() => {
    if (lifecycle.state === "verifying") {
      finish({
        kind: "uncertain",
        message: "确认发布结果前浏览器已关闭，请勿直接重复发布",
      });
      return;
    }
    stop();
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async ready() {},
    arm() {
      if (!lifecycle.arm()) return;
      void watchForPublishSuccess(++pageWatchRun);
    },
    stop,
  };
}
