import {
  defineAutomationPage,
  defineSessionDetectionPlan,
  defineWorkflow,
} from "@nedia-matrix/automation-engine";
import { definePlatformModule } from "@nedia-matrix/platform-core";

import { createXiaohongshuPublishResultMonitor } from "./result-monitor.js";

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
        { kind: "css", selector: 'button[class*="login"]' },
        { kind: "css", selector: '[class*="login-container"]' },
      ],
    },
    "session.nickname": {
      candidates: [
        { kind: "css", selector: '[class*="user-name"]' },
        { kind: "css", selector: '[class*="nickname"]' },
        { kind: "css", selector: '[class*="user-info"] [class*="name"]' },
        { kind: "css", selector: '[class*="name-box"]' },
      ],
    },
    "session.accountId": {
      candidates: [
        { kind: "css", selector: "[data-user-id]" },
        { kind: "css", selector: "[data-userid]" },
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
    "publish.editor.title": {
      candidates: [
        { kind: "css", selector: 'input[placeholder*="标题"]' },
        { kind: "css", selector: 'textarea[placeholder*="标题"]' },
      ],
      conditions: ["attached", "visible", "enabled", "editable"],
    },
    "publish.editor.body": {
      candidates: [
        {
          kind: "css",
          selector: '[contenteditable="true"][data-placeholder*="正文"]',
        },
        { kind: "css", selector: 'textarea[placeholder*="正文"]' },
        { kind: "css", selector: '[contenteditable="true"]' },
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
        leadingKey: "Enter",
        commitKey: "Enter",
        betweenText: " ",
        typingDelayMs: 100,
        suggestionWaitMs: 1_500,
        settleWaitMs: 500,
      },
    ],
  });
}

const prepareVideo = prepareWorkflow(
  "publish.prepare.video",
  "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video",
  "videoInputReady",
  "publish.media.videoInput",
);
const prepareImageText = prepareWorkflow(
  "publish.prepare.imageText",
  "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image",
  "imageInputReady",
  "publish.media.imageInput",
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
        url: "https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info",
      },
      fields: {
        externalAccountId: ["data", "red_num"],
        nickname: ["data", "name"],
        avatarUrl: ["data", "avatar"],
      },
      accountInfo: [
        {
          key: "desc",
          valuePath: ["data", "personal_desc"],
          valueType: "string",
        },
        {
          key: "follower_count",
          valuePath: ["data", "fans_count"],
          valueType: "number",
        },
        {
          key: "like_count",
          valuePath: ["data", "faved_count"],
          valueType: "number",
        },
      ],
    },
    {
      source: {
        kind: "request",
        url: "https://creator.xiaohongshu.com/api/galaxy/user/info",
      },
      fields: {
        externalAccountId: ["data", "userId"],
        nickname: ["data", "userName"],
        avatarUrl: ["data", "userAvatar"],
      },
    },
  ],
  domFallback: {
    page: homePage,
    loggedOutTargetId: "session.loggedOut",
    nicknameTargetId: "session.nickname",
    accountIdTargetId: "session.accountId",
    accountIdAttributes: ["data-user-id", "data-userid"],
  },
});

export const xiaohongshuPlatformModule = definePlatformModule({
  id: "xiaohongshu",
  displayName: "小红书",
  rulesVersion: "1.0.0-capabilities",
  browser: {
    startUrl: "https://creator.xiaohongshu.com/new/home",
    allowedHostSuffixes: ["xiaohongshu.com"],
  },
  accounts: {
    implementationStatus: "live-tested",
    loginEntries: [
      {
        id: "default",
        displayName: "登录小红书创作中心",
        url: "https://creator.xiaohongshu.com/new/home",
      },
    ],
    detection: sessionDetection,
  },
  publishing: {
    implementationStatus: "live-tested",
    forms: {
      video: {
        constraints: {},
        tagPolicy: { placement: "new-lines" },
        submissionModes: ["automatic", "manual_confirmation"],
        automation: { prepare: prepareVideo, submit },
      },
      imageText: {
        constraints: {},
        tagPolicy: { placement: "new-lines" },
        submissionModes: ["automatic", "manual_confirmation"],
        automation: { prepare: prepareImageText, submit },
      },
    },
    createResultMonitor: createXiaohongshuPublishResultMonitor,
  },
});
