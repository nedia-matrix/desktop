import {
  defineAutomationPage,
  defineSessionDetectionPlan,
  defineWorkflow,
} from "@nedia-matrix/automation-engine";
import { definePlatformModule } from "@nedia-matrix/platform-core";

import { createDouyinPublishResultMonitor } from "./result-monitor.js";

const homePage = defineAutomationPage({
  id: "home",
  states: {
    loggedOut: {
      kind: "target",
      targetId: "session.loggedOut",
      state: "visible",
    },
  },
  targets: {
    "session.loggedOut": {
      candidates: [
        { kind: "css", selector: '[class*="login-container"]' },
        { kind: "css", selector: '[class*="login-card"]' },
      ],
    },
    "session.nickname": {
      candidates: [
        { kind: "css", selector: '[class*="user-name"]' },
        { kind: "css", selector: '[class*="nickname"]' },
        { kind: "css", selector: '[class*="account-name"]' },
      ],
    },
    "session.accountId": {
      candidates: [
        { kind: "css", selector: "[data-user-id]" },
        { kind: "css", selector: "[data-uid]" },
      ],
      conditions: ["attached"],
    },
  },
});

const publishPage = defineAutomationPage({
  id: "publish",
  states: {
    videoInputReady: {
      kind: "target",
      targetId: "publish.media.videoInput",
      state: "attached",
    },
    imageInputReady: {
      kind: "target",
      targetId: "publish.media.imageInput",
      state: "attached",
    },
    videoUploaded: {
      kind: "target",
      targetId: "publish.media.videoPreview",
      state: "visible",
    },
    imageUploaded: {
      kind: "target",
      targetId: "publish.media.imagePreview",
      state: "visible",
    },
    editorReady: {
      kind: "target",
      targetId: "publish.editor.body",
      state: "editable",
    },
  },
  targets: {
    "publish.media.videoInput": {
      candidates: [
        { kind: "css", selector: 'input[type="file"][accept*="video"]' },
        { kind: "css", selector: 'input[type="file"]' },
      ],
      conditions: ["attached", "enabled"],
    },
    "publish.media.imageInput": {
      candidates: [
        { kind: "css", selector: 'input[type="file"][accept*="image"]' },
        { kind: "css", selector: 'input[type="file"]' },
      ],
      conditions: ["attached", "enabled"],
    },
    "publish.media.videoPreview": {
      candidates: [
        { kind: "css", selector: '[class*="preview-card-"]' },
        { kind: "css", selector: '[class*="video-preview"]' },
      ],
      expectedCount: "one-or-more",
    },
    "publish.media.imagePreview": {
      candidates: [
        { kind: "css", selector: '[class*="avater-class-"]' },
        { kind: "css", selector: '[class*="image-preview"]' },
        { kind: "css", selector: '[class*="preview-item"]' },
      ],
      expectedCount: "one-or-more",
    },
    "publish.editor.title": {
      candidates: [
        { kind: "css", selector: 'input[placeholder*="标题"]' },
        { kind: "css", selector: 'textarea[placeholder*="标题"]' },
        { kind: "css", selector: ".semi-input-default" },
      ],
      conditions: ["attached", "visible", "enabled", "editable"],
    },
    "publish.editor.body": {
      candidates: [
        { kind: "css", selector: '.zone-container[contenteditable="true"]' },
        { kind: "css", selector: '.zone-container [contenteditable="true"]' },
      ],
      conditions: ["attached", "visible", "enabled", "editable"],
    },
    "publish.submit": {
      candidates: [
        {
          kind: "aria",
          role: "button",
          name: { value: "发布", exact: true },
        },
        { kind: "text", text: { value: "发布", exact: true } },
      ],
      conditions: ["attached", "visible", "enabled"],
    },
  },
});

function prepareWorkflow(
  id: string,
  startUrl: string,
  inputState: "videoInputReady" | "imageInputReady",
  inputTarget: "publish.media.videoInput" | "publish.media.imageInput",
  uploadedState: "videoUploaded" | "imageUploaded",
) {
  return defineWorkflow({
    id,
    page: publishPage,
    startUrl,
    steps: [
      { kind: "wait-for-state", stateId: inputState, timeoutMs: 30_000 },
      { kind: "upload", targetId: inputTarget, inputKey: "mediaPaths" },
      {
        kind: "wait-for-state",
        stateId: uploadedState,
        timeoutMs: 600_000,
      },
      {
        kind: "wait-for-state",
        stateId: "editorReady",
        timeoutMs: 600_000,
      },
      {
        kind: "fill",
        targetId: "publish.editor.title",
        inputKey: "title",
      },
      {
        kind: "fill",
        targetId: "publish.editor.body",
        inputKey: "body",
      },
      {
        kind: "append-tags",
        targetId: "publish.editor.body",
        inputKey: "tags",
        bodyInputKey: "body",
        leadingKey: "Space",
        commitKey: "Space",
        typingDelayMs: 50,
        settleWaitMs: 100,
      },
    ],
  });
}

const prepareVideo = prepareWorkflow(
  "publish.prepare.video",
  "https://creator.douyin.com/creator-micro/content/upload?default-tab=1",
  "videoInputReady",
  "publish.media.videoInput",
  "videoUploaded",
);
const prepareImageText = prepareWorkflow(
  "publish.prepare.imageText",
  "https://creator.douyin.com/creator-micro/content/upload?default-tab=3",
  "imageInputReady",
  "publish.media.imageInput",
  "imageUploaded",
);
const submit = defineWorkflow({
  id: "publish.submit",
  page: publishPage,
  steps: [{ kind: "click", targetId: "publish.submit" }],
});

const sessionDetection = defineSessionDetectionPlan({
  probes: [
    {
      source: {
        kind: "request",
        url: "https://creator.douyin.com/web/api/media/user/info/",
      },
      fields: {
        externalAccountId: ["user", "short_id"],
        nickname: ["user", "nickname"],
        avatarUrl: ["user", "avatar_thumb", "url_list", 0],
      },
      accountInfo: [
        { key: "desc", valuePath: ["user", "signature"], valueType: "string" },
        {
          key: "follower_count",
          valuePath: ["user", "follower_count"],
          valueType: "number",
        },
        {
          key: "like_count",
          valuePath: ["user", "total_favorited"],
          valueType: "number",
        },
      ],
    },
  ],
  domFallback: {
    page: homePage,
    loggedOutTargetId: "session.loggedOut",
    nicknameTargetId: "session.nickname",
    accountIdTargetId: "session.accountId",
    accountIdAttributes: ["data-user-id", "data-uid"],
  },
});

export const douyinPlatformModule = definePlatformModule({
  id: "douyin",
  displayName: "抖音",
  rulesVersion: "1.0.0-capabilities",
  browser: {
    startUrl: "https://creator.douyin.com/creator-micro/home",
    allowedHostSuffixes: ["douyin.com"],
  },
  accounts: {
    implementationStatus: "live-tested",
    loginEntries: [
      {
        id: "default",
        displayName: "登录抖音创作中心",
        url: "https://creator.douyin.com/creator-micro/home",
      },
    ],
    detection: sessionDetection,
  },
  publishing: {
    implementationStatus: "live-tested",
    forms: {
      video: {
        constraints: {
          titleMaxLength: 30,
          bodyMaxLength: 1_000,
          mediaMaxCount: 1,
        },
        tagPolicy: { placement: "inline", maxCount: 5 },
        submissionModes: ["automatic", "manual_confirmation"],
        automation: { prepare: prepareVideo, submit },
      },
      imageText: {
        constraints: {
          titleMaxLength: 30,
          bodyMaxLength: 1_000,
          mediaMaxCount: 35,
        },
        tagPolicy: { placement: "inline", maxCount: 5 },
        submissionModes: ["automatic", "manual_confirmation"],
        automation: { prepare: prepareImageText, submit },
      },
    },
    createResultMonitor: createDouyinPublishResultMonitor,
  },
});
