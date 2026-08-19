import {
  defineAutomationPage,
  defineSessionDetectionPlan,
  defineWorkflow,
} from "@nedia-matrix/automation-engine";
import { definePlatformModule } from "@nedia-matrix/platform-core";

import { createKuaishouPublishResultMonitor } from "./result-monitor.js";

const profilePage = defineAutomationPage({
  id: "profile",
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
        { kind: "css", selector: '[class*="login"]' },
        { kind: "css", selector: '[class*="qrcode"]' },
      ],
      expectedCount: "one-or-more",
    },
    "session.nickname": {
      candidates: [{ kind: "css", selector: '[class*="user-info-name"]' }],
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
    videoPreviewReady: {
      kind: "target",
      targetId: "publish.media.videoPreview",
      state: "visible",
    },
    editorReady: {
      kind: "target",
      targetId: "publish.editor.description",
      state: "editable",
    },
    submitReady: {
      kind: "target",
      targetId: "publish.submit",
      state: "enabled",
    },
  },
  targets: {
    "publish.media.videoInput": {
      candidates: [
        { kind: "css", selector: 'input[type="file"][accept*="video"]' },
      ],
      conditions: ["attached", "enabled"],
    },
    "publish.media.videoPreview": {
      candidates: [
        {
          kind: "css",
          selector: 'video[src^="blob:https://cp.kuaishou.com/"]',
        },
        {
          kind: "css",
          selector: '[class*="_video_"][src^="blob:https://cp.kuaishou.com/"]',
        },
      ],
      expectedCount: "one-or-more",
    },
    "publish.media.imageInput": {
      candidates: [
        { kind: "css", selector: 'input[type="file"][accept*="image"]' },
      ],
      conditions: ["attached", "enabled"],
    },
    "publish.media.imageDropZone": {
      candidates: [{ kind: "css", selector: '[class*="dragger-container"]' }],
    },
    "publish.media.imagePreview": {
      candidates: [
        {
          kind: "css",
          selector: 'img[src^="blob:https://cp.kuaishou.com/"]',
        },
        {
          kind: "css",
          selector:
            '[class*="_preview_"] img, [class*="_upload_"] img, [class*="_image-list_"] img, [class*="_image-item_"] img',
        },
      ],
      expectedCount: "one-or-more",
    },
    "publish.editor.description": {
      candidates: [
        {
          kind: "css",
          selector:
            '#work-description-edit[contenteditable="true"], #work-description-edit [contenteditable="true"]',
        },
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
        {
          kind: "css",
          selector:
            'div[class*="_button_"][class*="_button-primary_"]:not([class*="_disabled_"]):not([aria-disabled="true"])',
        },
      ],
      conditions: ["attached", "visible", "enabled"],
    },
  },
});

const prepareVideo = defineWorkflow({
  id: "publish.prepare.video",
  page: publishPage,
  startUrl: "https://cp.kuaishou.com/article/publish/video?tabType=1",
  steps: [
    { kind: "wait-for-state", stateId: "videoInputReady", timeoutMs: 30_000 },
    {
      kind: "upload",
      targetId: "publish.media.videoInput",
      inputKey: "mediaPaths",
    },
    {
      kind: "wait-for-state",
      stateId: "videoPreviewReady",
      timeoutMs: 1_800_000,
    },
    { kind: "wait-for-state", stateId: "editorReady", timeoutMs: 60_000 },
    {
      kind: "fill",
      targetId: "publish.editor.description",
      inputKey: "description",
    },
    { kind: "wait-for-state", stateId: "submitReady", timeoutMs: 60_000 },
  ],
});
const prepareImageText = defineWorkflow({
  id: "publish.prepare.imageText",
  page: publishPage,
  startUrl: "https://cp.kuaishou.com/article/publish/video?tabType=2",
  steps: [
    { kind: "wait-for-state", stateId: "imageInputReady", timeoutMs: 30_000 },
    {
      kind: "drop-files",
      targetId: "publish.media.imageDropZone",
      inputKey: "mediaPaths",
    },
    {
      kind: "wait-for-target-count",
      targetId: "publish.media.imagePreview",
      inputKey: "mediaPaths",
      timeoutMs: 1_800_000,
    },
    { kind: "wait-for-state", stateId: "editorReady", timeoutMs: 60_000 },
    {
      kind: "fill",
      targetId: "publish.editor.description",
      inputKey: "description",
    },
    { kind: "wait-for-state", stateId: "submitReady", timeoutMs: 60_000 },
  ],
});
const submit = defineWorkflow({
  id: "publish.submit",
  page: publishPage,
  steps: [{ kind: "click", targetId: "publish.submit" }],
});

const sessionDetection = defineSessionDetectionPlan({
  probes: [
    {
      source: {
        kind: "observed-response",
        method: "POST",
        url: "https://cp.kuaishou.com/rest/cp/creator/pc/home/userInfo",
        timeoutMs: 1_500,
      },
      fields: {
        externalAccountId: ["data", "coreUserInfo", "userId"],
        nickname: ["data", "coreUserInfo", "userName"],
        avatarUrl: ["data", "coreUserInfo", "headUrl"],
      },
      accountInfo: [
        {
          key: "follower_count",
          valuePath: ["data", "coreUserInfo", "fansNum"],
          valueType: "number",
        },
      ],
    },
    {
      source: {
        kind: "observed-response",
        method: "POST",
        url: "https://cp.kuaishou.com/rest/v2/creator/pc/authority/account/current",
        timeoutMs: 1_500,
      },
      fields: {
        externalAccountId: ["data", "userId"],
        nickname: ["data", "userName"],
        avatarUrl: ["data", "userAvatar"],
      },
    },
  ],
  domFallback: {
    page: profilePage,
    loggedOutTargetId: "session.loggedOut",
    nicknameTargetId: "session.nickname",
    accountIdTargetId: "session.accountId",
    accountIdAttributes: ["data-user-id", "data-uid"],
  },
});

export const kuaishouPlatformModule = definePlatformModule({
  id: "kuaishou",
  displayName: "快手",
  rulesVersion: "1.2.1-work-id-priority",
  browser: {
    startUrl: "https://cp.kuaishou.com/profile",
    allowedHostSuffixes: ["kuaishou.com"],
  },
  accounts: {
    implementationStatus: "live-tested",
    loginEntries: [
      {
        id: "default",
        displayName: "登录快手创作服务平台",
        url: "https://cp.kuaishou.com/profile",
      },
    ],
    detection: sessionDetection,
  },
  publishing: {
    implementationStatus: "live-tested",
    forms: {
      video: {
        constraints: { mediaMaxCount: 1 },
        tagPolicy: { placement: "inline" },
        submissionModes: ["automatic", "manual_confirmation"],
        descriptionComposition: { parts: ["title", "body"], separator: " " },
        automation: { prepare: prepareVideo, submit },
      },
      imageText: {
        constraints: { mediaMaxCount: 18 },
        tagPolicy: { placement: "inline" },
        submissionModes: ["automatic", "manual_confirmation"],
        descriptionComposition: { parts: ["title", "body"], separator: " " },
        automation: {
          prepare: prepareImageText,
          submit,
        },
      },
    },
    createResultMonitor: createKuaishouPublishResultMonitor,
  },
});
