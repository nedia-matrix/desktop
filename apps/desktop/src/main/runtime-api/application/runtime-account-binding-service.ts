import type { PlatformAccountSnapshot } from "@nedia-matrix/account-management";
import type { AccountService } from "@nedia-matrix/account-management";
import {
  AccountBindingVerificationError,
  RuntimeAccountBindingService as ContextRuntimeAccountBindingService,
  type RuntimeAccountBindingServiceDependencies as ContextDependencies,
  type RuntimeAccountBindingSnapshot,
} from "@nedia-matrix/runtime-account-binding";

export { AccountBindingVerificationError } from "@nedia-matrix/runtime-account-binding";
export type RuntimeAccountBinding = RuntimeAccountBindingSnapshot;

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
  account: PlatformAccountSnapshot;
  binding: RuntimeAccountBinding;
}

type AccountBindingsPort = ContextDependencies["accountBindings"];
type AccountsPort = Pick<
  AccountService,
  "listAccounts" | "resolveAccount" | "verifyAccount"
>;

export interface RuntimeAccountBindingServiceDependencies {
  accountBindings: AccountBindingsPort;
  accounts: AccountsPort;
  now?: (() => Date) | undefined;
}

export class RuntimeAccountBindingService {
  private readonly context: ContextRuntimeAccountBindingService;

  constructor(
    private readonly dependencies: RuntimeAccountBindingServiceDependencies,
  ) {
    this.context = new ContextRuntimeAccountBindingService({
      accountBindings: dependencies.accountBindings,
      accounts: {
        listAccounts: () =>
          dependencies.accounts.listAccounts().map(toRuntimeAccountView),
        resolveAccount: (runtimeAccountId) =>
          toRuntimeAccountView(
            dependencies.accounts.resolveAccount({
              accountId: runtimeAccountId,
            }).account,
          ),
        verifyAccount: async (runtimeAccountId) => {
          const result = await dependencies.accounts.verifyAccount({
            accountId: runtimeAccountId,
          });
          return result.status === "unknown"
            ? { status: "unknown" as const, reason: result.reason }
            : { status: result.status };
        },
      },
      now: dependencies.now,
    });
  }

  list(): RuntimeAccountBinding[] {
    return this.context.list();
  }

  bind(command: BindAccountCommand): RuntimeAccountBinding {
    return this.context.bind({
      externalAccountReference: command.platformAccountId,
      localAccountId: command.runtimeAccountId,
    });
  }

  async verify(
    query: VerifyAccountBindingQuery,
  ): Promise<VerifiedAccountBinding> {
    const result = await this.context.verify({
      externalAccountReference: query.platformAccountId,
      expectedLocalAccountId: query.runtimeAccountId,
      expectedPlatformId: query.platform,
    });
    const account = this.dependencies.accounts
      .listAccounts()
      .find((candidate) => candidate.id === result.account.id);
    if (!account) throw new TypeError("Runtime account does not exist");
    return { account, binding: result.binding };
  }

  removeForRuntimeAccount(runtimeAccountId: string): void {
    this.context.removeForRuntimeAccount(runtimeAccountId);
  }
}

function toRuntimeAccountView(account: PlatformAccountSnapshot) {
  return {
    id: account.id,
    platformId: account.platformId,
    status: account.status,
    externalAccountId: account.externalAccountId,
  };
}
