export type XiaohongshuPublishContentForm = "video" | "imageText";

export interface XiaohongshuPublishResponse {
  method: string;
  url: string;
  httpStatus: number;
  body: unknown;
}

export type XiaohongshuPublishSignal =
  | { kind: "ignore" }
  | { kind: "accepted"; message: string | null }
  | { kind: "published"; postId: string | null; postUrl: string | null }
  | { kind: "failed"; error: string };

const mutationMethods = new Set(["POST", "PUT", "PATCH"]);
const candidatePath = /(?:publish|submit|create)|\/(?:note|post)(?:\/|$)/i;
const excludedPath = /(?:upload|image|video|media|cover|topic|tag|draft)/i;
const identityKeys = new Set(["note_id", "post_id", "item_id", "feed_id"]);
const codeKeys = new Set(["code", "status_code", "result"]);
const messageKeys = new Set(["message", "msg", "errmsg", "error_message"]);
const successMessagePattern = /(成功|已提交|审核中|success|submitted)/i;
const failureMessagePattern = /(失败|错误|异常|拒绝|fail|error)/i;
const publicUrlPattern =
  /https?:\/\/[^\s"']*xiaohongshu\.com\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)/i;
const identityPattern = /^[A-Za-z0-9_-]{8,}$/;
const genericIdentityPattern = /^[A-Za-z0-9_-]{16,}$/;

function responseBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function entries(value: unknown): Array<{ key: string; value: unknown }> {
  const result: Array<{ key: string; value: unknown }> = [];
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (typeof current !== "object" || current === null) return;
    for (const [key, child] of Object.entries(current)) {
      result.push({ key: key.toLowerCase(), value: child });
      visit(child);
    }
  };
  visit(value);
  return result;
}

function scalarString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function publishPathname(
  response: Pick<XiaohongshuPublishResponse, "method" | "url">,
): string | null {
  const parsed = response.url.match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?/i);
  if (!parsed) return null;
  const hostname = (parsed[1] ?? "").toLowerCase().split(":", 1)[0] ?? "";
  const pathname = parsed[2] ?? "/";
  if (
    hostname !== "xiaohongshu.com" &&
    !hostname.endsWith(".xiaohongshu.com")
  ) {
    return null;
  }
  if (!mutationMethods.has(response.method.toUpperCase())) return null;
  if (!candidatePath.test(pathname) || excludedPath.test(pathname)) return null;
  return pathname;
}

export function isXiaohongshuPublishResponseCandidate(
  response: Pick<XiaohongshuPublishResponse, "method" | "url">,
): boolean {
  return publishPathname(response) !== null;
}

export function classifyXiaohongshuPublishResponse(
  response: XiaohongshuPublishResponse,
  _contentForm: XiaohongshuPublishContentForm,
): XiaohongshuPublishSignal {
  const pathname = publishPathname(response);
  if (!pathname) return { kind: "ignore" };

  const body = responseBody(response.body);
  const bodyEntries = entries(body);
  let success = false;
  let failure = false;
  let message: string | null = null;
  let postId: string | null = null;
  let postUrl: string | null = null;

  for (const entry of bodyEntries) {
    const text = scalarString(entry.value);
    if (entry.key === "success" && typeof entry.value === "boolean") {
      success ||= entry.value;
      failure ||= !entry.value;
    }
    if (codeKeys.has(entry.key) && text && /^-?\d+$/.test(text)) {
      success ||= text === "0" || text === "200";
      failure ||= text !== "0" && text !== "200";
    }
    if (messageKeys.has(entry.key) && text) {
      message ??= text;
      success ||= successMessagePattern.test(text);
      failure ||= failureMessagePattern.test(text);
    }
    if (identityKeys.has(entry.key) && text && identityPattern.test(text)) {
      postId ??= text;
    }
    if (
      entry.key === "id" &&
      text &&
      genericIdentityPattern.test(text) &&
      /\/(?:note|post)(?:\/|$)/i.test(pathname)
    ) {
      postId ??= text;
    }
    if (text) {
      const urlMatch = text.match(publicUrlPattern);
      if (urlMatch) {
        postUrl ??= urlMatch[0];
        postId ??= urlMatch[1] ?? null;
      }
    }
  }

  if (typeof body === "string") {
    const urlMatch = body.match(publicUrlPattern);
    if (urlMatch) {
      postUrl ??= urlMatch[0];
      postId ??= urlMatch[1] ?? null;
    }
  }

  if (postId || postUrl) {
    if (postId && !postUrl) {
      postUrl = `https://www.xiaohongshu.com/explore/${postId}`;
    }
    return { kind: "published", postId, postUrl };
  }
  if (response.httpStatus >= 400 || failure) {
    return {
      kind: "failed",
      error: message ?? `小红书发布接口返回 ${response.httpStatus}`,
    };
  }
  if (success) return { kind: "accepted", message };
  return { kind: "ignore" };
}
