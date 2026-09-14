// The visit log: who reached which page, and when. **Server-only** — `record`
// and `queries` both reach Postgres.
//
// `access`, `session`, `login`, `routes`, `visit-admission` and
// `retention-plan` are pure and could be read from anywhere, but they are
// exported through here rather than deep-imported so this folder has one door,
// on the barrel rule. Nothing on the client needs any of them — `routes` in
// particular is the one place the rule lives — both writers apply it, and the
// browser is deliberately not told it, see that file. The client address is
// `shared/request`'s, not this folder's: the same policy decides it for the
// stream admission and the sign-in throttle.

export { LOGS_TOKEN_ENV, logsAccess } from "./access";
export type { LogsAccess } from "./access";
export { loginRequest, logoutRequest, MAX_CREDENTIAL_LENGTH } from "./login";
export type { LoginDecision, LoginInput, LoginSuccess } from "./login";
export {
  createLoginThrottle,
  GLOBAL_LOGIN_THROTTLE,
  PER_CLIENT_LOGIN_THROTTLE,
} from "./login-throttle";
export type { LoginThrottle } from "./login-throttle";
export { loggedRoute } from "./routes";
export { VISITOR_LOG_CAP, getVisitorLogs } from "./queries";
export { recordVisit, visitAdmission } from "./record";
export type { VisitOutcome } from "./record";
export {
  DEFAULT_VISITOR_LOG_RETENTION_DAYS,
  RETENTION_BATCH,
  retentionPolicy,
  VISITOR_LOG_RETENTION_VAR,
} from "./retention-plan";
export type { RetentionPolicy } from "./retention-plan";
export {
  pruneVisitorLogs,
  startVisitorLogRetention,
  VISITOR_LOG_RETENTION_LOOP_VAR,
} from "./retention";
export type { PruneSummary } from "./retention";
export {
  createVisitAdmission,
  DEFAULT_VISIT_ADMISSION,
  VISIT_ADMISSION_VARS,
  visitAdmissionConfig,
} from "./visit-admission";
export type { VisitAdmission, VisitAdmissionConfig, VisitRefusal } from "./visit-admission";
export {
  LOGS_SESSION_COOKIE,
  LOGS_SESSION_SECRET_ENV,
  LOGS_SESSION_TTL_ENV,
  logsConfig,
  sessionFromCookieHeader,
} from "./session";
export type { LogsConfig } from "./session";
