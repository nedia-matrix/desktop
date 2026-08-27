import type { PlatformAccountSummary } from "@nedia-matrix/ipc-contracts";

import type { AccountApplication } from "./account-application.js";
import type {
  RuntimeAccountBinding,
  RuntimeAccountBindingStore,
} from "../local-runtime/runtime-account-binding-store.js";

export interface BindAccountCommand {
  platformAccountId: string;
  runtimeAccountId: string;
}

export interface VerifyAccountBindingQuery {
  platformAccountId: string;
  runtimeAccountId?: string;
  platform?: string;
}

export interface VerifiedAccountBinding {
  account: PlatformAccountSummary;
  binding: RuntimeAccountBinding;
}

export class AccountBindingVerificationError extends Error {
  constructor(
    readonly code: "ACCOUNT_IDENTITY_MISMATCH" | "NOT_LOGGED_IN",
    message: string,
  ) {
    super(message);
  }
}

type AccountBindingsPort = Pick<
  RuntimeAccountBindingStore,
  "list" | "put" | "removeForRuntimeAccount"
>;
type AccountsPort = Pick<
  AccountApplication,
  "listAccounts" | "resolveAccount" | "verifyAccount"
>;

export interface AccountBindingApplicationDependencies {
  accountBindings: AccountBindingsPort;
  accounts: AccountsPort;
  now?: (() => Date) | undefined;
}

export class AccountBindingApplication {
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: AccountBindingApplicationDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  list(): RuntimeAccountBinding[] {
    return this.dependencies.accountBindings.list();
  }

  bind(command: BindAccountCommand): RuntimeAccountBinding {
    const account = this.dependencies.accounts.resolveAccount({
      accountId: command.runtimeAccountId,
    }).account;
    if (!account.externalAccountId) {
      throw new TypeError("Runtime account does not have a stable identity");
    }

    const binding: RuntimeAccountBinding = {
      platformAccountId: command.platformAccountId,
      runtimeAccountId: account.id,
      platform: account.platformId,
      externalAccountId: account.externalAccountId,
      boundAt: this.now().toISOString(),
    };
    this.dependencies.accountBindings.put(binding);
    return binding;
  }

  async verify(
    query: VerifyAccountBindingQuery,
  ): Promise<VerifiedAccountBinding> {
    const binding = this.dependencies.accountBindings
      .list()
      .find(
        (candidate) => candidate.platformAccountId === query.platformAccountId,
      );
    if (!binding) {
      throw new AccountBindingVerificationError(
        "ACCOUNT_IDENTITY_MISMATCH",
        "Account binding does not exist",
      );
    }
    if (
      (query.runtimeAccountId !== undefined &&
        query.runtimeAccountId !== binding.runtimeAccountId) ||
      (query.platform !== undefined && query.platform !== binding.platform)
    ) {
      throw new AccountBindingVerificationError(
        "ACCOUNT_IDENTITY_MISMATCH",
        "Publication target does not match account binding",
      );
    }

    const detected = await this.dependencies.accounts.verifyAccount({
      accountId: binding.runtimeAccountId,
    });
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

    const account = this.requireAccount(binding.runtimeAccountId);
    if (account.status !== "authenticated") {
      throw new AccountBindingVerificationError(
        "NOT_LOGGED_IN",
        "Runtime account is not authenticated",
      );
    }
    if (
      account.platformId !== binding.platform ||
      account.externalAccountId !== binding.externalAccountId
    ) {
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

  private requireAccount(accountId: string): PlatformAccountSummary {
    const account = this.dependencies.accounts
      .listAccounts()
      .find((candidate) => candidate.id === accountId);
    if (!account) throw new TypeError("Runtime account does not exist");
    return account;
  }
}
