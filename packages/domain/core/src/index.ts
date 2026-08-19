export type PlatformId = string;
export type AccountId = string;
export type BrowserSessionId = string;
export type ContentItemId = string;
export type ContentRevisionId = string;
export type PublicationId = string;

export interface AccountIdentity {
  accountId: AccountId;
  platformId: PlatformId;
  platformAccountId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface AccountSessionBinding {
  accountId: AccountId;
  sessionId: BrowserSessionId;
  lastVerifiedAt?: string;
  status: "saved" | "authenticated" | "expired" | "unknown";
}

export interface ContentRevision {
  id: ContentRevisionId;
  contentItemId: ContentItemId;
  revision: number;
  title?: string;
  body: string;
  assetIds: readonly string[];
  createdAt: string;
}

export function createContentRevision(
  revision: ContentRevision,
): Readonly<ContentRevision> {
  if (revision.revision < 1 || !Number.isInteger(revision.revision)) {
    throw new RangeError("Content revision number must be a positive integer");
  }

  if (
    revision.body.trim().length === 0 &&
    (revision.title?.trim().length ?? 0) === 0 &&
    revision.assetIds.length === 0
  ) {
    throw new TypeError("Content revision cannot be empty");
  }

  return Object.freeze({
    ...revision,
    assetIds: Object.freeze([...revision.assetIds]),
  });
}

export const publicationStates = [
  "draft",
  "validated",
  "scheduled",
  "preparing",
  "awaiting_confirmation",
  "submitting",
  "verifying",
  "published",
  "uncertain",
  "failed",
  "retrying",
  "rejected",
  "cancelled",
] as const;

export type PublicationState = (typeof publicationStates)[number];

export interface PublicationTransition {
  from: PublicationState;
  to: PublicationState;
  occurredAt: string;
  reason?: string;
}

export interface Publication {
  id: PublicationId;
  platformId: PlatformId;
  accountId: AccountId;
  contentRevisionId: ContentRevisionId;
  state: PublicationState;
  transitions: readonly PublicationTransition[];
  platformContentId?: string;
  platformContentUrl?: string;
}

const allowedTransitions: Readonly<
  Record<PublicationState, readonly PublicationState[]>
> = {
  draft: ["validated", "cancelled"],
  validated: ["scheduled", "preparing", "submitting", "rejected", "cancelled"],
  scheduled: ["preparing", "submitting", "cancelled"],
  preparing: ["awaiting_confirmation", "submitting", "failed"],
  awaiting_confirmation: [
    "submitting",
    "verifying",
    "published",
    "uncertain",
    "failed",
    "cancelled",
  ],
  submitting: ["verifying", "uncertain", "failed"],
  verifying: ["published", "uncertain", "failed"],
  published: [],
  uncertain: ["verifying", "published", "failed"],
  failed: ["retrying", "cancelled"],
  retrying: ["submitting", "cancelled"],
  rejected: [],
  cancelled: [],
};

export class InvalidPublicationTransitionError extends Error {
  constructor(
    readonly from: PublicationState,
    readonly to: PublicationState,
  ) {
    super(`Cannot transition publication from ${from} to ${to}`);
    this.name = "InvalidPublicationTransitionError";
  }
}

export function createPublication(
  input: Omit<Publication, "state" | "transitions">,
): Readonly<Publication> {
  return Object.freeze({
    ...input,
    state: "draft",
    transitions: Object.freeze([]),
  });
}

export function transitionPublication(
  publication: Readonly<Publication>,
  to: PublicationState,
  occurredAt: string,
  reason?: string,
): Readonly<Publication> {
  if (!allowedTransitions[publication.state].includes(to)) {
    throw new InvalidPublicationTransitionError(publication.state, to);
  }

  const transition: PublicationTransition = {
    from: publication.state,
    to,
    occurredAt,
    ...(reason === undefined ? {} : { reason }),
  };

  return Object.freeze({
    ...publication,
    state: to,
    transitions: Object.freeze([...publication.transitions, transition]),
  });
}
