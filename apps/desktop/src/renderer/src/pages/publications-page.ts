import type {
  PublicationStatus,
  PublicationSummary,
} from "@nedia-matrix/ipc-contracts";

import type { AppContext } from "../app-context.js";
import type { PageInstance } from "../router.js";
import {
  accountLabel,
  errorMessage,
  formatTime,
  publicationStateLabels,
  requireElement,
} from "../shared.js";

export function createPublicationsPage(context: AppContext): PageInstance {
  let root: HTMLElement | undefined;
  let mounted = false;
  let removePublishListener: (() => void) | undefined;

  async function loadPublications(): Promise<void> {
    await Promise.all([
      context.refreshAccounts(),
      context.refreshPublications(),
    ]);
    if (!mounted) return;
    renderFilterOptions();
    renderPublications();
  }

  function renderFilterOptions(): void {
    const accountFilter = requireElement<HTMLSelectElement>(
      root!,
      "#history-account",
    );
    const platformFilter = requireElement<HTMLSelectElement>(
      root!,
      "#history-platform",
    );
    const selectedAccount = accountFilter.value;
    const selectedPlatform = platformFilter.value;

    accountFilter.replaceChildren(option("", "全部账号"));
    for (const account of context.accounts) {
      accountFilter.append(
        option(account.id, accountLabel(account, context.platforms)),
      );
    }
    platformFilter.replaceChildren(option("", "全部平台"));
    for (const platform of context.platforms) {
      platformFilter.append(option(platform.id, platform.displayName));
    }
    accountFilter.value = selectedAccount;
    platformFilter.value = selectedPlatform;
  }

  function renderPublications(): void {
    const list = requireElement<HTMLElement>(root!, "#publication-list");
    const accountId = requireElement<HTMLSelectElement>(
      root!,
      "#history-account",
    ).value;
    const platformId = requireElement<HTMLSelectElement>(
      root!,
      "#history-platform",
    ).value;
    const state = requireElement<HTMLSelectElement>(
      root!,
      "#history-state",
    ).value;
    const filtered = context.publications.filter(
      (publication) =>
        (!accountId || publication.accountId === accountId) &&
        (!platformId || publication.platformId === platformId) &&
        (!state || publication.state === state),
    );

    list.replaceChildren();
    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent =
        context.publications.length === 0
          ? "尚无发布记录。"
          : "没有符合当前筛选条件的发布记录。";
      list.append(empty);
      return;
    }
    for (const publication of filtered) {
      list.append(createPublicationCard(publication));
    }
  }

  function createPublicationCard(publication: PublicationSummary): HTMLElement {
    const article = document.createElement("article");
    article.className = "publication-record";
    const header = document.createElement("header");
    const heading = document.createElement("h3");
    heading.textContent = publication.title?.trim() || "无标题内容";
    const state = document.createElement("span");
    state.className = `status-badge publication-${publication.state}`;
    state.textContent = publicationStateLabels[publication.state];
    header.append(heading, state);

    const account = context.accounts.find(
      ({ id }) => id === publication.accountId,
    );
    const metadata = document.createElement("p");
    metadata.className = "record-metadata";
    metadata.textContent = `${account ? accountLabel(account, context.platforms) : publication.platformId} · ${publication.contentForm === "video" ? "视频" : "图文"} · ${formatTime(publication.createdAt)} · 规则 ${publication.rulesVersion}`;
    article.append(header, metadata);

    if (publication.lastMessage) {
      const message = document.createElement("p");
      message.className = "record-message";
      message.textContent = publication.lastMessage;
      article.append(message);
    }

    const actions = document.createElement("div");
    actions.className = "button-row compact-row";
    if (publication.platformContentId) {
      actions.append(
        smallButton("复制作品 ID", async () => {
          await navigator.clipboard.writeText(publication.platformContentId!);
          context.setStatus("作品 ID 已复制");
        }),
      );
    }
    if (publication.platformContentUrl) {
      actions.append(
        smallButton("打开作品", async () => {
          await window.matrix.openPublication({
            publicationId: publication.id,
          });
        }),
      );
    }
    if (actions.childElementCount > 0) article.append(actions);

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `查看 ${publication.transitions.length} 次状态转换`;
    const transitions = document.createElement("ol");
    transitions.className = "publication-transitions";
    for (const transition of publication.transitions) {
      const item = document.createElement("li");
      const reason = transition.reason ? `：${transition.reason}` : "";
      item.textContent = `${formatTime(transition.occurredAt)} · ${publicationStateLabels[transition.to]}${reason}`;
      transitions.append(item);
    }
    details.append(summary, transitions);
    article.append(details);
    return article;
  }

  function smallButton(
    label: string,
    action: () => Promise<void>,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button small-button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await action();
      } catch (error) {
        context.setStatus(errorMessage(error, `${label}失败`), "error");
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  return {
    async mount(container) {
      mounted = true;
      root = document.createElement("div");
      root.className = "page-stack";
      root.innerHTML = `
        <section class="panel" aria-labelledby="history-title">
          <div class="section-heading">
            <div>
              <p class="section-label">本地档案</p>
              <h2 id="history-title">持久化发布历史</h2>
            </div>
            <p>记录内容修订、平台规则版本和每次状态转换。</p>
          </div>
          <div class="filter-bar" aria-label="发布历史筛选">
            <label>平台<select id="history-platform"><option value="">全部平台</option></select></label>
            <label>账号<select id="history-account"><option value="">全部账号</option></select></label>
            <label>状态<select id="history-state"><option value="">全部状态</option></select></label>
          </div>
          <div id="publication-list" class="publication-list" aria-live="polite">
            <p class="empty-state">正在加载发布记录…</p>
          </div>
        </section>`;
      container.append(root);
      const stateFilter = requireElement<HTMLSelectElement>(
        root,
        "#history-state",
      );
      for (const [value, label] of Object.entries(publicationStateLabels)) {
        stateFilter.append(option(value as PublicationStatus, label));
      }
      for (const select of root.querySelectorAll<HTMLSelectElement>(
        ".filter-bar select",
      )) {
        select.addEventListener("change", renderPublications);
      }
      removePublishListener = context.onPublishUpdate(() => {
        void loadPublications();
      });
      await loadPublications();
    },
    unmount() {
      mounted = false;
      removePublishListener?.();
      removePublishListener = undefined;
      root = undefined;
    },
  };
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}
