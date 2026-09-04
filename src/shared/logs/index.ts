// The visit log: who reached which page, and when. **Server-only** — `record`
// and `queries` both reach Postgres.
//
// `client-ip` and `access` are pure and could be read from anywhere, but they
// are exported through here rather than deep-imported so this folder has one
// door, on the barrel rule. Nothing on the client needs either.

export { LOGS_TOKEN_ENV, logsAccess } from "./access";
export type { LogsAccess } from "./access";
export { clientIp, isAddress } from "./client-ip";
export { VISITOR_LOG_CAP, getVisitorLogs } from "./queries";
export { recordVisit } from "./record";
