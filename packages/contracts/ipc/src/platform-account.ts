export type PlatformAccountStatus =
  "authenticated" | "login_required" | "unknown";

export type PlatformAccountLifecycle = "pending_identity" | "active";

export const platformAccountInfoKeys = [
  "desc",
  "follower_count",
  "content_count",
  "like_count",
] as const;
export type PlatformAccountInfoKey = (typeof platformAccountInfoKeys)[number];

export interface PlatformAccountInfoItem {
  key: PlatformAccountInfoKey;
  value: string | number;
}

export interface PlatformAccountSummary {
  id: string;
  platformId: string;
  profileId: string;
  lifecycle: PlatformAccountLifecycle;
  displayName: string;
  identityScheme: string | null;
  externalAccountId: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  accountInfo?: PlatformAccountInfoItem[];
  status: PlatformAccountStatus;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlatformAccountRequest {
  platformId: string;
}

export interface OpenPlatformLoginRequest {
  accountId: string;
  loginEntryId: string;
}

export interface OpenPlatformLoginResult {
  profileId: string;
}

export interface PlatformAccountRequest {
  accountId: string;
}

export interface OpenPlatformAccountResult {
  sessionId: string;
  profileId: string;
}

export type DetectPlatformSessionResult =
  | {
      status: "authenticated";
      identityScheme: string;
      externalAccountId: string;
      nickname: string;
      avatarUrl: string | null;
      accountInfo: PlatformAccountInfoItem[];
      source: "api" | "dom";
    }
  | { status: "login_required"; source: "api" | "dom" }
  | { status: "unknown"; reason: string };
