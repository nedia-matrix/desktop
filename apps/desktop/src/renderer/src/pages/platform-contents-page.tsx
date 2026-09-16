import type {
  PlatformContentSnapshot,
  PlatformContentSyncRun,
} from "@nedia-matrix/platform-content";
import { useEffect, useMemo, useState } from "preact/hooks";

import type { AppContext } from "../app-context.js";
import { Icon } from "../components/icons.js";
import { accountLabel, errorMessage, formatTime } from "../shared.js";

interface ContentState {
  items: PlatformContentSnapshot[];
  latestRun: PlatformContentSyncRun | null;
}

const emptyState: ContentState = { items: [], latestRun: null };

export function PlatformContentsPage({
  context,
  fixedAccountId,
  refreshToken = 0,
}: {
  context: AppContext;
  fixedAccountId?: string;
  refreshToken?: number;
}) {
  const [accounts, setAccounts] = useState(context.accounts);
  const [accountId, setAccountId] = useState(fixedAccountId ?? "");
  const [data, setData] = useState<ContentState>(emptyState);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let active = true;
    void context
      .refreshAccounts()
      .then((refreshed) => {
        if (!active) return;
        setAccounts(refreshed);
        if (fixedAccountId) {
          setAccountId(fixedAccountId);
          return;
        }
        setAccountId((selected) =>
          refreshed.some(({ id }) => id === selected)
            ? selected
            : (refreshed.find(({ status }) => status === "authenticated")?.id ??
              refreshed[0]?.id ??
              ""),
        );
      })
      .catch((error) =>
        context.setStatus(errorMessage(error, "账号加载失败"), "error"),
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    const stopUpdates = context.onAccountUpdate((refreshed) => {
      if (active) setAccounts(refreshed);
    });
    return () => {
      active = false;
      stopUpdates();
    };
  }, [context, fixedAccountId]);

  useEffect(() => {
    if (fixedAccountId) setAccountId(fixedAccountId);
  }, [fixedAccountId]);

  useEffect(() => {
    if (!accountId) {
      setData(emptyState);
      return;
    }
    let active = true;
    setLoading(true);
    void window.matrix
      .listPlatformContents({ accountId })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error) => {
        if (active)
          context.setStatus(errorMessage(error, "平台作品加载失败"), "error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountId, context, refreshToken]);

  const account = useMemo(
    () => accounts.find(({ id }) => id === accountId),
    [accountId, accounts],
  );

  const synchronize = async () => {
    if (!accountId) return;
    setSyncing(true);
    context.setStatus("正在从平台读取作品和最新指标…", "busy");
    try {
      const run = await window.matrix.refreshPlatformContents({ accountId });
      const refreshed = await window.matrix.listPlatformContents({ accountId });
      setData(refreshed);
      if (run.status === "failed") {
        context.setStatus(run.diagnostics[0] ?? "平台作品同步失败", "error");
      } else if (run.status === "partial") {
        context.setStatus(
          run.diagnostics[0] ?? `已读取 ${run.itemsRead} 条作品，结果不完整`,
          "error",
        );
      } else {
        context.setStatus(`已同步 ${run.itemsRead} 条平台作品`);
      }
    } catch (error) {
      context.setStatus(errorMessage(error, "平台作品同步失败"), "error");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div class="page-stack">
      {!fixedAccountId && (
        <section class="page-toolbar content-toolbar" aria-label="平台作品操作">
          <div class="filter-controls">
            <label>
              账号
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.currentTarget.value)}
              >
                {accounts.length === 0 && <option value="">暂无账号</option>}
                {accounts.map((item) => (
                  <option value={item.id} key={item.id}>
                    {accountLabel(item, context.platforms)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            class="compact-button"
            disabled={!account || account.status !== "authenticated" || syncing}
            onClick={() => void synchronize()}
          >
            <Icon name="refresh" size={16} />
            {syncing ? "同步中" : "同步作品"}
          </button>
        </section>
      )}

      {data.latestRun && <SyncRunSummary run={data.latestRun} />}

      <section class="data-surface" aria-labelledby="platform-content-title">
        <header class="surface-header">
          <div>
            <h2 id="platform-content-title">平台作品快照</h2>
            <p>
              显示最近一次手动同步保存的作品和指标，共 {data.items.length} 条。
            </p>
          </div>
        </header>
        <div class="platform-content-heading" aria-hidden="true">
          <span>作品</span>
          <span>指标</span>
          <span>平台状态</span>
          <span>数据时间</span>
        </div>
        <div class="content-list" aria-live="polite">
          {loading ? (
            <EmptyContent title="正在加载平台作品…" />
          ) : data.items.length === 0 ? (
            <EmptyContent
              title="还没有平台作品快照"
              detail="点击账号顶部的“同步作品”读取平台内容。"
            />
          ) : (
            data.items.map((content) => (
              <PlatformContentRow content={content} key={content.id} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function SyncRunSummary({ run }: { run: PlatformContentSyncRun }) {
  const label =
    run.status === "completed"
      ? "同步完成"
      : run.status === "partial"
        ? "同步结果不完整"
        : "同步失败";
  return (
    <section class={`sync-run-summary sync-${run.status}`}>
      <strong>{label}</strong>
      <span>
        {formatTime(run.completedAt)} · {run.pagesRead} 页 · {run.itemsRead} 条
        {run.remoteTotal === null ? "" : ` / 平台共 ${run.remoteTotal} 条`}
      </span>
      {run.diagnostics.length > 0 && (
        <small>{run.diagnostics.join("；")}</small>
      )}
    </section>
  );
}

function PlatformContentRow({ content }: { content: PlatformContentSnapshot }) {
  return (
    <article class="platform-content-row">
      <div class="content-summary-cell">
        <PlatformContentCover content={content} />
        <span>
          <strong>
            {content.title ?? content.description ?? "未命名作品"}
          </strong>
          <small title={content.externalContentId}>
            {content.externalContentId}
          </small>
        </span>
      </div>
      <div class="platform-content-metrics">
        <Metric label="播放" value={content.metrics.viewCount} />
        <Metric label="点赞" value={content.metrics.likeCount} />
        <Metric label="评论" value={content.metrics.commentCount} />
        <Metric label="收藏" value={content.metrics.collectCount} />
      </div>
      <span class="platform-content-status">
        {content.platformStatus ?? "—"}
      </span>
      <div class="content-time-cell">
        <strong>
          {content.publishedAt ? formatTime(content.publishedAt) : "—"}
        </strong>
        <small>采集 {formatTime(content.contentObservedAt)}</small>
      </div>
    </article>
  );
}

function PlatformContentCover({
  content,
}: {
  content: PlatformContentSnapshot;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!content.coverUrl || failedUrl === content.coverUrl) {
    return (
      <span class="content-type-icon">
        <Icon name={content.contentType === "video" ? "video" : "image"} />
      </span>
    );
  }
  return (
    <img
      class="platform-content-cover"
      src={content.coverUrl}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(content.coverUrl)}
    />
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return (
    <span>
      <strong>
        {value === undefined
          ? "—"
          : new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(
              value,
            )}
      </strong>
      <small>{label}</small>
    </span>
  );
}

function EmptyContent({ title, detail }: { title: string; detail?: string }) {
  return (
    <div class="empty-state">
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}
