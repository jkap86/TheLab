// Superseded by `@/shared/sleeper`. This file had grown into the whole Sleeper
// client — URL builder, limiter, fallback folding — under a filename naming one
// function, and in `util/user/` rather than the `shared/sleeper/` folder that was
// created for it. Nothing imports it any more; safe to delete.

export { getSleeperUser } from "@/shared/sleeper";
