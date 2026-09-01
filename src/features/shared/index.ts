// The cross-feature client layer. Import from here, not from the files inside —
// `local-store.ts` is deliberately absent, because only this folder's own
// modules build on it.

export { storeAccount, useStoredAccount } from "./account";
export type { SubjectKind } from "./subjects";
