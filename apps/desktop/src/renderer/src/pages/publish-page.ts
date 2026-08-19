import type {
  PublishContentForm,
  PublishResultUpdate,
  SubmissionMode,
} from "@nedia-matrix/ipc-contracts";

import type { AppContext } from "../app-context.js";
import type { PageInstance } from "../router.js";
import {
  accountLabel,
  errorMessage,
  publicationStateLabels,
  requireElement,
} from "../shared.js";

interface MediaSelection {
  id: string;
  accountId: string;
  contentForm: PublishContentForm;
}

export function createPublishPage(context: AppContext): PageInstance {
  let mediaSelection: MediaSelection | undefined;
  let activeObservationId: string | undefined;
  let removePublishListener: (() => void) | undefined;
  let root: HTMLElement | undefined;
  let submissionInFlight = false;

  function contentForm(): PublishContentForm {
    const select = requireElement<HTMLSelectElement>(
      root!,
      "#draft-content-form",
    );
    return select.value === "video" ? "video" : "imageText";
  }

  function draftTags(): string[] {
    return requireElement<HTMLTextAreaElement>(root!, "#draft-tags")
      .value.split(/[,，\n]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  function clearMediaSelection(): void {
    mediaSelection = undefined;
    requireElement<HTMLElement>(root!, "#selected-media").textContent =
      "尚未选择媒体";
  }

  function selectedPublishCapability() {
    const accountId = requireElement<HTMLSelectElement>(
      root!,
      "#draft-account",
    ).value;
    const platformId = context.accounts.find(
      ({ id }) => id === accountId,
    )?.platformId;
    const platform = context.platforms.find(({ id }) => id === platformId);
    return platform?.publishCapabilities.find(
      ({ contentForm: supportedForm }) => supportedForm === contentForm(),
    );
  }

  function synchronizePublishCapabilities(): void {
    const accountId = requireElement<HTMLSelectElement>(
      root!,
      "#draft-account",
    ).value;
    const platformId = context.accounts.find(
      ({ id }) => id === accountId,
    )?.platformId;
    const capabilities =
      context.platforms.find(({ id }) => id === platformId)
        ?.publishCapabilities ?? [];
    const formSelect = requireElement<HTMLSelectElement>(
      root!,
      "#draft-content-form",
    );
    for (const option of formSelect.options) {
      option.disabled = !capabilities.some(
        ({ contentForm: supportedForm }) => supportedForm === option.value,
      );
    }
    if (formSelect.selectedOptions[0]?.disabled) {
      const firstSupported = [...formSelect.options].find(
        (option) => !option.disabled,
      );
      if (firstSupported) formSelect.value = firstSupported.value;
    }

    const submissionSelect = requireElement<HTMLSelectElement>(
      root!,
      "#draft-submission-mode",
    );
    const supportedModes = selectedPublishCapability()?.submissionModes ?? [];
    for (const option of submissionSelect.options) {
      option.disabled = !supportedModes.includes(
        option.value as SubmissionMode,
      );
    }
    if (submissionSelect.selectedOptions[0]?.disabled) {
      const firstSupported = [...submissionSelect.options].find(
        (option) => !option.disabled,
      );
      if (firstSupported) submissionSelect.value = firstSupported.value;
    }
    submissionSelect.disabled = supportedModes.length <= 1;
    synchronizeMediaSelection();
  }

  function synchronizeMediaSelection(): void {
    const button = requireElement<HTMLButtonElement>(root!, "#select-media");
    button.textContent = contentForm() === "video" ? "选择视频" : "选择图片";
    clearMediaSelection();
  }

  function renderAccounts(): void {
    const select = requireElement<HTMLSelectElement>(root!, "#draft-account");
    const previousAccountId = select.value;
    select.replaceChildren(
      ...context.accounts.map((account) => {
        const option = document.createElement("option");
        option.value = account.id;
        option.textContent = accountLabel(account, context.platforms);
        return option;
      }),
    );
    if (context.accounts.some(({ id }) => id === previousAccountId)) {
      select.value = previousAccountId;
    }
    const hasAccounts = context.accounts.length > 0;
    select.disabled = !hasAccounts;
    requireElement<HTMLButtonElement>(root!, "#select-media").disabled =
      !hasAccounts;
    requireElement<HTMLButtonElement>(root!, "#prepare-draft").disabled =
      !hasAccounts;
    requireElement<HTMLElement>(root!, "#no-account-notice").hidden =
      hasAccounts;
  }

  function renderPublishResult(update: PublishResultUpdate): void {
    switch (update.status) {
      case "verification_required":
        context.setStatus(
          `${update.message ?? "平台要求安全验证"}，请在浏览器中完成验证`,
          "error",
        );
        return;
      case "verifying":
        context.setStatus(
          update.message ?? "平台已受理，正在确认作品…",
          "busy",
        );
        return;
      case "published": {
        const identity = update.platformContentId
          ? `，作品 ID：${update.platformContentId}`
          : "";
        context.setStatus(`发布成功${identity}`);
        return;
      }
      case "failed":
        context.setStatus(
          `发布失败：${update.message ?? "平台返回失败"}`,
          "error",
        );
        return;
      case "uncertain":
        context.setStatus(
          update.message ?? "发布结果暂时无法确认，请勿直接重复发布",
          "error",
        );
    }
  }

  async function selectMedia(): Promise<void> {
    const accountId = requireElement<HTMLSelectElement>(
      root!,
      "#draft-account",
    ).value;
    if (!accountId) {
      context.setStatus("请先连接并选择平台账号", "error");
      return;
    }
    const selectedContentForm = contentForm();
    const button = requireElement<HTMLButtonElement>(root!, "#select-media");
    button.disabled = true;
    context.setStatus("正在选择本地媒体…", "busy");
    try {
      const result = await window.matrix.selectPublishMedia({
        accountId,
        contentForm: selectedContentForm,
      });
      if (result.status === "cancelled") {
        context.setStatus("已取消选择媒体");
        return;
      }
      mediaSelection = {
        id: result.selectionId,
        accountId,
        contentForm: selectedContentForm,
      };
      requireElement<HTMLElement>(root!, "#selected-media").textContent =
        result.files
          .map(
            (file) =>
              `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`,
          )
          .join("、");
      context.setStatus(`已选择 ${result.files.length} 个媒体文件`);
    } catch (error) {
      context.setStatus(errorMessage(error, "选择媒体失败"), "error");
    } finally {
      if (button.isConnected) button.disabled = context.accounts.length === 0;
    }
  }

  async function submitDraft(): Promise<void> {
    if (submissionInFlight) return;
    const accountId = requireElement<HTMLSelectElement>(
      root!,
      "#draft-account",
    ).value;
    const selectedContentForm = contentForm();
    if (!accountId) {
      context.setStatus("请先连接并选择平台账号", "error");
      return;
    }
    if (
      !mediaSelection ||
      mediaSelection.accountId !== accountId ||
      mediaSelection.contentForm !== selectedContentForm
    ) {
      context.setStatus("请为当前账号和内容类型重新选择媒体", "error");
      return;
    }

    const submit = requireElement<HTMLButtonElement>(root!, "#prepare-draft");
    submissionInFlight = true;
    submit.disabled = true;
    activeObservationId = undefined;
    context.setStatus(
      "正在打开发布页并填充草稿，媒体处理可能需要数分钟…",
      "busy",
    );
    try {
      const result = await window.matrix.preparePublishDraft({
        accountId,
        contentForm: selectedContentForm,
        mediaSelectionId: mediaSelection.id,
        title: requireElement<HTMLInputElement>(root!, "#draft-title-input")
          .value,
        body: requireElement<HTMLTextAreaElement>(root!, "#draft-body").value,
        tags: draftTags(),
        submissionMode: requireElement<HTMLSelectElement>(
          root!,
          "#draft-submission-mode",
        ).value as SubmissionMode,
      });
      if (result.status === "ready_for_review") {
        clearMediaSelection();
        activeObservationId = result.publishObservationId ?? undefined;
        const pending = activeObservationId
          ? context.recentPublishUpdate(activeObservationId)
          : undefined;
        if (pending) renderPublishResult(pending);
        else context.setStatus("草稿已填充，请检查后在平台页面手动发布");
      } else if (result.status === "submission_started") {
        clearMediaSelection();
        activeObservationId = result.publishObservationId;
        const pending = context.recentPublishUpdate(activeObservationId);
        if (pending) renderPublishResult(pending);
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
        clearMediaSelection();
        const evidence = result.evidenceId ? `，证据 ${result.evidenceId}` : "";
        context.setStatus(
          `${result.code}: ${result.message}${evidence}。请先核实平台结果，不要直接重试`,
          "error",
        );
      } else {
        if (result.code === "MEDIA_SELECTION_UNAVAILABLE") {
          clearMediaSelection();
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
      submissionInFlight = false;
      await context.refreshPublications();
      if (submit.isConnected) submit.disabled = context.accounts.length === 0;
    }
  }

  return {
    async mount(container) {
      root = document.createElement("div");
      root.className = "page-stack";
      root.innerHTML = `
        <section class="panel" aria-labelledby="publish-form-title">
          <div class="section-heading">
            <div>
              <p class="section-label">发布草稿</p>
              <h2 id="publish-form-title">准备并发布内容</h2>
            </div>
            <p>默认自动提交，也可以停在提交前人工确认。媒体路径仅保存在主进程的一次性令牌中。</p>
          </div>
          <p id="no-account-notice" class="inline-notice" hidden>
            还没有可用账号，请先前往“账号管理”连接平台账号。
          </p>
          <form id="draft-form" class="draft-form">
            <label>目标账号<select id="draft-account"></select></label>
            <label>内容类型
              <select id="draft-content-form">
                <option value="imageText">图文</option>
                <option value="video">视频</option>
              </select>
            </label>
            <label>提交方式
              <select id="draft-submission-mode">
                <option value="automatic">自动提交</option>
                <option value="manual_confirmation">人工确认</option>
              </select>
            </label>
            <label class="full-field">标题<input id="draft-title-input" maxlength="200" /></label>
            <label class="full-field">正文<textarea id="draft-body" maxlength="20000" rows="8"></textarea></label>
            <label class="full-field">标签<textarea id="draft-tags" maxlength="1000" rows="2" placeholder="多个标签用逗号或换行分隔，可省略 #"></textarea></label>
            <div class="media-selection full-field">
              <button id="select-media" class="secondary-button" type="button">选择图片</button>
              <p id="selected-media">尚未选择媒体</p>
            </div>
            <button id="prepare-draft" class="full-field" type="submit">开始发布</button>
          </form>
        </section>`;
      container.append(root);
      await context.refreshAccounts();
      renderAccounts();
      synchronizePublishCapabilities();
      requireElement<HTMLSelectElement>(
        root,
        "#draft-account",
      ).addEventListener("change", synchronizePublishCapabilities);
      requireElement<HTMLSelectElement>(
        root,
        "#draft-content-form",
      ).addEventListener("change", synchronizePublishCapabilities);
      requireElement<HTMLButtonElement>(root, "#select-media").addEventListener(
        "click",
        () => void selectMedia(),
      );
      requireElement<HTMLFormElement>(root, "#draft-form").addEventListener(
        "submit",
        (event) => {
          event.preventDefault();
          void submitDraft();
        },
      );
      removePublishListener = context.onPublishUpdate((update) => {
        if (update.observationId === activeObservationId) {
          renderPublishResult(update);
        }
      });
    },
    unmount() {
      removePublishListener?.();
      removePublishListener = undefined;
      root = undefined;
    },
  };
}
