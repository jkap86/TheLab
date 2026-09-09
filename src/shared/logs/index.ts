// The visit log: who reached which page, and when. **Server-only** — `record`
// and `queries` both reach Postgres.
//
// `client-ip`, `access` and `routes` are pure and could be read from anywhere,
// but they are exported through here rather than deep-imported so this folder
// has one door, on the barrel rule. Nothing on the client needs any of them —
// `routes` in particular is the server's copy of a vocabulary the browser is
// deliberately not told, see that file.

export { LOGS_TOKEN_ENV, logsAccess } from "./access";
export type { LogsAccess } from "./access";
export { clientIp, isAddress } from "./client-ip";
export {
  LOGGED_ROUTES,
  LOGGED_ROUTE_PREFIXES,
  loggedRoute,
} from "./routes";
export { VISITOR_LOG_CAP, getVisitorLogs } from "./queries";
export { recordVisit } from "./record";
