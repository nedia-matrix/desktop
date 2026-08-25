import type {
  PlatformAccountSummary,
  PublishContentForm,
  PublishResultUpdate,
  SubmissionMode,
} from "@nedia-matrix/ipc-contracts";
import { useEffect, useMemo, useState } from "preact/hooks";

import type { AppContext } from "../app-context.js";
import { Icon } from "../components/icons.js";
import {
  accountLabel,
  errorMessage,
  publicationStateLabels,
} from "../shared.js";

interface MediaSelection {
  id: string;
  accountId: string;
  contentForm: PublishContentForm;
  files: readonly { name: string; size: number }[];
}

export function PublishPage({ context }: { context: AppContext }) {
  const [accounts, setAccounts] = useState(context.accounts);
  const [accountId, setAccountId] = useState(context.accounts[0]?.id ?? "");
  const [contentForm, setContentForm] =
    useState<PublishContentForm>("imageText");
  const [submissionMode, setSubmissionMode] =
    useState<SubmissionMode>("automatic");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [mediaSelection, setMediaSelection] = useState<MediaSelection>();
  const [submissionInFlight, setSubmissionInFlight] = useState(false);
  const [activeObservationId, setActiveObservationId] = useState<string>();

  const selectedAccount = accounts.find(({ id }) => id === accountId);
  const platform = context.platforms.find(
    ({ id }) => id === selectedAccount?.platformId,
  );
  const capability = platform?.publishCapabilities.find(
    ({ contentForm: supportedForm }) => supportedForm === contentForm,
  );
  const supportedForms = useMemo(
    () =>
      new Set(
        platform?.publishCapabilities.map(({ contentForm }) => contentForm),
      ),
    [platform],
  );

  useEffect(() => {
    let active = true;
    void context
      .refreshAccounts()
      .then((refreshed) => {
        if (!active) return;
        setAccounts(refreshed);
        setAccountId((current) =>
          refreshed.some(({ id }) => id === current)
            ? current
            : (refreshed[0]?.id ?? ""),
        );
      })
      .catch((error) =>
        context.setStatus(errorMessage(error, "账号加载失败"), "error"),
      );
    const stopUpdates = context.onAccountUpdate((refreshed) => {
      if (!active) return;
      setAccounts(refreshed);
      setAccountId((current) =>
        refreshed.some(({ id }) => id === current)
          ? current
          : (refreshed[0]?.id ?? ""),
      );
    });
    return () => {
      active = false;
      stopUpdates();
    };
  }, [context]);

  useEffect(() => {
    if (supportedForms.has(contentForm)) return;
    const firstSupported = platform?.publishCapabilities[0]?.contentForm;
    if (firstSupported) setContentForm(firstSupported);
  }, [contentForm, platform, supportedForms]);

  useEffect(() => {
    const supportedModes = capability?.submissionModes ?? [];
    if (!supportedModes.includes(submissionMode)) {
      setSubmissionMode(supportedModes[0] ?? "automatic");
    }
  }, [capability, submissionMode]);

  useEffect(() => {
    setMediaSelection(undefined);
  }, [accountId, contentForm]);

  useEffect(
    () =>
      context.onPublishUpdate((update) => {
        if (update.observationId === activeObservationId) {
          renderPublishResult(context, update);
        }
      }),
    [activeObservationId, context],
  );

  const selectMedia = async () => {
    if (!accountId) {
      context.setStatus("请先连接并选择平台账号", "error");
      return;
    }
    context.setStatus("正在选择本地媒体…", "busy");
    try {
      const result = await window.matrix.selectPublishMedia({
        accountId,
        contentForm,
      });
      if (result.status === "cancelled") {
        context.setStatus("已取消选择媒体");
        return;
      }
      setMediaSelection({
        id: result.selectionId,
        accountId,
        contentForm,
        files: result.files,
      });
      context.setStatus(`已选择 ${result.files.length} 个媒体文件`);
    } catch (error) {
      context.setStatus(errorMessage(error, "选择媒体失败"), "error");
    }
  };

  const submitDraft = async (event: SubmitEvent) => {
    event.preventDefault();
    if (submissionInFlight) return;
    if (!accountId) {
      context.setStatus("请先连接并选择平台账号", "error");
      return;
    }
    if (
      !mediaSelection ||
      mediaSelection.accountId !== accountId ||
      mediaSelection.contentForm !== contentForm
    ) {
      context.setStatus("请为当前账号和内容类型选择媒体", "error");
      return;
    }

    setSubmissionInFlight(true);
    setActiveObservationId(undefined);
    context.setStatus(
      "正在打开发布页并填充草稿，媒体处理可能需要数分钟…",
      "busy",
    );
    try {
      const result = await window.matrix.preparePublishDraft({
        accountId,
        contentForm,
        mediaSelectionId: mediaSelection.id,
        title,
        body,
        tags: tags
          .split(/[,，\n]+/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        submissionMode,
      });
      if (result.status === "ready_for_review") {
        setMediaSelection(undefined);
        setActiveObservationId(result.publishObservationId ?? undefined);
        const pending = result.publishObservationId
          ? context.recentPublishUpdate(result.publishObservationId)
          : undefined;
        if (pending) renderPublishResult(context, pending);
        else context.setStatus("草稿已填充，请检查后在平台页面手动发布");
      } else if (result.status === "submission_started") {
        setMediaSelection(undefined);
        setActiveObservationId(result.publishObservationId);
        const pending = context.recentPublishUpdate(
          result.publishObservationId,
        );
        if (pending) renderPublishResult(context, pending);
        else context.setStatus("内容已提交，正在确认平台发布结果…", "busy");
      } else if (result.status === "already_started") {
        context.setStatus(
          `该请求已存在，当前状态：${publicationStateLabels[result.state]}`,
        );
      } else if (result.status === "login_required") {
        context.setStatus("该账号尚未登录，请先完成登录", "error");
      } else if (result.status === "account_busy") {
        context.setStatus(
          "该账号正在执行另一个发布任务，请等待其完成",
          "error",
        );
      } else if (result.status === "account_unknown") {
        context.setStatus(result.reason, "error");
      } else if (result.status === "uncertain") {
        setMediaSelection(undefined);
        const evidence = result.evidenceId ? `，证据 ${result.evidenceId}` : "";
        context.setStatus(
          `${result.code}: ${result.message}${evidence}。请先核实平台结果，不要直接重试`,
          "error",
        );
      } else {
        if (result.code === "MEDIA_SELECTION_UNAVAILABLE") {
          setMediaSelection(undefined);
        }
        const evidence = result.evidenceId ? `，证据 ${result.evidenceId}` : "";
        context.setStatus(
          `${result.code}: ${result.message}${evidence}`,
          "error",
        );
      }
    } catch (error) {
      context.setStatus(errorMessage(error, "填充草稿失败"), "error");
    } finally {
      setSubmissionInFlight(false);
      await context.refreshPublications();
    }
  };

  if (accounts.length === 0) {
    return (
      <section class="empty-workspace">
        <span class="empty-workspace-icon">
          <Icon name="accounts" size={24} />
        </span>
        <h2>先连接一个平台账号</h2>
        <p>发布内容前，需要一个已登录的平台账号和独立 Session。</p>
        <a class="button-link" href="#/accounts">
          前往账号管理
        </a>
      </section>
    );
  }

  return (
    <form
      class="publish-workspace"
      onSubmit={(event) => void submitDraft(event)}
    >
      <section class="editor-surface" aria-labelledby="content-editor-title">
        <header class="surface-header">
          <div>
            <span class="section-kicker">内容</span>
            <h2 id="content-editor-title">编辑发布内容</h2>
          </div>
          <span class="draft-state">草稿未保存</span>
        </header>

        <div class="editor-fields">
          <label class="field-label" for="draft-title-input">
            标题
            <span>{title.length}/200</span>
          </label>
          <input
            id="draft-title-input"
            maxlength={200}
            placeholder="输入一个清晰的内容标题"
            value={title}
            onInput={(event) => setTitle(event.currentTarget.value)}
          />

          <label class="field-label" for="draft-body">
            正文
            <span>{body.length}/20000</span>
          </label>
          <textarea
            id="draft-body"
            maxlength={20000}
            rows={12}
            placeholder="写下要发布的正文内容…"
            value={body}
            onInput={(event) => setBody(event.currentTarget.value)}
          />

          <label class="field-label" for="draft-tags">
            标签
            <span>用逗号或换行分隔</span>
          </label>
          <textarea
            id="draft-tags"
            class="tags-input"
            maxlength={1000}
            rows={2}
            placeholder="例如：内容创作，效率工具"
            value={tags}
            onInput={(event) => setTags(event.currentTarget.value)}
          />
        </div>
      </section>

      <aside class="publish-inspector" aria-label="发布配置">
        <InspectorSection title="发布目标">
          <label>
            目标账号
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.currentTarget.value)}
            >
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {accountLabel(account, context.platforms)}
                </option>
              ))}
            </select>
          </label>
          <div class="segmented-control" aria-label="内容类型">
            <button
              class={contentForm === "imageText" ? "active" : undefined}
              type="button"
              disabled={!supportedForms.has("imageText")}
              onClick={() => setContentForm("imageText")}
            >
              <Icon name="image" size={16} />
              图文
            </button>
            <button
              class={contentForm === "video" ? "active" : undefined}
              type="button"
              disabled={!supportedForms.has("video")}
              onClick={() => setContentForm("video")}
            >
              <Icon name="video" size={16} />
              视频
            </button>
          </div>
        </InspectorSection>

        <InspectorSection title="媒体">
          <button
            class="media-dropzone"
            type="button"
            onClick={() => void selectMedia()}
          >
            <span class="media-dropzone-icon">
              <Icon
                name={contentForm === "video" ? "video" : "image"}
                size={20}
              />
            </span>
            {mediaSelection ? (
              <span>
                <strong>{mediaSelection.files.length} 个文件已选择</strong>
                <small>
                  {mediaSelection.files
                    .map(
                      (file) => `${file.name} · ${formatFileSize(file.size)}`,
                    )
                    .join("，")}
                </small>
              </span>
            ) : (
              <span>
                <strong>
                  {contentForm === "video" ? "选择一个视频" : "选择图片"}
                </strong>
                <small>从本地文件中选择</small>
              </span>
            )}
          </button>
        </InspectorSection>

        <InspectorSection title="提交方式">
          <label class="radio-option">
            <input
              type="radio"
              name="submission-mode"
              value="automatic"
              checked={submissionMode === "automatic"}
              disabled={!capability?.submissionModes.includes("automatic")}
              onChange={() => setSubmissionMode("automatic")}
            />
            <span>
              <strong>自动提交</strong>
              <small>填充完成后直接提交到平台</small>
            </span>
          </label>
          <label class="radio-option">
            <input
              type="radio"
              name="submission-mode"
              value="manual_confirmation"
              checked={submissionMode === "manual_confirmation"}
              disabled={
                !capability?.submissionModes.includes("manual_confirmation")
              }
              onChange={() => setSubmissionMode("manual_confirmation")}
            />
            <span>
              <strong>人工确认</strong>
              <small>停在发布页，检查后手动提交</small>
            </span>
          </label>
        </InspectorSection>

        <div class="publish-action-area">
          <p>
            将发布到 <strong>{platform?.displayName ?? "所选平台"}</strong>
          </p>
          <button
            class="primary-action"
            type="submit"
            disabled={submissionInFlight}
          >
            <Icon name="publish" size={17} />
            {submissionInFlight ? "正在准备…" : "开始发布"}
          </button>
        </div>
      </aside>
    </form>
  );
}

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: preact.ComponentChildren;
}) {
  return (
    <section class="inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function renderPublishResult(
  context: AppContext,
  update: PublishResultUpdate,
): void {
  if (update.status === "verification_required") {
    context.setStatus(
      `${update.message ?? "平台要求安全验证"}，请在浏览器中完成验证`,
      "error",
    );
  } else if (update.status === "verifying") {
    context.setStatus(update.message ?? "平台已受理，正在确认作品…", "busy");
  } else if (update.status === "published") {
    const identity = update.platformContentId
      ? `，作品 ID：${update.platformContentId}`
      : "";
    context.setStatus(`发布成功${identity}`);
  } else if (update.status === "failed") {
    context.setStatus(`发布失败：${update.message ?? "平台返回失败"}`, "error");
  } else {
    context.setStatus(
      update.message ?? "发布结果暂时无法确认，请勿直接重复发布",
      "error",
    );
  }
}

function formatFileSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
