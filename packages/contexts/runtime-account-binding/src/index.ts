export interface RuntimeAccountBindingSnapshot {
  readonly platformAccountId: string;
  readonly runtimeAccountId: string;
  readonly platform: string;
  readonly externalAccountId: string;
  readonly boundAt: string;
}

export class InvalidRuntimeAccountBindingSnapshotError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRuntimeAccountBindingSnapshotError";
  }
}

export class RuntimeAccountBinding {
  private snapshot: RuntimeAccountBindingSnapshot;

  private constructor(snapshot: RuntimeAccountBindingSnapshot) {
    assertRuntimeAccountBindingSnapshot(snapshot);
    this.snapshot = clone(snapshot);
  }

  static establish(input: {
    externalAccountReference: string;
    localAccountId: string;
    platform: string;
    externalAccountId: string;
    boundAt: string;
  }): RuntimeAccountBinding {
    return RuntimeAccountBinding.rehydrate({
      platformAccountId: input.externalAccountReference,
      runtimeAccountId: input.localAccountId,
      platform: input.platform,
      externalAccountId: input.externalAccountId,
      boundAt: input.boundAt,
    });
  }

  static rehydrate(
    snapshot: RuntimeAccountBindingSnapshot,
  ): RuntimeAccountBinding {
    return new RuntimeAccountBinding(snapshot);
  }

  toSnapshot(): RuntimeAccountBindingSnapshot {
    return clone(this.snapshot);
  }

  matchesTarget(target: {
    externalAccountReference: string;
    expectedLocalAccountId?: string;
    expectedPlatformId?: string;
  }): boolean {
    return (
      this.snapshot.platformAccountId === target.externalAccountReference &&
      (target.expectedLocalAccountId === undefined ||
        target.expectedLocalAccountId === this.snapshot.runtimeAccountId) &&
      (target.expectedPlatformId === undefined ||
        target.expectedPlatformId === this.snapshot.platform)
    );
  }

  matchesAccount(account: {
    id: string;
    platformId: string;
    status: string;
    externalAccountId: string | null;
  }): boolean {
    return (
      account.id === this.snapshot.runtimeAccountId &&
      account.platformId === this.snapshot.platform &&
      account.status === "authenticated" &&
      account.externalAccountId === this.snapshot.externalAccountId
    );
  }
}

export interface RuntimeAccountView {
  readonly id: string;
  readonly platformId: string;
  readonly status: "authenticated" | "login_required" | "unknown";
  readonly externalAccountId: string | null;
}

export interface BindAccountCommand {
  readonly externalAccountReference: string;
  readonly localAccountId: string;
}

export interface VerifyAccountBindingQuery {
  readonly externalAccountReference: string;
  readonly expectedLocalAccountId?: string;
  readonly expectedPlatformId?: string;
}

export type RuntimeAccountVerification =
  | { readonly status: "authenticated" }
  | { readonly status: "login_required" }
  | { readonly status: "unknown"; readonly reason: string };

export interface RuntimeAccountBindingRepository {
  list(): RuntimeAccountBindingSnapshot[];
  put(binding: RuntimeAccountBindingSnapshot): void;
  removeForRuntimeAccount(runtimeAccountId: string): void;
}

export interface RuntimeAccountReader {
  listAccounts(): RuntimeAccountView[];
  resolveAccount(runtimeAccountId: string): RuntimeAccountView;
  verifyAccount(runtimeAccountId: string): Promise<RuntimeAccountVerification>;
}

export interface VerifiedRuntimeAccountBinding {
  readonly account: RuntimeAccountView;
  readonly binding: RuntimeAccountBindingSnapshot;
}

export const accountBindingErrorCodes = [
  "ACCOUNT_IDENTITY_MISMATCH",
  "NOT_LOGGED_IN",
] as const;
export type AccountBindingErrorCode = (typeof accountBindingErrorCodes)[number];

export class AccountBindingVerificationError extends Error {
  constructor(
    readonly code: AccountBindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountBindingVerificationError";
  }
}

export interface RuntimeAccountBindingServiceDependencies {
  readonly accountBindings: RuntimeAccountBindingRepository;
  readonly accounts: RuntimeAccountReader;
  readonly now?: (() => Date) | undefined;
}

export class RuntimeAccountBindingService {
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: RuntimeAccountBindingServiceDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  list(): RuntimeAccountBindingSnapshot[] {
    return this.dependencies.accountBindings.list();
  }

  bind(command: BindAccountCommand): RuntimeAccountBindingSnapshot {
    const account = this.dependencies.accounts.resolveAccount(
      command.localAccountId,
    );
    if (
      account.status !== "authenticated" ||
      account.externalAccountId === null
    ) {
      throw new TypeError("Runtime account does not have a stable identity");
    }
    const binding = RuntimeAccountBinding.establish({
      externalAccountReference: command.externalAccountReference,
      localAccountId: account.id,
      platform: account.platformId,
      externalAccountId: account.externalAccountId,
      boundAt: this.now().toISOString(),
    }).toSnapshot();
    this.dependencies.accountBindings.put(binding);
    return binding;
  }

  async verify(
    query: VerifyAccountBindingQuery,
  ): Promise<VerifiedRuntimeAccountBinding> {
    const binding = this.dependencies.accountBindings
      .list()
      .find(
        (candidate) =>
          candidate.platformAccountId === query.externalAccountReference,
      );
    if (!binding) {
      throw new AccountBindingVerificationError(
        "ACCOUNT_IDENTITY_MISMATCH",
        "Account binding does not exist",
      );
    }
    const aggregate = RuntimeAccountBinding.rehydrate(binding);
    if (!aggregate.matchesTarget(query)) {
      throw new AccountBindingVerificationError(
        "ACCOUNT_IDENTITY_MISMATCH",
        "Publication target does not match account binding",
      );
    }
    const detected = await this.dependencies.accounts.verifyAccount(
      binding.runtimeAccountId,
    );
    if (detected.status === "login_required") {
      throw new AccountBindingVerificationError(
        "NOT_LOGGED_IN",
        "Runtime account is not authenticated",
      );
    }
    if (detected.status === "unknown") {
      throw new AccountBindingVerificationError(
        "ACCOUNT_IDENTITY_MISMATCH",
        detected.reason,
      );
    }
    const account = this.dependencies.accounts
      .listAccounts()
      .find((candidate) => candidate.id === binding.runtimeAccountId);
    if (!account) throw new TypeError("Runtime account does not exist");
    if (!aggregate.matchesAccount(account)) {
      throw new AccountBindingVerificationError(
        "ACCOUNT_IDENTITY_MISMATCH",
        "Runtime account identity does not match the binding",
      );
    }
    return { account, binding };
  }

  removeForRuntimeAccount(runtimeAccountId: string): void {
    this.dependencies.accountBindings.removeForRuntimeAccount(runtimeAccountId);
  }
}

export function assertRuntimeAccountBindingSnapshot(
  snapshot: RuntimeAccountBindingSnapshot,
): RuntimeAccountBindingSnapshot {
  try {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new TypeError("Runtime account binding must be an object");
    }
    assertNonEmptyString(
      snapshot.platformAccountId,
      "Runtime binding platform account ID",
    );
    assertNonEmptyString(
      snapshot.runtimeAccountId,
      "Runtime binding account ID",
    );
    assertNonEmptyString(snapshot.platform, "Runtime binding platform");
    assertNonEmptyString(
      snapshot.externalAccountId,
      "Runtime binding external account ID",
    );
    assertTimestamp(snapshot.boundAt, "Runtime binding creation time");
  } catch (error) {
    if (error instanceof InvalidRuntimeAccountBindingSnapshotError) {
      throw error;
    }
    throw new InvalidRuntimeAccountBindingSnapshotError(
      error instanceof Error
        ? error.message
        : "Invalid runtime account binding",
    );
  }
  return snapshot;
}

function assertNonEmptyString(
  value: unknown,
  name: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertTimestamp(
  value: unknown,
  name: string,
): asserts value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} must be a timestamp`);
  }
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        clone(entry),
      ]),
    ) as T;
  }
  return value;
}
