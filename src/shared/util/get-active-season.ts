// Superseded by `@/shared/season`, which is where the resolver this delegated to
// actually lives — this file held `resolver.resolve()` with no `resolver` in
// scope. Nothing imports it any more; safe to delete.

export { getActiveSeason } from "@/shared/season";
