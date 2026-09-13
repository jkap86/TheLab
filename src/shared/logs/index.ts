// The visit log: who reached which page, and when. **Server-only** — `record`
// and `queries` both reach Postgres.
//
// `client-ip`, `access` and `routes` are pure and could be read from anywhere,
// but they are exported through here rather than deep-imported so this folder
// has one door, on the barrel rule. Nothing on the client needs any of them —
// `routes` in particular is the one place the rule lives — both writers apply
// it, and the browser is deliberately not told it, see that file.

export { LOGS_TOKEN_ENV, logsAccess } from "./access";
export type { LogsAccess } from "./access";
export { clientIp, isAddress } from "./client-ip";
export { loggedRoute } from "./routes";
export { VISITOR_LOG_CAP, getVisitorLogs } from "./queries";
export { recordVisit } from "./record";
