import type {
  LocalRuntimeDiagnostics,
  LocalRuntimeRequestLog,
} from "@nedia-matrix/ipc-contracts";

import type { AppContext } from "../app-context.js";
import type { PageInstance } from "../router.js";
import { errorMessage, formatTime, requireElement } from "../shared.js";

export function createDiagnosticsPage(context: AppContext): PageInstance {
  let root: HTMLElement | undefined;
  let refreshTimer: number | undefined;
  let loading = false;

  async function refresh(): Promise<void> {
    if (!root || loading) return;
    loading = true;
    try {
      render(await window.matrix.getLocalRuntimeDiagnostics());
    } catch (error) {
      context.setStatus(errorMessage(error, "读取服务诊断失败"), "error");
    } finally {
      loading = false;
    }
  }

  function render(diagnostics: LocalRuntimeDiagnostics): void {
    if (!root) return;
    const status = requireElement<HTMLElement>(root, "#runtime-status");
    status.textContent = diagnostics.status === "running" ? "运行中" : "未运行";
    status.className = `service-value ${diagnostics.status}`;
    requireElement<HTMLElement>(root, "#runtime-address").textContent =
      diagnostics.port === null
        ? "—"
        : `http://${diagnostics.host}:${diagnostics.port}`;
    requireElement<HTMLElement>(root, "#runtime-request-count").textContent =
      String(diagnostics.requests.length);
    renderRequests(diagnostics.requests);
  }

  function renderRequests(requests: readonly LocalRuntimeRequestLog[]): void {
    const body = requireElement<HTMLTableSectionElement>(root!, "#request-log");
    const empty = requireElement<HTMLElement>(root!, "#request-log-empty");
    body.replaceChildren();
    empty.hidden = requests.length > 0;
    for (const request of requests) {
      const row = document.createElement("tr");
      if (request.statusCode >= 400) row.className = "request-error";
      appendCell(row, formatTime(request.timestamp));
      appendCell(row, request.method, "method-cell");
      appendCell(row, request.path, "path-cell");
      appendCell(row, String(request.statusCode), "status-code-cell");
      appendCell(row, `${request.durationMs} ms`);
      appendCell(row, request.origin ?? "—", "origin-cell");
      appendCell(row, request.errorCode ?? "—", "error-code-cell");
      body.append(row);
    }
  }

  return {
    async mount(container) {
      root = document.createElement("div");
      root.className = "page-stack";
      root.innerHTML = `
        <section class="service-overview" aria-label="HTTP 服务状态">
          <article class="metric-card">
            <p>服务状态</p><strong id="runtime-status" class="service-value">读取中</strong>
          </article>
          <article class="metric-card wide-metric">
            <p>监听地址</p><strong id="runtime-address" class="service-value">—</strong>
          </article>
          <article class="metric-card">
            <p>内存日志</p><strong id="runtime-request-count" class="service-value">0</strong>
          </article>
        </section>
        <section class="panel" aria-labelledby="request-log-title">
          <div class="section-heading">
            <div>
              <p class="section-label">HTTP 服务</p>
              <h2 id="request-log-title">请求日志</h2>
            </div>
            <div class="diagnostic-actions">
              <button id="refresh-logs" class="secondary-button small-button" type="button">刷新</button>
              <button id="clear-logs" class="secondary-button small-button danger-button" type="button">清空</button>
            </div>
          </div>
          <p class="privacy-note">最多保留最近 500 条，仅存在内存中；不记录请求正文、查询参数或媒体地址。</p>
          <div class="table-scroll">
            <table class="request-table">
              <thead><tr><th>时间</th><th>方法</th><th>路径</th><th>状态</th><th>耗时</th><th>Origin</th><th>错误码</th></tr></thead>
              <tbody id="request-log"></tbody>
            </table>
          </div>
          <p id="request-log-empty" class="empty-state">暂时没有 HTTP 请求。</p>
        </section>`;
      container.append(root);
      requireElement<HTMLButtonElement>(root, "#refresh-logs").addEventListener(
        "click",
        () => void refresh(),
      );
      requireElement<HTMLButtonElement>(root, "#clear-logs").addEventListener(
        "click",
        async () => {
          try {
            await window.matrix.clearLocalRuntimeRequestLogs();
            await refresh();
            context.setStatus("HTTP 请求日志已清空");
          } catch (error) {
            context.setStatus(errorMessage(error, "清空日志失败"), "error");
          }
        },
      );
      await refresh();
      refreshTimer = window.setInterval(() => void refresh(), 2_000);
    },
    unmount() {
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
      refreshTimer = undefined;
      root = undefined;
    },
  };
}

function appendCell(
  row: HTMLTableRowElement,
  value: string,
  className = "",
): void {
  const cell = document.createElement("td");
  cell.className = className;
  cell.textContent = value;
  row.append(cell);
}
