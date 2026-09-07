export {
  AccountReplacedError,
  AccountService,
  type AccountServiceDependencies,
} from "./application/account-service.js";
export type {
  AccountRepository,
  BrowserSessionPort,
} from "./application/account-ports.js";
export type {
  AccountReplacementAlias,
  CanonicalAccountIdentity,
  ResolvedPlatformAccount,
  RetiredBrowserProfile,
} from "./application/account-types.js";
export {
  assertAccountRequest,
  assertLoginRequest,
  assertPlatformRequest,
} from "./application/account-request-validator.js";
export {
  cleanupClosedBrowserSession,
  removeAccountAndResources,
} from "./application/account-resource-cleanup.js";
