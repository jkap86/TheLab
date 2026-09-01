// Resolving a name someone typed to a Sleeper user. Import from here, not from
// the files inside — `resolve-manager-id` and `memoize-manager-lookup` are what
// `resolveManagerUser` is built out of and have no caller of their own.

export { resolveManagerUser } from "./resolve-manager-user";
export type { ResolvedManager } from "./resolve-manager-user";
export { toUserInfo } from "./to-user-info";
