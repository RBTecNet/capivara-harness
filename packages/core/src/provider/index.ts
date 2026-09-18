export { ROLES, ROLE_NAMES, resolveRoles } from "./roles.js";
export type { Permission, RoleConfig, RoleDefinition, RoleName, RoleOverrides, RoleResolution } from "./roles.js";
export {
  CLI_CATALOG,
  CLI_PROVIDERS,
  DIRECT_CATALOG,
  DIRECT_PROVIDERS,
  cliProvider,
  decideReasoning,
  directProvider,
  isCliProvider,
  isDirectProvider,
} from "./registry.js";
export type {
  CliProvider,
  CliProviderId,
  Dialect,
  DirectProvider,
  DirectProviderId,
  ProviderId,
  ReasoningDecision,
  ReasoningPolicy,
} from "./registry.js";
export { buildInvocation } from "./adapters.js";
export type { Invocation, InvocationContext } from "./adapters.js";
export { killTree, runProvider } from "./supervisor.js";
export type { RunOptions, RunResult, SupervisorLimits, TimeoutKind } from "./supervisor.js";
export { mask, redact } from "./redact.js";
export {
  CREDENTIALS_CONTRACT,
  credentialsPath,
  forgetAll,
  readCredentials,
  removeCredential,
  saveCredential,
  selectCredential,
  toSafe,
  writeCredentials,
} from "./credentials.js";
export type { CredentialRecord, SafeCredential } from "./credentials.js";
export { createLineSplitter, parseClaudeJson, parseCodexJsonl, parseOpencodeJsonl, readTranscript, summarizeCodexEvent } from "./transcript.js";
export type { TokenUsage, Transcript, TranscriptKind } from "./transcript.js";
export { CLI_ADAPTERS, cliAdapter } from "./cli/index.js";
export type { AccessLevel, CliAdapter, CliInvocation, CliInvocationInput } from "./cli/index.js";
