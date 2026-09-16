export const platformAccountInfoKeys = [
  "desc",
  "follower_count",
  "following_count",
  "content_count",
  "like_count",
] as const;

export type PlatformAccountInfoKey = (typeof platformAccountInfoKeys)[number];

export interface PlatformAccountInfoItem {
  readonly key: PlatformAccountInfoKey;
  readonly value: string | number;
}
