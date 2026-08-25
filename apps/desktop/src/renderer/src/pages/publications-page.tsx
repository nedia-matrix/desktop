import type {
  PublicationStatus,
  PublicationSummary,
} from "@nedia-matrix/ipc-contracts";
import { useEffect, useMemo, useState } from "preact/hooks";

import type { AppContext } from "../app-context.js";
import { Icon } from "../components/icons.js";
import {
  accountLabel,
  errorMessage,
  formatTime,
  publicationStateLabels,
} from "../shared.js";

export function PublicationsPage({ context }: { context: AppContext }) {
  const [publications, setPublications] = useState(context.publications);
  const [accounts, setAccounts] = useState(context.accounts);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [platformId, setPlatformId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [state, setState] = useState<PublicationStatus | "">("");

  const loadPublications = async () => {
    const [refreshedAccounts, refreshedPublications] = await Promise.all([
      context.refreshAccounts(),
      context.refreshPublications(),
    ]);
    setAccounts(refreshedAccounts);
    setPublications(refreshedPublications);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([context.refreshAccounts(), context.refreshPublications()])
      .then(([refreshedAccounts, refreshedPublications]) => {
        if (!active) return;
        setAccounts(refreshedAccounts);
        setPublications(refreshedPublications);
      })
      .catch((error) =>
        context.setStatus(errorMessage(error, "内容记录加载失败"), "error"),
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    const stopPublishUpdates = context.onPublishUpdate(() => {
      void context.refreshPublications().then((refreshed) => {
        if (active) setPublications(refreshed);
      });
    });
    const stopAccountUpdates = context.onAccountUpdate((refreshed) => {
      if (active) setAccounts(refreshed);
    });
    return () => {
      active = false;
      stopPublishUpdates();
      stopAccountUpdates();
    };
  }, [context]);

  const filtered = useMemo(
    () =>
      publications.filter(
        (publication) =>
          (!platformId || publication.platformId === platformId) &&
          (!accountId || publication.accountId === accountId) &&
          (!state || publication.state === state),
      ),
    [accountId, platformId, publications, state],
  );

  return (
    <div class="page-stack">
      <section class="page-toolbar content-toolbar" aria-label="内容筛选">
        <div class="filter-controls">
          <label>
            平台
            <select
              value={platformId}
              onChange={(event) => setPlatformId(event.currentTarget.value)}
            >
              <option value="">全部平台</option>
              {context.platforms.map((platform) => (
                <option value={platform.id} key={platform.id}>
                  {platform.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            账号
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.currentTarget.value)}
            >
              <option value="">全部账号</option>
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {accountLabel(account, context.platforms)}
                </option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select
              value={state}
              onChange={(event) =>
                setState(event.currentTarget.value as PublicationStatus | "")
              }
            >
              <option value="">全部状态</option>
              {Object.entries(publicationStateLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          class="secondary-button compact-button"
          type="button"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            context.setStatus("正在刷新内容记录…", "busy");
            try {
              await loadPublications();
              context.setStatus("内容记录已刷新");
            } catch (error) {
              context.setStatus(errorMessage(error, "刷新失败"), "error");
            } finally {
              setRefreshing(false);
            }
          }}
        >
          <Icon name="refresh" size={16} />
          {refreshing ? "刷新中" : "刷新"}
        </button>
      </section>

      <section class="data-surface" aria-labelledby="content-list-title">
        <header class="surface-header">
          <div>
            <h2 id="content-list-title">全部内容</h2>
            <p>
              共 {publications.length} 条记录，当前显示 {filtered.length} 条
            </p>
          </div>
        </header>
        <div class="content-list-heading" aria-hidden="true">
          <span>内容</span>
          <span>平台 / 账号</span>
          <span>发布状态</span>
          <span>更新时间</span>
          <span>操作</span>
        </div>
        <div class="content-list" aria-live="polite">
          {loading ? (
            <EmptyContent title="正在加载内容记录…" />
          ) : filtered.length === 0 ? (
            <EmptyContent
              title={
                publications.length === 0
                  ? "还没有发布记录"
                  : "没有符合筛选条件的内容"
              }
              detail={
                publications.length === 0
                  ? "发布的内容会集中出现在这里。"
                  : "调整上方筛选条件后重试。"
              }
            />
          ) : (
            filtered.map((publication) => (
              <PublicationRow
                publication={publication}
                accounts={accounts}
                context={context}
                key={publication.id}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function PublicationRow({
  publication,
  accounts,
  context,
}: {
  publication: PublicationSummary;
  accounts: AppContext["accounts"];
  context: AppContext;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const account = accounts.find(({ id }) => id === publication.accountId);
  const platform = context.platforms.find(
    ({ id }) => id === publication.platformId,
  );

  const runAction = async (action: "copy" | "open") => {
    setBusy(true);
    try {
      if (action === "copy" && publication.platformContentId) {
        await navigator.clipboard.writeText(publication.platformContentId);
        context.setStatus("作品 ID 已复制");
      } else if (action === "open") {
        await window.matrix.openPublication({ publicationId: publication.id });
      }
    } catch (error) {
      context.setStatus(errorMessage(error, "内容操作失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article class={`content-record${expanded ? " expanded" : ""}`}>
      <div class="content-summary-cell">
        <span class="content-type-icon">
          <Icon
            name={publication.contentForm === "video" ? "video" : "image"}
            size={17}
          />
        </span>
        <span>
          <strong>{publication.title?.trim() || "无标题内容"}</strong>
          <small>
            {publication.body.trim() ||
              publication.assets.map(({ name }) => name).join("，") ||
              "暂无正文"}
          </small>
        </span>
      </div>
      <div class="content-account-cell">
        <strong>{platform?.displayName ?? publication.platformId}</strong>
        <small>
          {account
            ? (account.nickname ?? account.displayName)
            : "账号信息不可用"}
        </small>
      </div>
      <div>
        <span class={`status-badge publication-${publication.state}`}>
          <span class="badge-dot" aria-hidden="true" />
          {publicationStateLabels[publication.state]}
        </span>
      </div>
      <div class="content-time-cell">
        <strong>{formatTime(publication.updatedAt)}</strong>
        <small>创建于 {formatTime(publication.createdAt)}</small>
      </div>
      <div class="row-actions">
        {publication.platformContentUrl && (
          <button
            class="secondary-button small-button"
            type="button"
            disabled={busy}
            onClick={() => void runAction("open")}
          >
            打开作品
          </button>
        )}
        <button
          class="icon-button"
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "收起内容详情" : "展开内容详情"}
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name="chevron-down" />
        </button>
      </div>

      {expanded && (
        <div class="content-record-details">
          <div class="content-detail-block">
            <span>最近消息</span>
            <p>{publication.lastMessage ?? "平台未返回附加消息。"}</p>
          </div>
          <div class="content-detail-block">
            <span>平台作品 ID</span>
            <p>{publication.platformContentId ?? "尚未生成"}</p>
            {publication.platformContentId && (
              <button
                class="text-button"
                type="button"
                disabled={busy}
                onClick={() => void runAction("copy")}
              >
                <Icon name="copy" size={14} />
                复制
              </button>
            )}
          </div>
          <div class="content-detail-block transitions-block">
            <span>状态记录</span>
            <ol>
              {publication.transitions.map((transition, index) => (
                <li key={`${transition.occurredAt}:${index}`}>
                  <strong>{publicationStateLabels[transition.to]}</strong>
                  <small>{formatTime(transition.occurredAt)}</small>
                  {transition.reason && <p>{transition.reason}</p>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </article>
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
