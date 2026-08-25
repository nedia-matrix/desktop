import bilibiliIconUrl from "../../../../resources/platform-icons/bilibili.svg";
import douyinIconUrl from "../../../../resources/platform-icons/douyin.svg";
import kuaishouIconUrl from "../../../../resources/platform-icons/kuaishou.svg";
import toutiaoIconUrl from "../../../../resources/platform-icons/toutiao.svg";
import wechatChannelsIconUrl from "../../../../resources/platform-icons/wechat-channels.svg";
import weiboIconUrl from "../../../../resources/platform-icons/weibo.svg";
import xiaohongshuIconUrl from "../../../../resources/platform-icons/xiaohongshu.svg";

const platformIconUrls: Readonly<Record<string, string>> = {
  bilibili: bilibiliIconUrl,
  douyin: douyinIconUrl,
  kuaishou: kuaishouIconUrl,
  toutiao: toutiaoIconUrl,
  "wechat-channels": wechatChannelsIconUrl,
  weibo: weiboIconUrl,
  xiaohongshu: xiaohongshuIconUrl,
};

export function PlatformIcon({
  platformId,
  platformName,
  compact = false,
}: {
  platformId: string;
  platformName: string;
  compact?: boolean;
}) {
  const iconUrl = platformIconUrls[platformId];
  const className = compact ? "platform-mini-logo" : "platform-logo";

  return (
    <span class={className} aria-hidden="true">
      {iconUrl ? (
        <img src={iconUrl} alt="" />
      ) : (
        (Array.from(platformName.trim())[0] ?? "平")
      )}
    </span>
  );
}
