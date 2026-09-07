import {
  PublishMonitorLifecycle,
  type PublishMonitorContext,
  type PublishResultEvent,
  type PublishResultMonitor,
} from "@nedia-matrix/platform-core";

import {
  classifyXiaohongshuPublishResponse,
  isXiaohongshuPublishResponseCandidate,
  type XiaohongshuPublishSignal,
} from "./publish-result.js";

const RESULT_TIMEOUT_MS = 95_000;
const PAGE_POLL_INTERVAL_MS = 500;
const MAX_RESPONSE_BYTES = 2_000_000;

export function createXiaohongshuPublishResultMonitor(
  context: PublishMonitorContext,
): PublishResultMonitor {
  const { session } = context;
  const { clock } = context;
  if (context.contentForm === "longText") {
    throw new TypeError("Xiaohongshu long-text observation is not implemented");
  }
  const contentForm = context.contentForm;
  const listeners = new Set<(event: PublishResultEvent) => void>();
  const lifecycle = new PublishMonitorLifecycle();
  let submissionDeadline: number | null = null;
  let verificationDeadline: number | null = null;
  let pageWatchRun = 0;
  let responseQueue = Promise.resolve();
  let submissionObserved = false;
  let interrupting: Promise<void> | undefined;
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

  const stop = (): void => {
    if (!lifecycle.complete()) return;
    pageWatchRun += 1;
    unsubscribeRequests();
    unsubscribeResponses();
    unsubscribeClose();
  };

  const observeSubmissionRequest = (): void => {
    if (
      submissionObserved ||
      (lifecycle.state !== "armed" && lifecycle.state !== "verifying")
    )
      return;
    submissionObserved = true;
    emit({
      kind: "submission_attempted",
      source: "page_request",
      message: "已观察到小红书发布请求",
    });
  };

  const finish = (event: PublishResultEvent): void => {
    if (lifecycle.state === "completed") return;
    emit(event);
    stop();
  };

  const handleSignal = (signal: XiaohongshuPublishSignal): void => {
    if (
      lifecycle.state === "observing_draft" ||
      lifecycle.state === "completed"
    ) {
      return;
    }
    switch (signal.kind) {
      case "ignore":
        return;
      case "accepted":
        if (!lifecycle.beginVerification()) return;
        if (context.submissionMode === "automatic") {
          verificationDeadline = clock.now() + RESULT_TIMEOUT_MS;
        }
        emit({
          kind: "verifying",
          message: signal.message ?? "平台已受理，正在确认笔记",
        });
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

  async function watchPageResult(run: number): Promise<void> {
    while (
      (lifecycle.state === "armed" || lifecycle.state === "verifying") &&
      run === pageWatchRun
    ) {
      let successVisible = false;
      if (lifecycle.state === "armed") {
        try {
          successVisible = await session.page.isTextVisible("发布成功");
        } catch {
          reportOnce(
            "page",
            "success_indicator_read_failed",
            "无法读取小红书发布成功提示，将继续监听平台响应",
          );
        }
      }
      if (successVisible) {
        handleSignal({
          kind: "accepted",
          message: "页面已显示发布成功，正在确认笔记",
        });
      }
      if (
        lifecycle.state === "armed" &&
        submissionDeadline !== null &&
        clock.now() >= submissionDeadline
      ) {
        finish({
          kind: "uncertain",
          message: "点击发布后平台未返回受理信号，请先核对笔记管理页",
        });
        return;
      }
      if (
        lifecycle.state === "verifying" &&
        verificationDeadline !== null &&
        clock.now() >= verificationDeadline
      ) {
        finish({
          kind: "uncertain",
          message: "未收到小红书明确的作品信息，请先核对笔记管理页再重试",
        });
        return;
      }
      await clock.sleep(PAGE_POLL_INTERVAL_MS);
    }
  }

  async function inspectResponse(
    response: Parameters<Parameters<typeof session.responses.subscribe>[0]>[0],
    eligibleAtArrival: boolean,
  ): Promise<void> {
    if (!eligibleAtArrival) return;
    if (!isXiaohongshuPublishResponseCandidate(response)) return;
    handleSignal(
      classifyXiaohongshuPublishResponse(
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
          "无法读取小红书发布响应，将继续等待明确的发布结果",
        );
      });
  });
  const unsubscribeRequests =
    session.requests?.subscribe((request) => {
      if (isXiaohongshuPublishResponseCandidate(request)) {
        observeSubmissionRequest();
      }
    }) ?? (() => undefined);
  const interrupt = (
    reason: "page_closed" | "observation_interrupted" | "desktop_shutdown",
  ) => {
    interrupting ??= (async () => {
      unsubscribeRequests();
      unsubscribeResponses();
      unsubscribeClose();
      pageWatchRun += 1;
      await responseQueue;
      if (lifecycle.state === "completed") return;
      finish(
        submissionObserved || lifecycle.state === "verifying"
          ? {
              kind: "uncertain",
              message: `${reason === "page_closed" ? "浏览器已关闭" : "发布观察已中断"}，且已存在提交证据，请先核对笔记管理页`,
            }
          : { kind: "cancelled", message: "未观察到提交尝试，发布已取消" },
      );
    })();
    return interrupting;
  };
  const unsubscribeClose = session.page.subscribeClose(() => {
    void interrupt("page_closed");
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async ready() {},
    arm() {
      if (!lifecycle.arm()) return;
      void watchPageResult(++pageWatchRun);
    },
    submissionAttempted() {
      submissionObserved = true;
      if (context.submissionMode === "automatic") {
        submissionDeadline = clock.now() + RESULT_TIMEOUT_MS;
      }
    },
    interrupt,
    stop,
  };
}
